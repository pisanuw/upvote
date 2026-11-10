# Changes

Format: `YYYY-MM-DD [type] description` (max 200 chars). Types: decision, plan, doc, scope, code, note.

2026-06-10 [note] Initialized.

2026-06-10 [decision] Secret-hygiene audit: gitleaks history clean, no plaintext secrets. Untracked .env.local, tightened .gitignore. Kept .env.asc (RSA4096 ciphertext, key secure) per owner; no rotation/purge.

2026-06-10 [code] Added .githooks/pre-commit (gitleaks protect --staged) and set core.hooksPath=.githooks.

2026-06-10 [code] Fail-closed audit F2: constant-time secret compare via new src/lib/safe-equal.ts for CRON_SECRET (cron cleanup) and SUPERADMIN_SECRET (superadmin route + page). Tests added.

2026-06-10 [code] Fail-closed audit F5: rate-limit.ts comment corrected (NOT effective on serverless) and added expired-entry eviction + MAX_ENTRIES cap to bound memory. Eviction test added.

2026-06-10 [note] Fail-closed audit: no SSRF, no crypto fallbacks, auth.ts fail-closed. Email-notify catch now logs. Pre-existing: react-markdown not installed (1 test suite + tsc errors).

2026-06-10 [decision] Security upgrade: next 16.2.4->16.2.9 (+eslint-config-next), fast-uri override ^3.1.2. Clears both high advisories. Verified: tsc, 93 tests, next build, lint all pass.

2026-06-10 [note] Remaining audit items all moderate/low with fixAvailable=false (no safe fix): postcss/next moderate, next-auth (needs v5 major), nodemailer (no patch; vectors not user-controlled), dev-only Prisma tooling. Deferred.

2026-06-10 [code] CI gates (was NO CI): added .github/workflows/ci.yml (push+PR) running npm ci/lint/typecheck/test/build, added typecheck script, README badge. Build uses dummy env (data routes dynamic).

2026-06-10 [note] CI gate verified fail-closed locally: an injected failing test made npm test exit 1; removed -> exit 0. GitHub red-X-on-PR demo pending first push.

2026-06-10 [note] CI verified on GitHub: main run green; demo PR #2 with a failing test showed red X, then closed/branch deleted.

2026-06-10 [decision] Presentation audit: added MIT LICENSE (+package.json license), README what/status/run block + license/contributing sections, GitHub description/topics/homepage set. README claims verified true.

2026-06-10 [code] Adopted Conventional Commits: documented in AGENTS.md, added .githooks/commit-msg enforcement. Single squashed Initial commit noted (not rewritten); future work incremental.

2026-06-10 [code] Fresh-clone test found npm install failing: postinstall prisma generate threw on unset DATABASE_URL. Fixed prisma.config.ts to read env tolerantly (url: process.env.DATABASE_URL ?? "").

2026-06-10 [note] react-markdown/remark/rehype were declared in package.json but node_modules was out of sync; npm install synced them, fixing the markdown test suite (now 93 tests). No tracked change.

2026-06-10 [note] Session pushed 4 commits to origin/main; 2 commits (docs license/README, fix prisma config) committed locally and left for owner to push.

2026-06-23 [note] Supabase RLS advisory (rls_disabled_in_public) triage: UpvoteMe's 8 tables ALREADY have RLS enabled (deny-all; Prisma owner + service-role bypass). No _prisma_migrations table. Not the source.

2026-06-23 [scope] Found Supabase DB is SHARED: public schema also holds a 2nd app's ~19 tables (learning/tutoring platform). DB-wide ops affect that app; scope DB changes to UpvoteMe's 8 tables.

2026-06-23 [note] Advisory targets other app's 8 RLS-off tables: graded_events,judge_samples,mastery_attempts,path_events,session_summaries,student_paths,tracks,turn_events. Full anon CRUD grants = live exposure.

2026-06-23 [note] Read-only probe: all public tables grant anon/authenticated full CRUD, 0 policies anywhere, other app has 11 deny-all RLS tables -> backend-only; deny-all RLS on the 8 is the correct fix.

2026-06-23 [decision] Made NO DB changes (read-only only). Recommended owner apply deny-all RLS to the 8 other-app tables in THAT app's project (not UpvoteMe repo). Awaiting go-ahead.

2026-11-10 [code] netlify.toml 301s upvoteme.netlify.app to upvoteme.hintwise.org, the primary address since 9 Nov (NEXTAUTH_URL), so sign-in stays on one host.

2026-11-10 [code] Google sign-in via shared Supabase: NextAuth provider `supabase` (PKCE, auth.hintwise.org), users linked by verified email, no tokens stored; direct Google kept as rollback.

2026-11-10 [code] Google buttons follow Google's branding guidelines: Google's G (sha256-checked), light theme, Google's text; icon-only in the header on phones; email button equally prominent.
