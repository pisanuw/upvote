/**
 * The whole Google-through-Supabase sign-in, run through NextAuth's own
 * handler with an in-memory adapter and a fake Supabase (no network, no DB):
 * start, Supabase's redirect back with ?code=, the PKCE exchange, the user
 * lookup, linking to an existing user by email, and the database session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  Adapter,
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken,
} from "next-auth/adapters";
import { buildAuthOptions, buildProviders } from "./auth-options";
import type { SupabaseUser } from "./supabase-auth";
import { codeCallbackRequest, codeCookie, newBrowserKey } from "./sign-in-code-route";
import { bindCode, codeIdentifier, type CodeContext } from "./sign-in-code-store";
import { sendSignInCodeEmail } from "./sign-in-code-email";
import { CODE_LIMITS, normalizeEmailAddress } from "./sign-in-code";
import { issueKnownBrowser } from "./known-browser";
import nodemailer from "nodemailer";
import { NextRequest } from "next/server";
import { fakeSmtp } from "@/__tests__/fake-smtp";
import { memoryTokenStore } from "@/__tests__/memory-token-store";

// NextAuth's request-level handler (what its route handler calls). The
// package does not export "next-auth/core", so load the file directly.
type AuthResponse<B> = {
  redirect?: string;
  body?: B;
  cookies?: { name: string; value: string }[];
};
const { AuthHandler } = createRequire(import.meta.url)(
  path.join(process.cwd(), "node_modules/next-auth/core/index.js"),
) as {
  AuthHandler: <B = unknown>(params: {
    req: Record<string, unknown>;
    options: ReturnType<typeof buildAuthOptions>;
  }) => Promise<AuthResponse<B>>;
};

const APP = "https://upvoteme.hintwise.org";
const SB = "https://sb.test";
const env = {
  NEXTAUTH_URL: APP,
  SUPABASE_AUTH_URL: SB,
  SUPABASE_AUTH_ANON_KEY: "anon-test",
};

function memoryAdapter() {
  const users = new Map<string, AdapterUser>();
  const accounts: AdapterAccount[] = [];
  const sessions: AdapterSession[] = [];
  const tokens: VerificationToken[] = [];
  let n = 0;
  const adapter: Adapter = {
    createUser: vi.fn(async (data: Omit<AdapterUser, "id">) => {
      const user = { ...data, id: `user-${++n}` } as AdapterUser;
      users.set(user.id, user);
      return user;
    }),
    getUser: vi.fn(async (id: string) => users.get(id) ?? null),
    getUserByEmail: vi.fn(async (email: string) => [...users.values()].find((u) => u.email === email) ?? null),
    getUserByAccount: vi.fn(async ({ provider, providerAccountId }) => {
      const a = accounts.find((x) => x.provider === provider && x.providerAccountId === providerAccountId);
      return a ? (users.get(a.userId) ?? null) : null;
    }),
    updateUser: vi.fn(async (data) => {
      const user = { ...users.get(data.id!)!, ...data } as AdapterUser;
      users.set(user.id, user);
      return user;
    }),
    linkAccount: vi.fn(async (account: AdapterAccount) => {
      accounts.push(account);
      return account;
    }),
    createSession: vi.fn(async (s: AdapterSession) => {
      sessions.push(s);
      return s;
    }),
    getSessionAndUser: vi.fn(async () => null),
    updateSession: vi.fn(async () => null),
    deleteSession: vi.fn(async () => null),
    createVerificationToken: vi.fn(async (t: VerificationToken) => {
      tokens.push(t);
      return t;
    }),
    useVerificationToken: vi.fn(async ({ identifier, token }: { identifier: string; token: string }) => {
      const i = tokens.findIndex((t) => t.identifier === identifier && t.token === token);
      return i < 0 ? null : tokens.splice(i, 1)[0];
    }),
  };
  const { store: codeStore } = memoryTokenStore(tokens);
  return { adapter, codeStore, users, accounts, sessions, tokens };
}

const googleUser = (over: Partial<SupabaseUser> = {}): SupabaseUser => ({
  id: "4f9c2b1e-0000-4000-8000-000000000001",
  email: "alice@example.com",
  email_confirmed_at: "2026-11-10T12:00:00Z",
  app_metadata: { provider: "google", providers: ["google"] },
  identities: [{ provider: "google" }],
  user_metadata: { full_name: "Alice Example" },
  ...over,
});

type Call = { url: string; init?: RequestInit };

function fakeSupabase(user: SupabaseUser, calls: Call[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${SB}/auth/v1/token?grant_type=pkce`)
      return new Response(JSON.stringify({ access_token: "sb-access", refresh_token: "sb-refresh", user }), { status: 200 });
    if (url === `${SB}/auth/v1/user`) return new Response(JSON.stringify(user), { status: 200 });
    if (url === `${SB}/rest/v1/rpc/ensure_profile`) return new Response("{}", { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
}

function cookieMap(cookies: { name: string; value: string }[] | undefined) {
  return Object.fromEntries((cookies ?? []).map((c) => [c.name, c.value]));
}

/** Runs sign-in start through NextAuth: CSRF, then POST /signin/supabase. */
async function startSignIn(options: ReturnType<typeof buildAuthOptions>) {
  const csrf = await AuthHandler<{ csrfToken: string }>({
    req: { action: "csrf", method: "GET", origin: APP },
    options,
  });
  const csrfCookies = cookieMap(csrf.cookies);
  const start = await AuthHandler({
    req: {
      action: "signin",
      providerId: "supabase",
      method: "POST",
      origin: APP,
      cookies: csrfCookies,
      body: { csrfToken: csrf.body!.csrfToken, callbackUrl: `${APP}/t/abc` },
    },
    options,
  });
  return { start, cookies: { ...csrfCookies, ...cookieMap(start.cookies) } };
}

