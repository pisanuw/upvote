import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read tolerantly so `prisma generate` (which needs no URL) succeeds with
    // zero config on a fresh clone, keeping `npm install` (postinstall) working
    // before `.env` is set up. DB commands (migrate, db push) still get the real
    // value loaded from `.env` via dotenv above.
    url: process.env.DATABASE_URL ?? "",
  },
});
