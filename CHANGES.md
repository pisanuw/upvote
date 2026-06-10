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
