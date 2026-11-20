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
import { codeCallbackRequest } from "./sign-in-code-route";
import { bindToAddress, type TokenStore } from "./sign-in-code-store";
import { sendSignInCodeEmail } from "./sign-in-code-email";
import { normalizeEmailAddress } from "./sign-in-code";
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
 * through the installed nodemailer, with a fake SMTP wire: the code is mailed
 * with no sign-in link, the form's POST (src/lib/sign-in-code-route.ts) signs
 * the user in from a browser with no cookies (another device), and the code
 * rows follow src/lib/sign-in-code-store.ts. A hostile address typed into the
 * form is still parsed in linear time.
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

  /**
   * NextAuth's route handler sets `secret` from AUTH_SECRET; set it the same
   * way here, since the bare core handler otherwise derives one from the
   * options object, which the Email provider's config merge changes.
   */
  const codeOptions = (adapter: Adapter, codeStore: TokenStore) => ({
    ...buildAuthOptions(adapter, codeStore, { ...env, ...smtpEnv }),
    secret: SECRET,
  });

  /** Makes every code this provider issues the given one (to force two equal codes). */
  function fixCode(options: ReturnType<typeof codeOptions>, code: string) {
    const email = options.providers.find((p) => p.id === "email") as unknown as { options: Record<string, unknown> };
    email.options.generateVerificationToken = () => code;
  }

  /** CSRF, then POST /signin/email, as the sign-in form does. */
  async function requestCode(options: ReturnType<typeof buildAuthOptions>, email: string, callbackUrl = `${APP}/t/abc`) {
    const csrf = await AuthHandler<{ csrfToken: string }>({
      req: { action: "csrf", method: "GET", origin: APP },
      options,
    });
    const csrfCookies = cookieMap(csrf.cookies);
    return AuthHandler({
      req: {
        action: "signin",
        providerId: "email",
        method: "POST",
        origin: APP,
        cookies: csrfCookies,
        body: { csrfToken: csrf.body!.csrfToken, email, callbackUrl },
      },
      options,
    });
  }

  /**
   * The code form's POST, through the route's codeCallbackRequest and then
   * NextAuth's callback, with no cookies at all (another browser or device).
   */
  async function typeCode(options: ReturnType<typeof buildAuthOptions>, email: string, code: string, callbackUrl = "/t/abc") {
    const { request, response } = await codeCallbackRequest(
      new NextRequest(`${APP}/api/auth/callback/email`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" },
        body: new URLSearchParams({ email, code, callbackUrl }).toString(),
      }),
    );
    if (response) return { redirect: ((await response.json()) as { url: string }).url, cookies: [] };
    return AuthHandler({
      req: {
        action: "callback",
        providerId: "email",
        method: "POST",
        origin: APP,
        query: Object.fromEntries(request.nextUrl.searchParams),
        body: Object.fromEntries(new URLSearchParams(await request.text())),
        cookies: {},
      },
      options,
    });
  }

  const codeIn = (text: string) => text.match(/sign-in code is ([0-9]{6})\b/)![1];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("mails a 6-digit code and no sign-in link, and the code signs the user in from another browser", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore, users, sessions, tokens } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);

    const res = await requestCode(options, "  Alice@Example.com ");

    expect(res.redirect).toBe(`${APP}/api/auth/verify-request?provider=email&type=email`);
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail.smtp).toEqual({ host: "smtp.test", port: 587, auth: { user: "u", pass: "p" } });
    expect(mail.envelope).toEqual({ from: "login@upvoteme.test", to: ["alice@example.com"] });
    expect(mail.raw).toMatch(/^Subject: Your UpvoteMe sign-in code\r$/m);
    const code = codeIn(mail.text);
    expect(mail.raw).not.toContain("/api/auth/callback");
    expect(mail.raw).not.toContain("token=");
    expect(mail.text).toContain(`${APP}/signin?callbackUrl=/t/abc`);

    const codeRows = tokens.filter((t) => t.identifier === "alice@example.com");
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0].token).toBe(bindToAddress("alice@example.com", nextAuthHash(code)));
    expect(codeRows[0].expires.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(codeRows[0].expires.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    const callback = await typeCode(options, "alice@EXAMPLE.com", `${code.slice(0, 3)} ${code.slice(3)}`);

    expect(callback.redirect).toBe(`${APP}/t/abc`);
    expect([...users.values()]).toMatchObject([{ email: "alice@example.com" }]);
    expect(sessions).toHaveLength(1);
    expect(cookieMap(callback.cookies)["__Secure-next-auth.session-token"]).toBe(sessions[0].sessionToken);
    expect(tokens.filter((t) => t.identifier === "alice@example.com")).toHaveLength(0);
  });

  it("answers a wrong code with Verification, and the right code still works", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore, sessions } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    await requestCode(options, "alice@example.com");
    const code = codeIn(sent[0].text);
    const wrong = code === "000000" ? "000001" : "000000";

    const failed = await typeCode(options, "alice@example.com", wrong);
    expect(failed.redirect).toBe(`${APP}/api/auth/error?error=Verification`);
    expect(sessions).toHaveLength(0);

    expect((await typeCode(options, "alice@example.com", code)).redirect).toBe(`${APP}/t/abc`);
    expect(sessions).toHaveLength(1);
  });

  it("refuses the 6th try, even with the right code, after 5 wrong codes", async () => {
    const { adapter, codeStore, sessions } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    fixCode(options, "123456");
    fakeSmtp(nodemailer);
    await requestCode(options, "alice@example.com");

    for (const wrong of ["000001", "000002", "000003", "000004", "000005"]) {
      expect((await typeCode(options, "alice@example.com", wrong)).redirect).toContain("error=Verification");
    }
    expect((await typeCode(options, "alice@example.com", "123456")).redirect).toContain("error=Verification");
    expect(sessions).toHaveLength(0);
  });

  it("lets two addresses get the same code, each signing in only its own address", async () => {
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore, users, sessions } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    fixCode(options, "123456");

    expect((await requestCode(options, "alice@example.com")).redirect).toContain("/verify-request");
    expect((await requestCode(options, "bob@example.com")).redirect).toContain("/verify-request");
    expect(sent.map((m) => codeIn(m.text))).toEqual(["123456", "123456"]);

    expect((await typeCode(options, "bob@example.com", "123456")).redirect).toBe(`${APP}/t/abc`);
    expect((await typeCode(options, "alice@example.com", "123456")).redirect).toBe(`${APP}/t/abc`);
    expect([...users.values()].map((u) => u.email).sort()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(sessions).toHaveLength(2);
  });

  it("refuses a second code within a minute (EmailCodeWait), sends nothing, and keeps the first code working", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore, sessions } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    await requestCode(options, "alice@example.com");

    vi.setSystemTime(new Date("2026-11-20T10:00:59Z"));
    expect((await requestCode(options, "alice@example.com")).redirect).toBe(`${APP}/api/auth/error?error=EmailCodeWait`);
    expect(sent).toHaveLength(1);

    expect((await typeCode(options, "alice@example.com", codeIn(sent[0].text))).redirect).toBe(`${APP}/t/abc`);
    expect(sessions).toHaveLength(1);
  });

  it("a new code, a minute later, voids the old one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore, sessions } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    fixCode(options, "111111");
    await requestCode(options, "alice@example.com");

    vi.setSystemTime(new Date("2026-11-20T10:01:01Z"));
    fixCode(options, "222222");
    expect((await requestCode(options, "alice@example.com")).redirect).toContain("/verify-request");
    expect(sent.map((m) => codeIn(m.text))).toEqual(["111111", "222222"]);

    expect((await typeCode(options, "alice@example.com", "111111")).redirect).toContain("error=Verification");
    expect((await typeCode(options, "alice@example.com", "222222")).redirect).toBe(`${APP}/t/abc`);
    expect(sessions).toHaveLength(1);
  });

  it("a code expires after 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore, sessions } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    await requestCode(options, "alice@example.com");

    vi.setSystemTime(new Date("2026-11-20T10:10:01Z"));
    expect((await typeCode(options, "alice@example.com", codeIn(sent[0].text))).redirect).toContain("error=Verification");
    expect(sessions).toHaveLength(0);
  });

  it.each([
    ["/t/abc?root=c1", `${APP}/t/abc?root=c1`],
    ["//evil.example", `${APP}/`],
    ["https://evil.example/", `${APP}/`],
    ["/..//evil.example", `${APP}/`],
  ])("keeps a sanitised callbackUrl (%s) through the code", async (callbackUrl, landing) => {
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    await requestCode(options, "alice@example.com");
    expect((await typeCode(options, "alice@example.com", codeIn(sent[0].text), callbackUrl)).redirect).toBe(landing);
  });

  it("still signs in with a link sent before codes, until it expires", async () => {
    const { adapter, codeStore, sessions, tokens } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    const link = "c0ffee".repeat(10) + "c0ff";
    tokens.push({ identifier: "alice@example.com", token: nextAuthHash(link), expires: new Date(Date.now() + 3_600_000) });

    const res = await AuthHandler({
      req: {
        action: "callback",
        providerId: "email",
        method: "GET",
        origin: APP,
        query: { callbackUrl: `${APP}/t/abc`, token: link, email: "alice@example.com" },
        cookies: {},
      },
      options,
    });
    expect(res.redirect).toBe(`${APP}/t/abc`);
    expect(sessions).toHaveLength(1);
  });

  it("never writes a code to the logs, and next-auth debug is off", async () => {
    const logged: unknown[][] = [];
    for (const level of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);
    expect(options.debug).toBeFalsy();
    expect(options.logger).toBeUndefined();
    fixCode(options, "735194");

    await requestCode(options, "alice@example.com");
    await requestCode(options, "alice@example.com"); // refused: EmailCodeWait
    await typeCode(options, "alice@example.com", "000000");
    await typeCode(options, "alice@example.com", "735 194");
    await typeCode(options, "alice@example.com", "735194");

    expect(sent).toHaveLength(1);
    const text = logged.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a) ?? String(a))).join(" ")).join("\n");
    expect(text).not.toContain("735194");
    expect(text).not.toContain("735 194");
    expect(text).not.toContain(nextAuthHash("735194"));
  });

  // GHSA-2x7j-588g-ccc2 and GHSA-v53p-9fqp-m79j. Both addresses pass
  // next-auth's normalizer (one "@", no quotes, a dot in the domain), and
  // nodemailer before 9.1.0 and 10.0.6 parsed them in quadratic time,
  // blocking the event loop: about 14 s and 24 s on 7.0.13. Linear on 10.x.
  it.each([
    ["a long recipient list", Array.from({ length: 40_000 }, (_, i) => `a${i}`).join(",") + "@b.co"],
    ["a long run before the address", "[x]".repeat(40_000) + " y@b.co"],
  ])("parses %s typed into the form in linear time", async (_shape, email) => {
    const { sent } = fakeSmtp(nodemailer);
    const { adapter, codeStore } = memoryAdapter();
    const options = codeOptions(adapter, codeStore);

    const started = performance.now();
    await requestCode(options, email);
    const elapsed = performance.now() - started;

    expect(sent).toHaveLength(1);
    expect(elapsed).toBeLessThan(2_000);
  });
});
