import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { CodeContext } from "./sign-in-code-store";

const auth = vi.hoisted(() => ({
  calls: [] as { url: string; method: string; body: string; context: unknown }[],
  /** What the fake NextAuth does with a code request's context. */
  onRequest: (context: { onStored?: () => void }) => context.onStored?.(),
}));

vi.mock("@/auth", () => {
  const handle = (context: unknown) => async (req: NextRequest) => {
    auth.calls.push({ url: req.url, method: req.method, body: req.method === "POST" ? await req.text() : "", context });
    if (context && (context as { kind: string }).kind === "request") auth.onRequest(context as { onStored?: () => void });
    return Response.json({ url: "from-nextauth" });
  };
  return { authHandler: handle(null), authHandlerFor: (context: unknown) => handle(context) };
});

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";
import {
  CLIENT_IP_HEADER,
  browserKeyOf,
  clientOf,
  codeCallbackRequest,
  codeCookie,
  isEmailCallback,
  isEmailSignIn,
  isLegacyLinkToken,
  newBrowserKey,
} from "./sign-in-code-route";

const APP = "https://upvoteme.hintwise.org";
const COOKIE = "__Host-upvoteme.signin-code";
const KEY = "k".repeat(43);
const ctx = (...nextauth: string[]) => ({ params: Promise.resolve({ nextauth }) });

function codePost(fields: Record<string, string>, headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" }) {
  return new NextRequest(`${APP}/api/auth/callback/email`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

const realUrl = process.env.NEXTAUTH_URL;
beforeEach(() => {
  auth.calls = [];
  auth.onRequest = (context) => context.onStored?.();
  process.env.NEXTAUTH_URL = APP;
});
afterEach(() => {
  process.env.NEXTAUTH_URL = realUrl;
});

describe("codeCallbackRequest", () => {
  it("moves the address and code from the body into the query NextAuth reads, with the browser's key", async () => {
    const { request, response, browserKey } = await codeCallbackRequest(
      codePost({ email: " Alice@Example.com ", code: "012 345", callbackUrl: "/t/abc?root=c1" }, {
        "Sec-Fetch-Site": "same-origin",
        Cookie: `${COOKIE}=${KEY}`,
      }),
      APP,
    );
    expect(response).toBeUndefined();
    expect(browserKey).toBe(KEY);
    const url = new URL(request!.url);
    expect(url.origin + url.pathname).toBe(`${APP}/api/auth/callback/email`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ email: "alice@example.com", token: "012345", callbackUrl: "/t/abc?root=c1" });
    expect(request!.method).toBe("POST");
    expect(await request!.text()).toBe("json=true");
  });

  it("has no browser key without the cookie, or with a malformed or foreign-named one", async () => {
    for (const cookie of [undefined, `${COOKIE}=short`, `${COOKIE}=${"k".repeat(42)};`, `upvoteme.signin-code=${KEY}`]) {
      const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}) };
      const { browserKey } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456" }, headers), APP);
      expect(browserKey).toBeNull();
    }
  });

  it.each(["//evil.example", "https://evil.example/", "/..//evil.example", "/signin", ""])(
    "sanitises a callbackUrl of %j to the home page",
    async (callbackUrl) => {
      const { request } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456", callbackUrl }), APP);
      expect(new URL(request!.url).searchParams.get("callbackUrl")).toBe("/");
    },
  );

  it.each([
    [{ email: "alice@example.com", code: "12345" }],
    [{ email: "alice@example.com", code: "" }],
    [{ email: "alice@example.com" }],
    [{ email: "not-an-address", code: "123456" }],
    [{ email: "a <victim@uw.test>", code: "123456" }],
    [{ code: "123456" }],
  ])("answers %j as a wrong code without asking NextAuth", async (fields) => {
    const { request, response } = await codeCallbackRequest(codePost(fields as Record<string, string>), APP);
    expect(request).toBeUndefined();
    expect(await response!.json()).toEqual({ url: "/api/auth/error?error=Verification" });
  });

  it("refuses a body too large to be the form", async () => {
    const { response } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456", pad: "x".repeat(5000) }), APP);
    expect(await response!.json()).toEqual({ url: "/api/auth/error?error=Verification" });
  });

  it.each(["cross-site", "same-site", "none"])("refuses a post from another site (Sec-Fetch-Site: %s), whatever its Origin", async (site) => {
    const { response } = await codeCallbackRequest(
      codePost({ email: "a@b.co", code: "123456" }, { "Sec-Fetch-Site": site, Origin: APP }),
      APP,
    );
    expect(response!.status).toBe(403);
  });

  it("without Sec-Fetch-Site, accepts this site's Origin and refuses any other, or none", async () => {
    const post = (headers: Record<string, string>) => codeCallbackRequest(codePost({ email: "a@b.co", code: "123456" }, headers), APP);
    expect((await post({ Origin: APP })).request).toBeDefined();
    const refused: Record<string, string>[] = [{ Origin: "https://evil.example" }, { Origin: "null" }, { Origin: "https://x.hintwise.org" }, {}];
    for (const headers of refused) {
      expect((await post(headers)).response!.status).toBe(403);
    }
  });

  it("takes the request's own origin as this site too (NEXTAUTH_URL unset)", async () => {
    const { request } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456" }, { Origin: APP }), undefined);
    expect(request).toBeDefined();
  });
});

