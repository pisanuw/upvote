# UpvoteMe

[![CI](https://github.com/pisanuw/upvote/actions/workflows/ci.yml/badge.svg)](https://github.com/pisanuw/upvote/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**What:** A web app for private, unlisted topic threads with comments, file attachments, and upvoting — shareable by link, with no public discovery.
**Status:** Live at [upvoteme.netlify.app](https://upvoteme.netlify.app); CI green on `main`.
**Run:** `npm install` → set `.env` (see [Quick Start](#quick-start)) → `npm run dev`.

Built with Next.js (App Router), Prisma, and Supabase Postgres.

## Features

- Anyone can create a topic by default (no authentication required).
- Topic creation returns:
- participation URL: share with participants
- admin URL: keep private for moderation
- Optional auth-required voting mode:
- creator must be authenticated to enable it
- participants must sign in (Google or an emailed code) to vote
- Topic admin controls:
- lock or unlock comments
- delete topic and all comments
- if auth-required voting is enabled, admin can see who voted on each comment
- Comment attachments:
- upload files with a comment (up to 5 files, max 2 MB each)
- download any attachment from the topic thread
- Privacy model:
- no topic discovery/listing endpoint
- topics are only accessible via shared short URLs
- Auto-cleanup:
- topics are deleted after 30 days of inactivity
- lazy deletion on access
- optional scheduled cleanup endpoint

## Stack

- Next.js App Router + TypeScript
- Prisma + Supabase Postgres
- NextAuth (Auth.js) with Prisma adapter

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
```

3. Set your Supabase connection URL and storage settings in `.env`

```bash
DATABASE_URL="postgresql://postgres:[YOUR_PASSWORD]@db.[YOUR_PROJECT_REF].supabase.co:5432/postgres?schema=public"
SUPABASE_URL="https://[YOUR_PROJECT_REF].supabase.co"
SUPABASE_SERVICE_ROLE_KEY="[YOUR_SUPABASE_SERVICE_ROLE_KEY]"
SUPABASE_STORAGE_BUCKET="attachments"
```

4. Sync schema to Supabase

```bash
npm run prisma:push
```

5. Start dev server

```bash
npm run dev
```

Open http://localhost:3000

## Git Hooks

This repo ships a pre-commit hook that scans staged changes for secrets with
[gitleaks](https://github.com/gitleaks/gitleaks). Enable it once per clone:

```bash
git config core.hooksPath .githooks
brew install gitleaks   # if not already installed
```

The hook is a no-op (with a warning) when gitleaks is not installed, so it never
blocks commits unexpectedly.

## Environment Variables

See `.env.example` for all variables.

Minimum local variables:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `AUTH_SECRET`
- `NEXTAUTH_URL`

Google sign-in goes through the shared HintWise Supabase project
(`https://auth.hintwise.org`, see `src/lib/supabase-auth.ts`) and needs no
variables: the browser goes to Supabase, then Google, then back to
`/api/auth/callback/supabase`, and NextAuth keeps its database sessions as
before. Existing users are matched by their Google-verified email. Supabase
only returns to addresses on its allow-list (`https://*.hintwise.org/**`), so
Google sign-in works on `upvoteme.hintwise.org`, not on localhost or deploy
previews. Optional overrides: `SUPABASE_AUTH_URL`, `SUPABASE_AUTH_ANON_KEY`.

Rollback to the app's own Google OAuth client: set
`NEXT_PUBLIC_GOOGLE_AUTH_VIA=direct` plus `AUTH_GOOGLE_ID` and
`AUTH_GOOGLE_SECRET`, put `https://upvoteme.hintwise.org/api/auth/callback/google`
back on the Google client, and redeploy (the variable is read at build time).

For sign-in by emailed code (SMTP):

- `AUTH_SMTP_HOST`
- `AUTH_SMTP_PORT`
- `AUTH_SMTP_USER`
- `AUTH_SMTP_PASS`
- `AUTH_SMTP_FROM` (the sender of the sign-in email and of the new-comment email)

For the new-comment notification:

- `ADMIN_EMAIL` (optional): the address that receives the new-comment email.
  When unset, the email goes to `AUTH_SMTP_FROM`, which is usually a no-reply
  address. Set it as a plain (not secret-flagged) Netlify variable. A
  secret-flagged `builder@hintwise.org` would trip Netlify's secret scan,
  because the built footer contains `mailto:builder@hintwise.org`.

The email carries a 6-digit code, not a link (university mail scanners open
links and would use them up). A code lasts 10 minutes and works only in the
browser that asked for it (an httpOnly cookie), so nobody else can use it up;
5 wrong codes void it. An address gets at most one code a minute, 6 an hour
and 12 a day; one client, by the `x-nf-client-connection-ip` header Netlify
sets (IPv6 by /64), at most 3 an hour and 4 a day per address, and 300 an
hour and 1000 a day in all. Without that header the per-client limits are off
and the function logs one warning. A browser that has signed in as an address
holds a signed, year-long `known-browser` cookie (HMAC with `NEXTAUTH_SECRET`
or `AUTH_SECRET`); it gets its own 3 an hour and 6 a day for that address and
is not refused by the other limits, so a stranger who uses up an address's
codes can only stop new browsers. All numbers are in `CODE_LIMITS`
(`src/lib/sign-in-code.ts`). The limits are rows in the `VerificationToken`
table, so they hold on serverless (`src/lib/sign-in-code-store.ts`,
`src/lib/sign-in-code-route.ts`, `src/lib/known-browser.ts`). `NEXTAUTH_URL`
must be `https://upvoteme.hintwise.org`.

For scheduled cleanup endpoint:

- `CRON_SECRET`

## Supabase Storage Setup

1. Create a bucket (default: `attachments`) in Supabase Storage.
2. Keep the bucket private.
3. Set `SUPABASE_SERVICE_ROLE_KEY` only in server environments.
4. Attachment downloads are served through signed URLs generated by the API route.

## Netlify Notes

1. Add all environment variables in Netlify site settings.
2. Set build command to:

```bash
npm run build
```

3. Use Next.js runtime on Netlify.
4. This project is already configured for Supabase Postgres.
5. Optional cleanup cron:
- call `/api/cron/cleanup?token=YOUR_CRON_SECRET` daily.

## API Summary

- `POST /api/topics` create topic
- `GET /api/t/:code` get topic and comments
- `POST /api/t/:code/comments` add comment + optional files
- `POST /api/t/:code/votes` upvote/downvote
- `GET /api/t/:code/comments/:commentId/attachments/:attachmentId` download attachment
- `GET|PATCH|DELETE /api/a/:adminCode` admin read/update/delete
- `GET /api/cron/cleanup?token=...` remove inactive topics

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`, `refactor:`). A
`commit-msg` hook enforces this once you run `git config core.hooksPath .githooks`
(see [Git Hooks](#git-hooks)).

## License

[MIT](LICENSE) © Yusuf Pisan
