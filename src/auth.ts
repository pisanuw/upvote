import NextAuth, { getServerSession, type NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Email from "next-auth/providers/email";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";

const providers: NextAuthOptions["providers"] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

if (
  process.env.AUTH_SMTP_HOST &&
  process.env.AUTH_SMTP_PORT &&
  process.env.AUTH_SMTP_USER &&
  process.env.AUTH_SMTP_PASS &&
  process.env.AUTH_SMTP_FROM
) {
  providers.push(
    Email({
      server: {
        host: process.env.AUTH_SMTP_HOST,
        port: Number(process.env.AUTH_SMTP_PORT),
        auth: {
          user: process.env.AUTH_SMTP_USER,
          pass: process.env.AUTH_SMTP_PASS,
        },
      },
      from: process.env.AUTH_SMTP_FROM,
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

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers,
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    session: ({ session, user }) => {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};

export const authHandler = NextAuth(authOptions);

export function auth() {
  return getServerSession(authOptions);
}