describe("codeCookie and the browser key", () => {
  it("is a host-only, Secure, httpOnly, SameSite=Lax cookie on https that lasts as long as a code", () => {
    const cookie = codeCookie(APP);
    expect(cookie.name).toBe(COOKIE);
    expect(cookie.serialize(KEY)).toBe(`${COOKIE}=${KEY}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`);
  });

  it("drops Secure and the __Host- prefix on plain http (local runs)", () => {
    const cookie = codeCookie("http://localhost:3000");
    expect(cookie.serialize(KEY)).toBe(`upvoteme.signin-code=${KEY}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`);
  });

  it("makes 43-character random keys that browserKeyOf accepts", () => {
    const keys = new Set(Array.from({ length: 100 }, () => newBrowserKey()));
    expect(keys.size).toBe(100);
    for (const key of keys) {
      const req = new NextRequest(APP, { headers: { Cookie: `${COOKIE}=${key}` } });
      expect(browserKeyOf(req, APP)).toBe(key);
    }
  });
});

describe("clientOf", () => {
  const client = (value?: string) => clientOf(new Headers(value === undefined ? {} : { [CLIENT_IP_HEADER]: value }));

  it("reads Netlify's client address header", () => {
    expect(client("198.51.100.7")).toBe("198.51.100.7");
    expect(client(" 198.51.100.7 ")).toBe("198.51.100.7");
    expect(client("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });

  it("counts an IPv6 client by its /64", () => {
    expect(client("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(client("2001:0db8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(client("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(client("2001:DB8:1:2::99")).toBe("2001:db8:1:2::/64");
  });

  it("is 'unknown' without a usable header, and ignores X-Forwarded-For", () => {
    expect(client()).toBe("unknown");
    expect(client("")).toBe("unknown");
    expect(client("not an ip")).toBe("unknown");
    expect(client("198.51.100.7, 10.0.0.1")).toBe("unknown");
    expect(clientOf(new Headers({ "x-forwarded-for": "198.51.100.7" }))).toBe("unknown");
  });
});

describe("isEmailCallback, isEmailSignIn and isLegacyLinkToken", () => {
  it("match only their own segments", () => {
    expect(isEmailCallback(["callback", "email"])).toBe(true);
    expect(isEmailSignIn(["signin", "email"])).toBe(true);
    for (const segments of [["callback", "supabase"], ["signin", "supabase"], ["callback"], ["callback", "email", "x"], undefined]) {
      expect(isEmailCallback(segments)).toBe(false);
      expect(isEmailSignIn(segments)).toBe(false);
    }
  });

  it("knows a link token from before codes (64 hex characters) from anything else", () => {
    expect(isLegacyLinkToken("0123456789abcdef".repeat(4))).toBe(true);
    for (const token of ["123456", "0123456789ABCDEF".repeat(4), "g".repeat(64), "a".repeat(63), "", null]) {
      expect(isLegacyLinkToken(token)).toBe(false);
    }
  });
});

describe("/api/auth/[...nextauth] route", () => {
  it("sends a GET with a code (a scanner, or a hand-made link) to the sign-in page, never to NextAuth", async () => {
    for (const token of ["123456", "", "x"]) {
      const res = await GET(new NextRequest(`${APP}/api/auth/callback/email?token=${token}&email=a%40b.co`), ctx("callback", "email"));
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/signin?error=Verification");
    }
    const bare = await GET(new NextRequest(`${APP}/api/auth/callback/email`), ctx("callback", "email"));
    expect(bare.headers.get("Location")).toBe("/signin?error=Verification");
    expect(auth.calls).toEqual([]);
  });

  it("passes a GET with a link sent before codes on to NextAuth unchanged, as a link (never a code)", async () => {
    const link = `${APP}/api/auth/callback/email?callbackUrl=%2F&token=${"ab".repeat(32)}&email=a%40b.co`;
    await GET(new NextRequest(link, { headers: { Cookie: `${COOKIE}=${KEY}` } }), ctx("callback", "email"));
    expect(auth.calls).toEqual([{ url: link, method: "GET", body: "", context: { kind: "link" } }]);
  });

  it("passes every other GET and POST on unchanged, without a code context", async () => {
    await GET(new NextRequest(`${APP}/api/auth/session`), ctx("session"));
    await GET(new NextRequest(`${APP}/api/auth/callback/supabase?code=c1`), ctx("callback", "supabase"));
    await POST(new NextRequest(`${APP}/api/auth/signin/supabase`, { method: "POST", body: "x=1" }), ctx("signin", "supabase"));
    expect(auth.calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search} ${c.context}`)).toEqual([
      "GET /api/auth/session null",
      "GET /api/auth/callback/supabase?code=c1 null",
      "POST /api/auth/signin/supabase null",
    ]);
  });

  describe("asking for a code", () => {
    const ask = (headers: Record<string, string> = {}) =>
      POST(
        new NextRequest(`${APP}/api/auth/signin/email`, { method: "POST", body: "email=a%40b.co", headers }),
        ctx("signin", "email"),
      );

    it("gives NextAuth a new browser key and the Netlify client, and sets the cookie once a code is stored", async () => {
      const res = await ask({ [CLIENT_IP_HEADER]: "198.51.100.7", "x-forwarded-for": "203.0.113.1" });
      expect(auth.calls).toHaveLength(1);
      const context = auth.calls[0].context as Extract<CodeContext, { kind: "request" }>;
      expect(context).toMatchObject({ kind: "request", client: "198.51.100.7" });
      expect(context.browserKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(auth.calls[0].body).toBe("email=a%40b.co");
      expect(res.headers.get("Set-Cookie")).toBe(codeCookie(APP).serialize(context.browserKey));
    });

    it("keeps the browser's existing key, so its new code replaces its old one", async () => {
      await ask({ Cookie: `${COOKIE}=${KEY}` });
      expect(auth.calls[0].context).toMatchObject({ kind: "request", browserKey: KEY, client: "unknown" });
    });

    it("sets no cookie when no code was stored (a refused or failed request), so the browser keeps its current code", async () => {
      auth.onRequest = () => {};
      const res = await ask({ Cookie: `${COOKIE}=${KEY}` });
      expect(res.headers.get("Set-Cookie")).toBeNull();
    });
  });

  it("hands NextAuth the code form's POST with the code in its own query and the browser's key", async () => {
    const res = await POST(
      codePost({ email: "a@b.co", code: "123-456", callbackUrl: "/t/abc" }, { "Sec-Fetch-Site": "same-origin", Cookie: `${COOKIE}=${KEY}` }),
      ctx("callback", "email"),
    );
    expect(await res.json()).toEqual({ url: "from-nextauth" });
    expect(auth.calls).toHaveLength(1);
    const url = new URL(auth.calls[0].url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ email: "a@b.co", token: "123456", callbackUrl: "/t/abc" });
    expect(auth.calls[0].body).toBe("json=true");
    expect(auth.calls[0].context).toEqual({ kind: "code", browserKey: KEY });
  });

  it("passes a code without the cookie on with no key (NextAuth then finds no code)", async () => {
    await POST(codePost({ email: "a@b.co", code: "123456" }), ctx("callback", "email"));
    expect(auth.calls[0].context).toEqual({ kind: "code", browserKey: null });
  });

  it("answers a malformed code, or a post from another site, itself", async () => {
    const bad = await POST(codePost({ email: "a@b.co", code: "12" }), ctx("callback", "email"));
    expect(await bad.json()).toEqual({ url: "/api/auth/error?error=Verification" });
    const foreign = await POST(codePost({ email: "a@b.co", code: "123456" }, { Origin: "https://evil.example" }), ctx("callback", "email"));
    expect(foreign.status).toBe(403);
    expect(auth.calls).toEqual([]);
  });
});
