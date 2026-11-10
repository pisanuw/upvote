/**
 * Google sign-in through the shared HintWise Supabase project.
 *
 * A NextAuth OAuth provider whose authorization server is Supabase Auth:
 * the browser goes to Supabase's /authorize (provider=google, PKCE), then
 * Google, then Supabase's own callback (https://auth.hintwise.org/auth/v1/callback,
 * the one URI the Google client needs for every HintWise app), then back to
 * NextAuth's /api/auth/callback/supabase with ?code=. The code is exchanged
 * with the PKCE verifier NextAuth kept in its cookie. NextAuth then signs the
 * user in exactly as before: database sessions through the Prisma adapter,
 * and an existing UpvoteMe user is matched by email, so they keep their
 * topics and votes.
 *
 * Only a Supabase user whose email Google vouched for may sign in (see
 * verifiedGoogleEmail and allowSignIn); that is what makes linking by email
 * (allowDangerousEmailAccountLinking) safe here.
 */
import type { Account, Profile } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

export const SUPABASE_PROVIDER_ID = "supabase";

/**
 * The shared project's public values (custom domain of project
 * arktxlrlyceffyozdwhq; the anon key is public by design and also ships to
 * every HintWise browser app). SUPABASE_AUTH_URL / SUPABASE_AUTH_ANON_KEY
 * override them. They are separate from SUPABASE_URL, which this app uses
 * with the service-role key for attachment storage.
 */
export const DEFAULT_SUPABASE_AUTH_URL = "https://auth.hintwise.org";
// Public anon key (role "anon"), not a secret.
export const DEFAULT_SUPABASE_AUTH_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFya3R4bHJseWNlZmZ5b3pkd2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODEwMTAsImV4cCI6MjA5MjQ1NzAxMH0.Vuku-irT3kAHZYibK23q6dpyOEqV_Eg5zB78I3dyshE"; // gitleaks:allow

export interface SupabaseAuthSettings {
  url: string;
  anonKey: string;
}

/** The part of a Supabase Auth user this app reads. */
export interface SupabaseUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] } | null;
  identities?: { provider?: string }[] | null;
  user_metadata?: Record<string, unknown> | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export function supabaseAuthSettings(
  env: Record<string, string | undefined> = process.env,
): SupabaseAuthSettings {
  const url = env.SUPABASE_AUTH_URL?.trim() || DEFAULT_SUPABASE_AUTH_URL;
  return {
    url: url.replace(/\/+$/, ""),
    anonKey: env.SUPABASE_AUTH_ANON_KEY?.trim() || DEFAULT_SUPABASE_AUTH_ANON_KEY,
  };
}

/** The confirmed email of a user who signed in with Google, lower-cased, or null. */
export function verifiedGoogleEmail(user: SupabaseUser | null | undefined): string | null {
  if (!user?.email || !user.email_confirmed_at) return null;
  const providers = [
    user.app_metadata?.provider,
    ...(user.app_metadata?.providers ?? []),
    ...(user.identities ?? []).map((i) => i?.provider),
  ];
  return providers.includes("google") ? user.email.trim().toLowerCase() : null;
}

function metaString(user: SupabaseUser, keys: string[]): string | null {
  for (const key of keys) {
    const value = user.user_metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function supabaseDisplayName(user: SupabaseUser): string | null {
  return metaString(user, ["full_name", "name"]);
}

export function supabaseAvatar(user: SupabaseUser): string | null {
  const url = metaString(user, ["avatar_url", "picture"]);
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** NextAuth signIn callback: a Supabase sign-in needs a Google-verified email. */
export function allowSignIn({
  account,
  profile,
}: {
  account?: Account | null;
  profile?: Profile | null;
}): boolean {
  if (account?.provider !== SUPABASE_PROVIDER_ID) return true;
  return verifiedGoogleEmail(profile as SupabaseUser | null | undefined) !== null;
}

/**
 * Best effort: create or refresh the user's row in platform.profiles (the
 * shared project has no trigger on auth.users). Never throws; sign-in does
 * not depend on it.
 */
export async function ensurePlatformProfile(
  settings: SupabaseAuthSettings,
  accessToken: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${settings.url}/rest/v1/rpc/ensure_profile`, {
      method: "POST",
      headers: {
        apikey: settings.anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "content-profile": "platform",
      },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface SupabaseProviderOptions {
  /** NEXTAUTH_URL: where Supabase sends the user back. */
  appUrl?: string;
  settings?: SupabaseAuthSettings;
  fetchImpl?: FetchLike;
}

export function supabaseGoogleProvider(
  options: SupabaseProviderOptions = {},
): OAuthConfig<SupabaseUser> {
  const settings = options.settings ?? supabaseAuthSettings();
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const appUrl = (options.appUrl?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  const callbackUrl = `${appUrl}/api/auth/callback/${SUPABASE_PROVIDER_ID}`;
  const apiHeaders = { apikey: settings.anonKey, "content-type": "application/json" };

  return {
    id: SUPABASE_PROVIDER_ID,
    name: "Google",
    type: "oauth",
    // Supabase ignores the client id; openid-client needs one. No secret: the
    // code exchange is PKCE with the public anon key.
    clientId: "upvoteme",
    client: { token_endpoint_auth_method: "none" },
    // Supabase returns no state of its own; PKCE binds the callback to the
    // browser that started it.
    checks: ["pkce"],
    allowDangerousEmailAccountLinking: true,
    authorization: {
      url: `${settings.url}/auth/v1/authorize`,
      params: {
        provider: "google",
        redirect_to: callbackUrl,
        // A scope parameter replaces Supabase's default Google scopes, and
        // openid-client would send "openid", which gives no email. Ask for
        // Supabase's defaults explicitly.
        scope: "email profile",
        prompt: "select_account",
      },
    },
    token: {
      url: `${settings.url}/auth/v1/token`,
      async request({ params, checks }) {
        const code = typeof params.code === "string" ? params.code : "";
        const verifier = checks.code_verifier ?? "";
        if (!code || !verifier) throw new Error("Supabase sign-in returned no code");
        const res = await fetchImpl(`${settings.url}/auth/v1/token?grant_type=pkce`, {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
        });
        if (!res.ok) throw new Error(`Supabase code exchange failed: HTTP ${res.status}`);
        const data = (await res.json()) as { access_token?: string };
        if (!data.access_token) throw new Error("Supabase code exchange gave no access token");
        return { tokens: { access_token: data.access_token, token_type: "bearer" } };
      },
    },
    userinfo: {
      url: `${settings.url}/auth/v1/user`,
      async request({ tokens }) {
        const accessToken = tokens.access_token ?? "";
        const res = await fetchImpl(`${settings.url}/auth/v1/user`, {
          headers: { ...apiHeaders, authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`Supabase user lookup failed: HTTP ${res.status}`);
        const user = (await res.json()) as SupabaseUser;
        if (verifiedGoogleEmail(user)) await ensurePlatformProfile(settings, accessToken, fetchImpl);
        return user;
      },
    },
    profile(user, tokens) {
      // NextAuth copies every token field onto the Account row it stores.
      // UpvoteMe needs none of Supabase's tokens after sign-in, so drop them
      // before that row is written (NextAuth builds it after this returns).
      for (const key of Object.keys(tokens)) delete (tokens as Record<string, unknown>)[key];
      return {
        id: user.id,
        email: user.email?.trim().toLowerCase() ?? null,
        name: supabaseDisplayName(user),
        image: supabaseAvatar(user),
      };
    },
  };
}