let calls: Call[];
const realEnv = { ...process.env };

beforeEach(() => {
  calls = [];
  Object.assign(process.env, env, { AUTH_SECRET: "test-secret", NEXTAUTH_SECRET: "test-secret" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...realEnv };
});

describe("buildProviders", () => {
  it("uses the Supabase provider for Google by default", () => {
    expect(buildProviders(env).map((p) => p.id)).toEqual(["supabase"]);
  });

  it("uses the app's own Google provider in direct mode", () => {
    const ids = buildProviders({
      ...env,
      NEXT_PUBLIC_GOOGLE_AUTH_VIA: "direct",
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
    }).map((p) => p.id);
    expect(ids).toEqual(["google"]);
  });

  it("keeps the email provider and falls back to a disabled provider", () => {
    const smtp = {
      AUTH_SMTP_HOST: "smtp.test",
      AUTH_SMTP_PORT: "587",
      AUTH_SMTP_USER: "u",
      AUTH_SMTP_PASS: "p",
      AUTH_SMTP_FROM: "a@b.test",
    };
    expect(buildProviders({ ...env, ...smtp }).map((p) => p.id)).toEqual(["supabase", "email"]);
    const email = buildProviders({ ...env, ...smtp })[1] as unknown as { options: Record<string, unknown> };
    expect(email.options).toMatchObject({
      maxAge: 600,
      sendVerificationRequest: sendSignInCodeEmail,
      normalizeIdentifier: normalizeEmailAddress,
      from: "a@b.test",
    });
    expect((email.options.generateVerificationToken as () => string)()).toMatch(/^[0-9]{6}$/);
    expect(buildProviders({ NEXT_PUBLIC_GOOGLE_AUTH_VIA: "direct" }).map((p) => p.id)).toEqual(["credentials"]);
  });
});

describe("Google sign-in through Supabase, end to end in NextAuth", () => {
  it("starts at Supabase with PKCE, the callback and Google's scopes", async () => {
    const { adapter, codeStore } = memoryAdapter();
    const { start, cookies } = await startSignIn(buildAuthOptions(adapter, codeStore, env));
    const loc = new URL(start.redirect!);
    expect(loc.origin + loc.pathname).toBe(`${SB}/auth/v1/authorize`);
    expect(loc.searchParams.get("provider")).toBe("google");
    expect(loc.searchParams.get("redirect_to")).toBe(`${APP}/api/auth/callback/supabase`);
    expect(loc.searchParams.get("scope")).toBe("email profile");
    expect(loc.searchParams.get("prompt")).toBe("select_account");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(cookies)).toContain("__Secure-next-auth.pkce.code_verifier");
  });

  it("signs in a new user, keeps no Supabase tokens, and creates a database session", async () => {
    const { adapter, codeStore, users, accounts, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, codeStore, env);
    vi.stubGlobal("fetch", fakeSupabase(googleUser(), calls));
    const { start, cookies } = await startSignIn(options);
    const challenge = new URL(start.redirect!).searchParams.get("code_challenge");

    const res = await AuthHandler({
      req: { action: "callback", providerId: "supabase", method: "GET", origin: APP, query: { code: "c1" }, cookies },
      options,
    });

    expect(res.redirect).toBe(`${APP}/t/abc`);
    const tokenCall = calls.find((c) => c.url.includes("/auth/v1/token"))!;
    const body = JSON.parse(String(tokenCall.init!.body));
    expect(body.auth_code).toBe("c1");
    expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(challenge);
    expect((tokenCall.init!.headers as Record<string, string>).apikey).toBe("anon-test");
    expect(calls.some((c) => c.url === `${SB}/rest/v1/rpc/ensure_profile`)).toBe(true);

    expect([...users.values()]).toMatchObject([{ email: "alice@example.com", name: "Alice Example" }]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ provider: "supabase", type: "oauth", providerAccountId: googleUser().id });
    expect(Object.keys(accounts[0]).sort()).toEqual(["provider", "providerAccountId", "type", "userId"]);
    expect(sessions).toHaveLength(1);
    expect(cookieMap(res.cookies)["__Secure-next-auth.session-token"]).toBe(sessions[0].sessionToken);
  });

  it("links an existing UpvoteMe user by email, so their id (topics, votes) is kept", async () => {
    const { adapter, codeStore, users, accounts } = memoryAdapter();
    users.set("old-google-user", {
      id: "old-google-user",
      email: "alice@example.com",
      name: "Alice",
      emailVerified: null,
    } as AdapterUser);
    const options = buildAuthOptions(adapter, codeStore, env);
    vi.stubGlobal("fetch", fakeSupabase(googleUser(), calls));
    const { cookies } = await startSignIn(options);

    await AuthHandler({
      req: { action: "callback", providerId: "supabase", method: "GET", origin: APP, query: { code: "c1" }, cookies },
      options,
    });

    expect(adapter.createUser).not.toHaveBeenCalled();
    expect(accounts).toMatchObject([{ userId: "old-google-user", provider: "supabase" }]);
  });

  it("refuses a Supabase user whose email Google did not vouch for", async () => {
    const { adapter, codeStore, users, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, codeStore, env);
    vi.stubGlobal(
      "fetch",
      fakeSupabase(googleUser({ identities: [{ provider: "email" }], app_metadata: { providers: ["email"] } }), calls),
    );
    const { cookies } = await startSignIn(options);

    const res = await AuthHandler({
      req: { action: "callback", providerId: "supabase", method: "GET", origin: APP, query: { code: "c1" }, cookies },
      options,
    });

    expect(res.redirect).toContain("error=AccessDenied");
    expect(users.size).toBe(0);
    expect(sessions).toHaveLength(0);
  });

  it("fails without the PKCE cookie (a callback from another browser)", async () => {
    const { adapter, codeStore, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, codeStore, env);
    vi.stubGlobal("fetch", fakeSupabase(googleUser(), calls));

    const res = await AuthHandler({
      req: { action: "callback", providerId: "supabase", method: "GET", origin: APP, query: { code: "c1" }, cookies: {} },
      options,
    });

    expect(res.redirect).toContain("error=");
    expect(sessions).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/auth/v1/token"))).toBe(false);
  });

  it("reports a cancelled Google consent", async () => {
    const { adapter, codeStore, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, codeStore, env);
    const { cookies } = await startSignIn(options);

    const res = await AuthHandler({
      req: {
        action: "callback",
        providerId: "supabase",
        method: "GET",
        origin: APP,
        query: { error: "access_denied", error_description: "cancelled" },
        cookies,
      },
      options,
    });

    expect(res.redirect).toContain("error=");
    expect(sessions).toHaveLength(0);
  });
});

