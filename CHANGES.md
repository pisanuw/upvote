# Changes

Format: `YYYY-MM-DD [type] description` (max 200 chars). Types: decision, plan, doc, scope, code, note.

2026-06-10 [note] Initialized.

2026-06-10 [decision] Secret-hygiene audit: gitleaks history clean, no plaintext secrets. Untracked .env.local, tightened .gitignore. Kept .env.asc (RSA4096 ciphertext, key secure) per owner; no rotation/purge.

2026-06-10 [code] Added .githooks/pre-commit (gitleaks protect --staged) and set core.hooksPath=.githooks.
