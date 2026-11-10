import NextAuth, { getServerSession, type NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { buildAuthOptions } from "@/lib/auth-options";

// Providers and callbacks live in src/lib/auth-options.ts so tests can run
// the whole sign-in flow with an in-memory adapter.
export const authOptions: NextAuthOptions = buildAuthOptions(PrismaAdapter(prisma));

export const authHandler = NextAuth(authOptions);

export function auth() {
  return getServerSession(authOptions);
}