/**
 * Sign-in by emailed code (NextAuth's Email provider with a 6-digit token)
 * through the installed nodemailer, with a fake SMTP wire. Each request gets
 * the CodeContext the route would give it (src/lib/sign-in-code-route.ts):
 * the code is mailed with no sign-in link and tied to the asking browser's
 * cookie, the form's POST signs the user in from that browser with no
 * NextAuth cookies, and nobody else can use up or void the code.
 */
describe("Sign-in by emailed code, end to end in NextAuth and nodemailer", () => {
  // The code email is sent by src/lib/sign-in-code-email.ts, which uses the
  // ESM default export, so the fake goes there.
  const smtpEnv = {
    AUTH_SMTP_HOST: "smtp.test",
    AUTH_SMTP_PORT: "587",
    AUTH_SMTP_USER: "u",
    AUTH_SMTP_PASS: "p",
    AUTH_SMTP_FROM: "UpvoteMe <login@upvoteme.test>",
  };
  const SECRET = "test-secret";
  const nextAuthHash = (code: string) => createHash("sha256").update(`${code}${SECRET}`).digest("hex");
  const COOKIE = codeCookie(APP).name;

  /**
   * A browser: its sign-in code cookie (null until a code is stored for it)
   * and its known-browser cookie (null until it signs in).
   */
  type Browser = { key: string | null; known: string | null };
  const browser = (): Browser => ({ key: null, known: null });

  /**
   * The app with an in-memory database. NextAuth's route handler sets
   * `secret` from AUTH_SECRET; set it the same way here, since the bare core
   * handler otherwise derives one from the options object. `fixCode` makes
   * every code issued from then on the given one (to force equal codes).
   */
  function app() {
    const memory = memoryAdapter();
    let fixed: string | null = null;
    const options = (context?: CodeContext, onSignedIn?: (email: string) => void) => {
      const built = {
        ...buildAuthOptions(memory.adapter, memory.codeStore, { ...env, ...smtpEnv, AUTH_SECRET: SECRET }, context, onSignedIn),
        secret: SECRET,
      };
      if (fixed) {
        const email = built.providers.find((p) => p.id === "email") as unknown as { options: Record<string, unknown> };
        const code = fixed;
        email.options.generateVerificationToken = () => code;
      }
      return built;
    };
    return { ...memory, options, fixCode: (code: string) => (fixed = code) };
  }
  type App = ReturnType<typeof app>;

  /** CSRF, then POST /signin/email, as the form does; the route's cookie handling, as it does it. */
  async function requestCode(
    site: App,
    from: Browser,
    email: string,
    client: string | null = "192.0.2.1",
    callbackUrl = `${APP}/t/abc`,
  ) {
    const csrf = await AuthHandler<{ csrfToken: string }>({ req: { action: "csrf", method: "GET", origin: APP }, options: site.options() });
    const key = from.key ?? newBrowserKey();
    let stored = false;
    const res = await AuthHandler({
      req: {
        action: "signin",
        providerId: "email",
        method: "POST",
        origin: APP,
        cookies: cookieMap(csrf.cookies),
        body: { csrfToken: csrf.body!.csrfToken, email, callbackUrl },
      },
      options: site.options({ kind: "request", browserKey: key, client, knownBrowser: from.known, onStored: () => (stored = true) }),
    });
    if (stored) from.key = key;
    return res;
  }

  /**
   * The code form's POST, through the route's codeCallbackRequest and then
   * NextAuth's callback, carrying only the browser's code cookie (no
   * NextAuth cookies), or no cookie at all. As the route does, a sign-in
   * that starts a session marks the browser known for that address.
   */
  async function typeCode(site: App, from: Browser, email: string, code: string, callbackUrl = "/t/abc") {
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" };
    if (from.key) headers.Cookie = `${COOKIE}=${from.key}`;
    const { request, response, browserKey } = await codeCallbackRequest(
      new NextRequest(`${APP}/api/auth/callback/email`, {
        method: "POST",
        headers,
        body: new URLSearchParams({ email, code, callbackUrl }).toString(),
      }),
      APP,
    );
    if (response) return { redirect: ((await response.json()) as { url: string }).url, cookies: [] };
    let signedIn: string | null = null;
    const res = await AuthHandler({
      req: {
        action: "callback",
        providerId: "email",
        method: "POST",
        origin: APP,
        query: Object.fromEntries(request.nextUrl.searchParams),
        body: Object.fromEntries(new URLSearchParams(await request.text())),
        cookies: {},
      },
      options: site.options({ kind: "code", browserKey }, (who) => (signedIn = who)),
    });
    if (signedIn && cookieMap(res.cookies)["__Secure-next-auth.session-token"]) {
      from.known = issueKnownBrowser(normalizeEmailAddress(signedIn), SECRET, new Date());
    }
    return res;
  }

  /** A GET to the email callback with an old-style link token, as the route passes it on. */
  function openLink(site: App, email: string, token: string) {
    return AuthHandler({
      req: {
        action: "callback",
        providerId: "email",
        method: "GET",
        origin: APP,
        query: { callbackUrl: `${APP}/t/abc`, token, email },
        cookies: {},
      },
      options: site.options({ kind: "link" }),
    });
  }

  const codeIn = (text: string) => text.match(/sign-in code is ([0-9]{6})\b/)![1];
  const attemptRows = (site: App) => site.tokens.filter((t) => t.identifier.startsWith("Sign-in code attempt"));

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("mails a 6-digit code and no sign-in link, and the code signs the user in, in the browser that asked", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const laptop = browser();

    const res = await requestCode(site, laptop, "  Alice@Example.com ");

    expect(res.redirect).toBe(`${APP}/api/auth/verify-request?provider=email&type=email`);
    expect(laptop.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail.smtp).toEqual({ host: "smtp.test", port: 587, auth: { user: "u", pass: "p" } });
    expect(mail.envelope).toEqual({ from: "login@upvoteme.test", to: ["alice@example.com"] });
    expect(mail.raw).toMatch(/^Subject: Your UpvoteMe sign-in code\r$/m);
    const code = codeIn(mail.text);
    expect(mail.raw).not.toContain("/api/auth/callback");
    expect(mail.raw).not.toContain("token=");
    expect(mail.text).toContain(`${APP}/signin?callbackUrl=/t/abc`);

    const codeRows = site.tokens.filter((t) => t.identifier === codeIdentifier("alice@example.com", laptop.key!));
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0].token).toBe(bindCode("alice@example.com", laptop.key!, nextAuthHash(code)));
    expect(codeRows[0].expires.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(codeRows[0].expires.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    const callback = await typeCode(site, laptop, "alice@EXAMPLE.com", `${code.slice(0, 3)} ${code.slice(3)}`);

    expect(callback.redirect).toBe(`${APP}/t/abc`);
    expect([...site.users.values()]).toMatchObject([{ email: "alice@example.com" }]);
    expect(site.sessions).toHaveLength(1);
    expect(cookieMap(callback.cookies)["__Secure-next-auth.session-token"]).toBe(site.sessions[0].sessionToken);
    expect(site.tokens.filter((t) => t.identifier.includes("alice@example.com") && !t.identifier.startsWith("Sign-in code sent"))).toEqual([
      expect.objectContaining({ identifier: "Sign-in code wait: alice@example.com" }),
    ]);
  });

  it("does not take the code in another browser, which leaves it working in the one that asked", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const laptop = browser();
    await requestCode(site, laptop, "alice@example.com");
    const code = codeIn(sent[0].text);

    expect((await typeCode(site, browser(), "alice@example.com", code)).redirect).toContain("error=Verification");
    expect((await typeCode(site, { key: newBrowserKey(), known: null }, "alice@example.com", code)).redirect).toContain("error=Verification");
    expect(site.sessions).toHaveLength(0);
    expect((await typeCode(site, laptop, "alice@example.com", code)).redirect).toBe(`${APP}/t/abc`);
  });

  it("answers a wrong code with Verification, and the right code still works", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const laptop = browser();
    await requestCode(site, laptop, "alice@example.com");
    const code = codeIn(sent[0].text);
    const wrong = code === "000000" ? "000001" : "000000";

    expect((await typeCode(site, laptop, "alice@example.com", wrong)).redirect).toBe(`${APP}/api/auth/error?error=Verification`);
    expect(site.sessions).toHaveLength(0);
    expect((await typeCode(site, laptop, "alice@example.com", code)).redirect).toBe(`${APP}/t/abc`);
    expect(site.sessions).toHaveLength(1);
  });

  it("refuses the 6th try, even with the right code, after 5 wrong codes", async () => {
    fakeSmtp(nodemailer);
    const site = app();
    site.fixCode("123456");
    const laptop = browser();
    await requestCode(site, laptop, "alice@example.com");

    for (const wrong of ["000001", "000002", "000003", "000004", "000005"]) {
      expect((await typeCode(site, laptop, "alice@example.com", wrong)).redirect).toContain("error=Verification");
    }
    expect((await typeCode(site, laptop, "alice@example.com", "123456")).redirect).toContain("error=Verification");
    expect(site.sessions).toHaveLength(0);
  });

  it("lets two addresses get the same code, each signing in only its own address", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    site.fixCode("123456");
    const alices = browser();
    const bobs = browser();

    expect((await requestCode(site, alices, "alice@example.com")).redirect).toContain("/verify-request");
    expect((await requestCode(site, bobs, "bob@example.com", "192.0.2.2")).redirect).toContain("/verify-request");
    expect(sent.map((m) => codeIn(m.text))).toEqual(["123456", "123456"]);

    expect((await typeCode(site, bobs, "alice@example.com", "123456")).redirect).toContain("error=Verification");
    expect((await typeCode(site, bobs, "bob@example.com", "123456")).redirect).toBe(`${APP}/t/abc`);
    expect((await typeCode(site, alices, "alice@example.com", "123456")).redirect).toBe(`${APP}/t/abc`);
    expect([...site.users.values()].map((u) => u.email).sort()).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("refuses a second code within a minute (EmailCodeWait), sends nothing, and keeps the first code and cookie", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const laptop = browser();
    await requestCode(site, laptop, "alice@example.com");
    const key = laptop.key;

    vi.setSystemTime(new Date("2026-11-20T10:00:59Z"));
    expect((await requestCode(site, laptop, "alice@example.com")).redirect).toBe(`${APP}/api/auth/error?error=EmailCodeWait`);
    expect(sent).toHaveLength(1);
    expect(laptop.key).toBe(key);
    expect((await typeCode(site, laptop, "alice@example.com", codeIn(sent[0].text))).redirect).toBe(`${APP}/t/abc`);
  });

  it("a new code from the same browser, a minute later, voids its old one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const laptop = browser();
    site.fixCode("111111");
    await requestCode(site, laptop, "alice@example.com");

    vi.setSystemTime(new Date("2026-11-20T10:01:01Z"));
    site.fixCode("222222");
    expect((await requestCode(site, laptop, "alice@example.com")).redirect).toContain("/verify-request");
    expect(sent.map((m) => codeIn(m.text))).toEqual(["111111", "222222"]);

    expect((await typeCode(site, laptop, "alice@example.com", "111111")).redirect).toContain("error=Verification");
    expect((await typeCode(site, laptop, "alice@example.com", "222222")).redirect).toBe(`${APP}/t/abc`);
  });

  it("a code expires after 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const laptop = browser();
    await requestCode(site, laptop, "alice@example.com");

    vi.setSystemTime(new Date("2026-11-20T10:10:01Z"));
    expect((await typeCode(site, laptop, "alice@example.com", codeIn(sent[0].text))).redirect).toContain("error=Verification");
    expect(site.sessions).toHaveLength(0);
  });

  it.each([
    ["/t/abc?root=c1", `${APP}/t/abc?root=c1`],
    ["//evil.example", `${APP}/`],
    ["https://evil.example/", `${APP}/`],
    ["/..//evil.example", `${APP}/`],
  ])("keeps a sanitised callbackUrl (%s) through the code", async (callbackUrl, landing) => {
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const laptop = browser();
    await requestCode(site, laptop, "alice@example.com");
    expect((await typeCode(site, laptop, "alice@example.com", codeIn(sent[0].text), callbackUrl)).redirect).toBe(landing);
  });

  it("still signs in with a link sent before codes, until it expires", async () => {
    const site = app();
    const link = "c0ffee".repeat(10) + "c0ff";
    site.tokens.push({ identifier: "alice@example.com", token: nextAuthHash(link), expires: new Date(Date.now() + 3_600_000) });
    expect((await openLink(site, "alice@example.com", link)).redirect).toBe(`${APP}/t/abc`);
    expect(site.sessions).toHaveLength(1);
  });

  describe("no lockout by outsiders", () => {
    it("a script posting wrong codes for the victim, with no cookie or its own, neither counts nor voids the victim's code", async () => {
      const { sent } = fakeSmtp(nodemailer);
      const site = app();
      site.fixCode("987654");
      const victim = browser();
      await requestCode(site, victim, "alice@example.com");
      const script = browser();
      site.fixCode("111111");
      await requestCode(site, script, "mallory@example.com", "203.0.113.66"); // the script's own cookie

      for (let i = 0; i < 60; i++) {
        const guess = String(i).padStart(6, "0");
        expect((await typeCode(site, browser(), "alice@example.com", guess)).redirect).toContain("error=Verification");
        expect((await typeCode(site, script, "alice@example.com", guess)).redirect).toContain("error=Verification");
      }
      expect(attemptRows(site)).toEqual([]);
      expect(sent).toHaveLength(2);
      expect((await typeCode(site, victim, "alice@example.com", "987654")).redirect).toBe(`${APP}/t/abc`);
    });

    it("GETs with old-style link tokens for the victim never count against or void the code", async () => {
      fakeSmtp(nodemailer);
      const site = app();
      site.fixCode("987654");
      const victim = browser();
      await requestCode(site, victim, "alice@example.com");

      for (let i = 0; i < 60; i++) {
        expect((await openLink(site, "alice@example.com", i.toString(16).padStart(64, "0"))).redirect).toContain("error=Verification");
      }
      expect(attemptRows(site)).toEqual([]);
      expect((await typeCode(site, victim, "alice@example.com", "987654")).redirect).toBe(`${APP}/t/abc`);
    });

    it("an outsider asking for a code for the victim's address leaves the victim's code working", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
      const { sent } = fakeSmtp(nodemailer);
      const site = app();
      site.fixCode("987654");
      const victim = browser();
      await requestCode(site, victim, "alice@example.com");

      vi.setSystemTime(new Date("2026-11-20T10:01:01Z"));
      site.fixCode("555555");
      const outsider = browser();
      expect((await requestCode(site, outsider, "alice@example.com", "203.0.113.66")).redirect).toContain("/verify-request");
      expect(sent).toHaveLength(2);
      expect((await typeCode(site, victim, "alice@example.com", "987654")).redirect).toBe(`${APP}/t/abc`);
    });

    it("one client can ask at most 3 codes an hour for one address; another client still can", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { sent } = fakeSmtp(nodemailer);
      const site = app();
      const at = (minutes: number) => vi.setSystemTime(new Date(Date.parse("2026-11-20T10:00:00Z") + minutes * 60_000));
      for (const m of [0, 2, 4]) {
        at(m);
        expect((await requestCode(site, browser(), "alice@example.com", "203.0.113.66")).redirect).toContain("/verify-request");
      }
      at(6);
      expect((await requestCode(site, browser(), "alice@example.com", "203.0.113.66")).redirect).toBe(
        `${APP}/api/auth/error?error=EmailCodeLimit`,
      );
      const victim = browser();
      expect((await requestCode(site, victim, "alice@example.com", "198.51.100.7")).redirect).toContain("/verify-request");
      expect(sent).toHaveLength(4);
      expect((await typeCode(site, victim, "alice@example.com", codeIn(sent[3].text))).redirect).toBe(`${APP}/t/abc`);
    });
  });

  it(`answers a client over its own limit (${CODE_LIMITS.client.hour} an hour, all addresses) with EmailCodeClientLimit`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    // The client's earlier requests this hour, for other addresses (sending 299 real codes is slow).
    for (let i = 0; i < CODE_LIMITS.client.hour - 1; i++) {
      site.tokens.push({ identifier: "Sign-in code client: 203.0.113.66", token: `earlier ${i}`, expires: new Date(Date.now() + 86_340_000) });
    }
    expect((await requestCode(site, browser(), "last@example.com", "203.0.113.66")).redirect).toContain("/verify-request");
    const before = site.tokens.length;
    expect((await requestCode(site, browser(), "late@example.com", "203.0.113.66")).redirect).toBe(
      `${APP}/api/auth/error?error=EmailCodeClientLimit`,
    );
    expect(sent).toHaveLength(1);
    expect(site.tokens).toHaveLength(before);
    // Another client is not affected.
    expect((await requestCode(site, browser(), "late@example.com", "198.51.100.7")).redirect).toContain("/verify-request");
  });

  it("without Netlify's client header, the per-address limits still apply", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const at = (minutes: number) => vi.setSystemTime(new Date(Date.parse("2026-11-20T10:00:00Z") + minutes * 60_000));
    for (let i = 0; i < CODE_LIMITS.address.hour; i++) {
      at(2 * i);
      expect((await requestCode(site, browser(), "alice@example.com", null)).redirect).toContain("/verify-request");
    }
    at(20);
    expect((await requestCode(site, browser(), "alice@example.com", null)).redirect).toBe(`${APP}/api/auth/error?error=EmailCodeLimit`);
    expect(sent).toHaveLength(CODE_LIMITS.address.hour);
    expect(site.tokens.some((t) => t.identifier.startsWith("Sign-in code client"))).toBe(false);
  });

  describe("a browser that has signed in as the address (known browser)", () => {
    const at = (minutes: number) => vi.setSystemTime(new Date(Date.parse("2026-11-20T10:00:00Z") + minutes * 60_000));
    const ok = (res: { redirect?: string }) => expect(res.redirect).toContain("/verify-request");
    const limit = (res: { redirect?: string }) => expect(res.redirect).toBe(`${APP}/api/auth/error?error=EmailCodeLimit`);

    /** The victim signs in once on the laptop, then a stranger uses up the address's day from three /64s. */
    async function attacked() {
      vi.useFakeTimers({ toFake: ["Date"] });
      const mail = fakeSmtp(nodemailer);
      const site = app();
      const laptop = browser();
      at(0);
      ok(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      expect((await typeCode(site, laptop, "alice@example.com", codeIn(mail.sent[0].text))).redirect).toBe(`${APP}/t/abc`);
      expect(laptop.known).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);

      // 11 requests, each from a fresh browser, a little over a minute apart:
      // with the victim's, the address's 6 an hour and then its 12 a day.
      const nets = ["2001:db8:0:a::/64", "2001:db8:0:b::/64", "2001:db8:0:c::/64"];
      const plan: [number, string][] = [
        [2, nets[0]], [4, nets[0]], [6, nets[0]], [8, nets[1]], [10, nets[1]],
        [70, nets[0]], [72, nets[1]], [74, nets[1]], [76, nets[2]], [78, nets[2]], [80, nets[2]],
      ];
      for (const [m, net] of plan) {
        at(m);
        ok(await requestCode(site, browser(), "alice@example.com", net));
      }
      return { site, laptop, mail };
    }

    it("still gets a code and signs in after a stranger used up the address's codes for the day; a new browser does not", async () => {
      const { site, laptop, mail } = await attacked();
      at(82);
      limit(await requestCode(site, browser(), "alice@example.com", "2001:db8:0:d::/64"));
      limit(await requestCode(site, browser(), "alice@example.com", "198.51.100.7"));
      at(12 * 60);
      limit(await requestCode(site, browser(), "alice@example.com", "2001:db8:0:e::/64"));
      expect(mail.sent).toHaveLength(12);

      ok(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      expect(mail.sent).toHaveLength(13);
      expect((await typeCode(site, laptop, "alice@example.com", codeIn(mail.sent[12].text))).redirect).toBe(`${APP}/t/abc`);
      expect(site.sessions).toHaveLength(2);
    });

    it(`has its own ${CODE_LIMITS.knownBrowser.hour} an hour and ${CODE_LIMITS.knownBrowser.day} a day, and still waits a minute between codes`, async () => {
      const { site, laptop, mail } = await attacked();
      const sentBefore = mail.sent.length;
      at(100);
      ok(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      expect((await requestCode(site, laptop, "alice@example.com", "198.51.100.7")).redirect).toBe(
        `${APP}/api/auth/error?error=EmailCodeWait`,
      );
      at(102);
      ok(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      at(104);
      ok(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      at(106);
      limit(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      for (const m of [170, 172, 174]) {
        at(m);
        ok(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      }
      // The last code signs in, in the browser that asked for it (a copy, so
      // the new known-browser cookie that sign-in sets is not used below).
      at(175);
      expect((await typeCode(site, { ...laptop }, "alice@example.com", codeIn(mail.sent.at(-1)!.text))).redirect).toBe(`${APP}/t/abc`);
      at(240);
      limit(await requestCode(site, laptop, "alice@example.com", "198.51.100.7"));
      expect(mail.sent.length - sentBefore).toBe(CODE_LIMITS.knownBrowser.day);
    });

    it("is known only for the address it signed in as", async () => {
      const { site, laptop } = await attacked();
      at(100);
      expect(laptop.known).not.toBeNull();
      // A stranger's own cookie (for mallory), or one made with another secret, does not help.
      limit(await requestCode(site, { key: null, known: issueKnownBrowser("mallory@example.com", SECRET, new Date()) }, "alice@example.com", "2001:db8:0:f::/64"));
      limit(await requestCode(site, { key: null, known: issueKnownBrowser("alice@example.com", "another-secret", new Date()) }, "alice@example.com", "2001:db8:0:f::/64"));
      ok(await requestCode(site, browser(), "bob@example.com", "2001:db8:0:f::/64"));
    });
  });

  it.each(["a <alice@example.com>", "alice@example.com (x)", "x@y.co,alice@example.com", "alice@example.com;x.co"])(
    "refuses %j before anything is counted or sent",
    async (email) => {
      const { sent } = fakeSmtp(nodemailer);
      const site = app();
      expect((await requestCode(site, browser(), email)).redirect).toBe(`${APP}/api/auth/error?error=EmailSignin`);
      expect(sent).toHaveLength(0);
      expect(site.tokens).toEqual([]);
    },
  );

  it("refuses a code request or a code without the route's context", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    const csrf = await AuthHandler<{ csrfToken: string }>({ req: { action: "csrf", method: "GET", origin: APP }, options: site.options() });
    const res = await AuthHandler({
      req: {
        action: "signin",
        providerId: "email",
        method: "POST",
        origin: APP,
        cookies: cookieMap(csrf.cookies),
        body: { csrfToken: csrf.body!.csrfToken, email: "alice@example.com", callbackUrl: `${APP}/` },
      },
      options: site.options(),
    });
    expect(res.redirect).toBe(`${APP}/api/auth/error?error=EmailSignin`);
    expect(sent).toHaveLength(0);
    expect(site.tokens).toEqual([]);
  });

  it("never writes a code to the logs, and next-auth debug is off", async () => {
    const logged: unknown[][] = [];
    for (const level of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
    const { sent } = fakeSmtp(nodemailer);
    const site = app();
    expect(site.options().debug).toBeFalsy();
    expect(site.options().logger).toBeUndefined();
    site.fixCode("735194");
    const laptop = browser();

    await requestCode(site, laptop, "alice@example.com");
    await requestCode(site, laptop, "alice@example.com"); // refused: EmailCodeWait
    await typeCode(site, browser(), "alice@example.com", "735194"); // no cookie
    await typeCode(site, laptop, "alice@example.com", "000000");
    await typeCode(site, laptop, "alice@example.com", "735 194");
    await typeCode(site, laptop, "alice@example.com", "735194");

    expect(sent).toHaveLength(1);
    const text = logged.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a) ?? String(a))).join(" ")).join("\n");
    expect(text).not.toContain("735194");
    expect(text).not.toContain("735 194");
    expect(text).not.toContain(nextAuthHash("735194"));
    expect(text).not.toContain(laptop.key);
  });

  // GHSA-2x7j-588g-ccc2 and GHSA-v53p-9fqp-m79j: addresses that nodemailer
  // before 9.1.0 and 10.0.6 parsed in quadratic time (about 14 s and 24 s on
  // 7.0.13). They contain "," or spaces, so the stricter normalizer now
  // refuses them before nodemailer sees them, quickly.
  it.each([
    ["a long recipient list", Array.from({ length: 40_000 }, (_, i) => `a${i}`).join(",") + "@b.co"],
    ["a long run before the address", "[x]".repeat(40_000) + " y@b.co"],
  ])("refuses %s typed into the form, in linear time, sending nothing", async (_shape, email) => {
    const { sent } = fakeSmtp(nodemailer);
    const site = app();

    const started = performance.now();
    const res = await requestCode(site, browser(), email);
    const elapsed = performance.now() - started;

    expect(res.redirect).toBe(`${APP}/api/auth/error?error=EmailSignin`);
    expect(sent).toHaveLength(0);
    expect(elapsed).toBeLessThan(2_000);
  });
});
