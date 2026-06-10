<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit:
`type(optional-scope): summary`, where type is one of `feat`, `fix`, `chore`,
`docs`, `refactor`, `test`, `ci`, `build`, `perf`, `style`, `revert`.

- Keep commits small and incremental; prefer a branch + PR even when solo, since
  the PR is where review attaches.
- A `commit-msg` hook in `.githooks/` enforces the format. Activate hooks once per
  clone with `git config core.hooksPath .githooks`.
