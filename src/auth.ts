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
 * NextAuth's handler for one sign-in code request, which needs to know the
 * asking browser and client (src/lib/sign-in-code-route.ts).
 */
export function authHandlerFor(context: CodeContext) {
  return NextAuth(buildAuthOptions(PrismaAdapter(prisma), codeStore, process.env, context));
}

export function auth() {
  return getServerSession(authOptions);
}
