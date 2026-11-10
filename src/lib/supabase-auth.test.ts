import { describe, it, expect, vi } from "vitest";
import {
  allowSignIn,
  DEFAULT_SUPABASE_AUTH_URL,
  ensurePlatformProfile,
  supabaseAuthSettings,
  supabaseAvatar,
  supabaseDisplayName,
  supabaseGoogleProvider,
  verifiedGoogleEmail,
  type SupabaseUser,
} from "./supabase-auth";
import { googleAuthMode, googleProviderId } from "./google-sign-in";

const googleUser = (over: Partial<SupabaseUser> = {}): SupabaseUser => ({
  id: "4f9c2b1e-0000-4000-8000-000000000001",
  email: "Alice@Example.com",
  email_confirmed_at: "2026-11-10T12:00:00Z",
  app_metadata: { provider: "google", providers: ["google"] },
  identities: [{ provider: "google" }],
  user_metadata: { full_name: "Alice Example", avatar_url: "https://lh3.googleusercontent.com/a/x" },
  ...over,
});

describe("google-sign-in", () => {
  it("defaults to Supabase; direct only when asked", () => {
    expect(googleAuthMode(undefined)).toBe("supabase");
    expect(googleAuthMode("")).toBe("supabase");
    expect(googleAuthMode(" Direct ")).toBe("direct");
    expect(googleAuthMode("something-else")).toBe("supabase");
    expect(googleProviderId("supabase")).toBe("supabase");
    expect(googleProviderId("direct")).toBe("google");
  });
});

describe("supabaseAuthSettings", () => {
  it("uses the shared project by default", () => {
    const s = supabaseAuthSettings({});
    expect(s.url).toBe(DEFAULT_SUPABASE_AUTH_URL);
    expect(s.anonKey.split(".")).toHaveLength(3);
  });

  it("takes overrides and trims a trailing slash", () => {
    expect(
      supabaseAuthSettings({ SUPABASE_AUTH_URL: "https://x.supabase.co/", SUPABASE_AUTH_ANON_KEY: "k" }),
    ).toEqual({ url: "https://x.supabase.co", anonKey: "k" });
  });
});

describe("verifiedGoogleEmail", () => {
  it("accepts a confirmed Google identity, lower-cased", () => {
    expect(verifiedGoogleEmail(googleUser())).toBe("alice@example.com");
  });

  it("accepts Google named only in identities", () => {
    expect(verifiedGoogleEmail(googleUser({ app_metadata: {} }))).toBe("alice@example.com");
  });

  it("refuses an unconfirmed email", () => {
    expect(verifiedGoogleEmail(googleUser({ email_confirmed_at: null }))).toBeNull();
  });

  it("refuses a user without a Google identity (e.g. a Supabase magic-link user)", () => {
    const u = googleUser({
      app_metadata: { provider: "email", providers: ["email"] },
      identities: [{ provider: "email" }],
    });
    expect(verifiedGoogleEmail(u)).toBeNull();
  });

  it("refuses a missing user or email", () => {
    expect(verifiedGoogleEmail(null)).toBeNull();
    expect(verifiedGoogleEmail(googleUser({ email: "" }))).toBeNull();
  });
});

describe("profile fields", () => {
  it("display name prefers full_name, then name", () => {
    expect(supabaseDisplayName(googleUser())).toBe("Alice Example");
    expect(supabaseDisplayName(googleUser({ user_metadata: { name: "Al" } }))).toBe("Al");
    expect(supabaseDisplayName(googleUser({ user_metadata: null }))).toBeNull();
  });

  it("avatar takes only an https URL", () => {
    expect(supabaseAvatar(googleUser())).toBe("https://lh3.googleusercontent.com/a/x");
    expect(supabaseAvatar(googleUser({ user_metadata: { picture: "javascript:alert(1)" } }))).toBeNull();
  });
});

