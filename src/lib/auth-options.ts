import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Google from "next-auth/providers/google";
import Email from "next-auth/providers/email";
import Credentials from "next-auth/providers/credentials";
import { googleAuthMode } from "@/lib/google-sign-in";
import { allowSignIn, supabaseAuthSettings, supabaseGoogleProvider } from "@/lib/supabase-auth";

type Env = Record<string, string | undefined>;

/** The providers for this environment: Google (through Supabase by default), magic link. */
export function buildProviders(env: Env = process.env): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [];

  if (googleAuthMode(env.NEXT_PUBLIC_GOOGLE_AUTH_VIA) === "supabase") {
    providers.push(
      supabaseGoogleProvider({ appUrl: env.NEXTAUTH_URL, settings: supabaseAuthSettings(env) }),
    );
  } else if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
      }),
    );
  }

  if (
    env.AUTH_SMTP_HOST &&
    env.AUTH_SMTP_PORT &&
    env.AUTH_SMTP_USER &&
    env.AUTH_SMTP_PASS &&
    env.AUTH_SMTP_FROM
  ) {
    providers.push(
      Email({
        server: {
          host: env.AUTH_SMTP_HOST,
          port: Number(env.AUTH_SMTP_PORT),
          auth: {
            user: env.AUTH_SMTP_USER,
            pass: env.AUTH_SMTP_PASS,
          },
        },
        from: env.AUTH_SMTP_FROM,
      }),
    );
  }

  if (providers.length === 0) {
    providers.push(
      Credentials({
        name: "disabled",
        credentials: {},
        authorize: async () => null,
      }),
    );
  }

  return providers;
}

export function buildAuthOptions(adapter: Adapter, env: Env = process.env): NextAuthOptions {
  return {
    adapter,
    session: { strategy: "database" },
    providers: buildProviders(env),
    pages: {
      signIn: "/signin",
    },
    callbacks: {
      signIn: allowSignIn,
      session: ({ session, user }) => {
        if (session.user) {
          session.user.id = user.id;
        }
        return session;
      },
    },
  };
}
