import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Google from "next-auth/providers/google";
import Email from "next-auth/providers/email";
import Credentials from "next-auth/providers/credentials";
import { googleAuthMode } from "@/lib/google-sign-in";
import { allowSignIn, supabaseAuthSettings, supabaseGoogleProvider } from "@/lib/supabase-auth";
import { SIGN_IN_CODE_MINUTES, normalizeEmailAddress } from "@/lib/sign-in-code";
import { generateSignInCode, sendSignInCodeEmail } from "@/lib/sign-in-code-email";
import { claimCodeRequest, withSignInCodes, type CodeRequestVerdict, type TokenStore } from "@/lib/sign-in-code-store";

type Env = Record<string, string | undefined>;

/** The providers for this environment: Google (through Supabase by default), an emailed code. */
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
        // A 6-digit code in the email instead of a link (src/lib/sign-in-code.ts).
        maxAge: SIGN_IN_CODE_MINUTES * 60,
        generateVerificationToken: () => generateSignInCode(),
        sendVerificationRequest: sendSignInCodeEmail,
        normalizeIdentifier: normalizeEmailAddress,
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

/**
 * Ends a sign-in from the signIn callback with one of this app's error codes
 * (src/lib/sign-in-errors.ts). For an email request NextAuth answers with
 * .../error?error=String(error) (next-auth/core/routes/signin.js), so the
 * string form is the bare code.
 */
export class SignInRefusal extends Error {
  toString() {
    return this.message;
  }
}

const REFUSALS: Record<Exclude<CodeRequestVerdict, "ok">, string> = {
  wait: "EmailCodeWait",
  limit: "EmailCodeLimit",
};

/**
 * The adapter and the sign-in code's rows (src/lib/sign-in-code-store.ts):
 * codes are bound to their address, limited to MAX_WRONG_CODES tries, and
 * sent at most once a minute and five times an hour per address.
 */
export function buildAuthOptions(adapter: Adapter, codeStore: TokenStore, env: Env = process.env): NextAuthOptions {
  return {
    adapter: withSignInCodes(adapter, codeStore),
    session: { strategy: "database" },
    providers: buildProviders(env),
    pages: {
      signIn: "/signin",
    },
    callbacks: {
      signIn: async (params) => {
        if (params.email?.verificationRequest && params.account?.provider === "email") {
          let verdict: CodeRequestVerdict;
          try {
            verdict = await claimCodeRequest(codeStore, params.account.providerAccountId, new Date());
          } catch (error) {
            console.error("[sign-in code] could not check how often a code was sent", error);
            throw new SignInRefusal("EmailSignin");
          }
          if (verdict !== "ok") throw new SignInRefusal(REFUSALS[verdict]);
        }
        return allowSignIn(params);
      },
      session: ({ session, user }) => {
        if (session.user) {
          session.user.id = user.id;
        }
        return session;
      },
    },
  };
}