describe("allowSignIn", () => {
  it("lets other providers through", () => {
    expect(allowSignIn({ account: { provider: "email", type: "email", providerAccountId: "a" } })).toBe(true);
  });

  it("needs a Google-verified email for Supabase", () => {
    const account = { provider: "supabase", type: "oauth" as const, providerAccountId: "a" };
    expect(allowSignIn({ account, profile: googleUser() as never })).toBe(true);
    expect(allowSignIn({ account, profile: googleUser({ email_confirmed_at: null }) as never })).toBe(false);
    expect(allowSignIn({ account, profile: null })).toBe(false);
  });
});

describe("ensurePlatformProfile", () => {
  const settings = { url: "https://sb.test", anonKey: "anon" };

  it("calls platform.ensure_profile with the user's token", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await ensurePlatformProfile(settings, "tok", fetchImpl)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sb.test/rest/v1/rpc/ensure_profile");
    expect(init.headers).toMatchObject({
      apikey: "anon",
      authorization: "Bearer tok",
      "content-profile": "platform",
    });
  });

  it("never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await ensurePlatformProfile(settings, "tok", fetchImpl)).toBe(false);
  });
});

describe("supabaseGoogleProvider", () => {
  it("asks Supabase for Google with email and profile scopes and the callback", () => {
    const p = supabaseGoogleProvider({
      appUrl: "https://upvoteme.hintwise.org/",
      settings: { url: "https://auth.hintwise.org", anonKey: "anon" },
    });
    expect(p.id).toBe("supabase");
    expect(p.checks).toEqual(["pkce"]);
    expect(p.authorization).toMatchObject({
      url: "https://auth.hintwise.org/auth/v1/authorize",
      params: {
        provider: "google",
        redirect_to: "https://upvoteme.hintwise.org/api/auth/callback/supabase",
        scope: "email profile",
        prompt: "select_account",
      },
    });
  });

  it("refuses a callback without a code", async () => {
    const p = supabaseGoogleProvider({ settings: { url: "https://sb.test", anonKey: "a" } });
    const request = (p.token as { request: (c: unknown) => Promise<unknown> }).request;
    await expect(request({ params: {}, checks: { code_verifier: "v" } })).rejects.toThrow(/no code/);
  });

  it("reports a refused code exchange or user lookup", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    const p = supabaseGoogleProvider({ settings: { url: "https://sb.test", anonKey: "a" }, fetchImpl });
    const token = (p.token as { request: (c: unknown) => Promise<unknown> }).request;
    await expect(token({ params: { code: "c" }, checks: { code_verifier: "v" } })).rejects.toThrow(/HTTP 400/);
    const userinfo = (p.userinfo as { request: (c: unknown) => Promise<unknown> }).request;
    await expect(userinfo({ tokens: { access_token: "t" } })).rejects.toThrow(/HTTP 400/);
  });

  it("refuses an exchange that returns no access token", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const p = supabaseGoogleProvider({ settings: { url: "https://sb.test", anonKey: "a" }, fetchImpl });
    const token = (p.token as { request: (c: unknown) => Promise<unknown> }).request;
    await expect(token({ params: { code: "c" }, checks: { code_verifier: "v" } })).rejects.toThrow(/no access token/);
  });

  it("does not call ensure_profile for an unverified user", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(googleUser({ email_confirmed_at: null })), { status: 200 }),
    );
    const p = supabaseGoogleProvider({ settings: { url: "https://sb.test", anonKey: "a" }, fetchImpl });
    const userinfo = (p.userinfo as { request: (c: unknown) => Promise<unknown> }).request;
    await userinfo({ tokens: { access_token: "t" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps the user and drops the tokens before NextAuth stores them", async () => {
    const p = supabaseGoogleProvider();
    const tokens: Record<string, unknown> = { access_token: "secret", token_type: "bearer" };
    const profile = await p.profile(googleUser(), tokens as never);
    expect(profile).toEqual({
      id: "4f9c2b1e-0000-4000-8000-000000000001",
      email: "alice@example.com",
      name: "Alice Example",
      image: "https://lh3.googleusercontent.com/a/x",
    });
    expect(tokens).toEqual({});
  });
});
