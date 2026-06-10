# Changes

Format: `YYYY-MM-DD [type] description` (max 200 chars). Types: decision, plan, doc, scope, code, note.

2026-06-10 [note] Initialized.

2026-06-10 [decision] Secret-hygiene audit: gitleaks history clean, no plaintext secrets. Untracked .env.local, tightened .gitignore. Kept .env.asc (RSA4096 ciphertext, key secure) per owner; no rotation/purge.

2026-06-10 [code] Added .githooks/pre-commit (gitleaks protect --staged) and set core.hooksPath=.githooks.

2026-06-10 [code] Fail-closed audit F2: constant-time secret compare via new src/lib/safe-equal.ts for CRON_SECRET (cron cleanup) and SUPERADMIN_SECRET (superadmin route + page). Tests added.

2026-06-10 [code] Fail-closed audit F5: rate-limit.ts comment corrected (NOT effective on serverless) and added expired-entry eviction + MAX_ENTRIES cap to bound memory. Eviction test added.

2026-06-10 [note] Fail-closed audit: no SSRF, no crypto fallbacks, auth.ts fail-closed. Email-notify catch now logs. Pre-existing: react-markdown not installed (1 test suite + tsc errors).
