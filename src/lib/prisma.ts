import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

// Strip sslmode from the URL so pg-connection-string doesn't override our ssl config.
// Supabase's certificate chain includes intermediates that pg v8's strict verify-full rejects.
const strippedUrl = databaseUrl.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/[?&]$/, "");

const pool = new Pool({
  connectionString: strippedUrl,
  ssl: { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
