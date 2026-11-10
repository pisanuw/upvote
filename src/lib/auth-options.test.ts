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
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";
import { buildAuthOptions, buildProviders } from "./auth-options";
import type { SupabaseUser } from "./supabase-auth";

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
  };
  return { adapter, users, accounts, sessions };
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

  it("keeps the magic link and falls back to a disabled provider", () => {
    const smtp = {
      AUTH_SMTP_HOST: "smtp.test",
      AUTH_SMTP_PORT: "587",
      AUTH_SMTP_USER: "u",
      AUTH_SMTP_PASS: "p",
      AUTH_SMTP_FROM: "a@b.test",
    };
    expect(buildProviders({ ...env, ...smtp }).map((p) => p.id)).toEqual(["supabase", "email"]);
    expect(buildProviders({ NEXT_PUBLIC_GOOGLE_AUTH_VIA: "direct" }).map((p) => p.id)).toEqual(["credentials"]);
  });
});

describe("Google sign-in through Supabase, end to end in NextAuth", () => {
  it("starts at Supabase with PKCE, the callback and Google's scopes", async () => {
    const { adapter } = memoryAdapter();
    const { start, cookies } = await startSignIn(buildAuthOptions(adapter, env));
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
    const { adapter, users, accounts, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, env);
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
    const { adapter, users, accounts } = memoryAdapter();
    users.set("old-google-user", {
      id: "old-google-user",
      email: "alice@example.com",
      name: "Alice",
      emailVerified: null,
    } as AdapterUser);
    const options = buildAuthOptions(adapter, env);
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
    const { adapter, users, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, env);
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
    const { adapter, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, env);
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
    const { adapter, sessions } = memoryAdapter();
    const options = buildAuthOptions(adapter, env);
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
