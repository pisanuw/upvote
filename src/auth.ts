import NextAuth, { getServerSession, type NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { buildAuthOptions } from "@/lib/auth-options";
import { prismaTokenStore, type CodeContext } from "@/lib/sign-in-code-store";

// Providers and callbacks live in src/lib/auth-options.ts so tests can run
// the whole sign-in flow with an in-memory adapter.
const codeStore = prismaTokenStore(prisma);

export const authOptions: NextAuthOptions = buildAuthOptions(PrismaAdapter(prisma), codeStore);

export const authHandler = NextAuth(authOptions);

/**
 * NextAuth's handler for one request that needs to know about the asking
 * browser (a sign-in code request or try, src/lib/sign-in-code-route.ts),
 * or to hear who signed in (to mark the browser as known for that address).
 */
export function authHandlerFor(context: CodeContext | undefined, onSignedIn?: (email: string) => void) {
  return NextAuth(buildAuthOptions(PrismaAdapter(prisma), codeStore, process.env, context, onSignedIn));
}

export function auth() {
  return getServerSession(authOptions);
}
