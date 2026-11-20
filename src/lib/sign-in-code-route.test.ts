import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ calls: [] as { url: string; method: string; body: string }[] }));

vi.mock("@/auth", () => ({
  authHandler: vi.fn(async (req: NextRequest) => {
    auth.calls.push({ url: req.url, method: req.method, body: req.method === "POST" ? await req.text() : "" });
    return Response.json({ url: "from-nextauth" });
  }),
}));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";
import { codeCallbackRequest, isEmailCallback, isLegacyLinkToken } from "./sign-in-code-route";

const APP = "https://upvoteme.hintwise.org";
const ctx = (...nextauth: string[]) => ({ params: Promise.resolve({ nextauth }) });

function codePost(fields: Record<string, string>, headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" }) {
  return new NextRequest(`${APP}/api/auth/callback/email`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(() => {
  auth.calls = [];
});

describe("codeCallbackRequest", () => {
  it("moves the address and code from the body into the query NextAuth reads, and asks for JSON", async () => {
    const { request, response } = await codeCallbackRequest(
      codePost({ email: " Alice@Example.com ", code: "012 345", callbackUrl: "/t/abc?root=c1" }),
    );
    expect(response).toBeUndefined();
    const url = new URL(request!.url);
    expect(url.origin + url.pathname).toBe(`${APP}/api/auth/callback/email`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ email: "alice@example.com", token: "012345", callbackUrl: "/t/abc?root=c1" });
    expect(request!.method).toBe("POST");
    expect(await request!.text()).toBe("json=true");
  });

  it.each(["//evil.example", "https://evil.example/", "/..//evil.example", "/signin", ""])(
    "sanitises a callbackUrl of %j to the home page",
    async (callbackUrl) => {
      const { request } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456", callbackUrl }));
      expect(new URL(request!.url).searchParams.get("callbackUrl")).toBe("/");
    },
  );

  it.each([
    [{ email: "alice@example.com", code: "12345" }],
    [{ email: "alice@example.com", code: "" }],
    [{ email: "alice@example.com" }],
    [{ email: "not-an-address", code: "123456" }],
    [{ code: "123456" }],
  ])("answers %j as a wrong code without asking NextAuth", async (fields) => {
    const { request, response } = await codeCallbackRequest(codePost(fields as Record<string, string>));
    expect(request).toBeUndefined();
    expect(await response!.json()).toEqual({ url: "/api/auth/error?error=Verification" });
  });

  it("refuses a body too large to be the form", async () => {
    const { response } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456", pad: "x".repeat(5000) }));
    expect(await response!.json()).toEqual({ url: "/api/auth/error?error=Verification" });
  });

  it.each(["cross-site", "same-site", "none"])("refuses a post from another site (Sec-Fetch-Site: %s)", async (site) => {
    const { response } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456" }, { "Sec-Fetch-Site": site }));
    expect(response!.status).toBe(403);
  });

  it("accepts a post without Sec-Fetch-Site (older browsers)", async () => {
    const { request } = await codeCallbackRequest(codePost({ email: "a@b.co", code: "123456" }, {}));
    expect(request).toBeDefined();
  });
});

describe("isEmailCallback and isLegacyLinkToken", () => {
  it("matches only the email callback", () => {
    expect(isEmailCallback(["callback", "email"])).toBe(true);
    for (const segments of [["callback", "supabase"], ["signin", "email"], ["callback"], ["callback", "email", "x"], undefined]) {
      expect(isEmailCallback(segments)).toBe(false);
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

  it("passes a GET with a link sent before codes on to NextAuth unchanged", async () => {
    const link = `${APP}/api/auth/callback/email?callbackUrl=%2F&token=${"ab".repeat(32)}&email=a%40b.co`;
    await GET(new NextRequest(link), ctx("callback", "email"));
    expect(auth.calls).toEqual([{ url: link, method: "GET", body: "" }]);
  });

  it("passes every other GET and POST on unchanged", async () => {
    await GET(new NextRequest(`${APP}/api/auth/session`), ctx("session"));
    await GET(new NextRequest(`${APP}/api/auth/callback/supabase?code=c1`), ctx("callback", "supabase"));
    await POST(
      new NextRequest(`${APP}/api/auth/signin/email`, { method: "POST", body: "email=a%40b.co" }),
      ctx("signin", "email"),
    );
    expect(auth.calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      "GET /api/auth/session",
      "GET /api/auth/callback/supabase?code=c1",
      "POST /api/auth/signin/email",
    ]);
    expect(auth.calls[2].body).toBe("email=a%40b.co");
  });

  it("hands NextAuth the code form's POST with the code in its own query, not in the browser's URL", async () => {
    const res = await POST(codePost({ email: "a@b.co", code: "123-456", callbackUrl: "/t/abc" }), ctx("callback", "email"));
    expect(await res.json()).toEqual({ url: "from-nextauth" });
    expect(auth.calls).toHaveLength(1);
    const url = new URL(auth.calls[0].url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ email: "a@b.co", token: "123456", callbackUrl: "/t/abc" });
    expect(auth.calls[0].body).toBe("json=true");
  });

  it("answers a malformed code itself", async () => {
    const res = await POST(codePost({ email: "a@b.co", code: "12" }), ctx("callback", "email"));
    expect(await res.json()).toEqual({ url: "/api/auth/error?error=Verification" });
    expect(auth.calls).toEqual([]);
  });
});
