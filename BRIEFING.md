# Briefing

- Purpose: UpvoteMe — private, unlisted topic threads with comments, attachments, and voting. Next.js App Router + TypeScript, Prisma + Supabase Postgres, NextAuth (Auth.js). Live at upvoteme.hintwise.org (upvoteme.netlify.app 301s there since 10 Nov 2026).
- Current scope: Maintain the public repo (github.com/pisanuw/upvote). 2026-06-10 hardening pass complete: secret hygiene, fail-closed security, CI gates, dependency advisories, history/presentation. Licensed MIT.
- Key decisions:
  - `.env.asc` (RSA-4096 / AES-256-OCB encrypted secrets bundle) is intentionally committed as an encrypted backup; GPG private key A4C59E8DCB190977 is held securely. Plaintext secrets never go in git — they live in the gitignored `.env` and in Netlify env settings.
  - Secret scanning + commit-message format enforced via `.githooks/` (pre-commit gitleaks, commit-msg Conventional Commits); activate per clone with `git config core.hooksPath .githooks`.
  - Conventional Commits required for all commits (documented in AGENTS.md).
  - CI (.github/workflows/ci.yml) gates on push+PR: npm ci, lint, typecheck, test, build. Node 20. Build step uses placeholder env vars since all data routes are dynamic (no DB at build).
  - Secrets compared in constant time (src/lib/safe-equal.ts) for CRON_SECRET and SUPERADMIN_SECRET.
  - Rate limiter (src/lib/rate-limit.ts) is best-effort in-memory only; NOT effective on serverless. No durable rate limiting yet.
  - next pinned at 16.2.9; fast-uri override ^3.1.2. Both high advisories cleared.
  - prisma.config.ts reads DATABASE_URL tolerantly so `prisma generate` / `npm install` work with zero config on a fresh clone.
  - The Supabase Postgres DB is SHARED with a second app (a learning/tutoring platform; ~19 extra tables in the public schema). DB-wide operations affect that app, so scope any DB change to UpvoteMe's 8 tables. All 8 already have RLS enabled (deny-all; backend bypasses via the Prisma `postgres` owner role + the service-role key). No `_prisma_migrations` table (schema applied via `prisma db push` + manual SQL in prisma/migrations/manual/).
  - Google sign-in goes through the shared HintWise Supabase project (auth.hintwise.org) since 10 Nov 2026: a NextAuth OAuth provider `supabase` (src/lib/supabase-auth.ts), PKCE, sessions still NextAuth database sessions. Only Google-verified emails sign in; existing users are linked by email. No Supabase tokens are stored. Rollback: NEXT_PUBLIC_GOOGLE_AUTH_VIA=direct (README). Magic link stays NextAuth's Email provider.
- Non-goals (for now):
  - Not migrating to next-auth v5 (would clear remaining moderate advisories but is a major migration). Remaining moderate/low advisories have no safe fix and are deferred.
  - No git history rewrite (single squashed Initial commit left as-is; work stays incremental going forward).
  - No durable/shared rate limiting until a real need arises.
