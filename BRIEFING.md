# Briefing

- Purpose: UpvoteMe — private, unlisted topic threads with comments, attachments, and voting. Next.js App Router + TypeScript, Prisma + Supabase Postgres, NextAuth (Auth.js).
- Current scope: Maintain the public repo (github.com/pisanuw/upvote) with sound secret hygiene and quality gates.
- Key decisions:
  - `.env.asc` (RSA-4096 / AES-256-OCB encrypted secrets bundle) is intentionally committed as an encrypted backup; GPG private key A4C59E8DCB190977 is held securely. Plaintext secrets never go in git — they live in the gitignored `.env` and in Netlify env settings.
  - Secret scanning enforced via gitleaks pre-commit hook (`.githooks/`, activate with `core.hooksPath`).
- Non-goals: None recorded yet.
