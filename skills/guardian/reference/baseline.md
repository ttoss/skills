# Guardian — Baseline & reconciliation

## Phase 0 — Baseline discovery

Establish what the repo already enforces, so Guardian finds declared-but-unenforced rules and never re-flags what's enforced.

**Light** (default for `review`): `git status --short`, `git diff --stat HEAD`, `git diff HEAD`; the changed files; the nearest relevant `CLAUDE.md`/`.claude/rules`/`AGENTS.md`/`*.spec.md`; package scripts and the obvious focused check for the changed files.

**Deep** (audit, docs instructions, or when the diff touches config/CI/lint/test/coverage/hooks/boundaries/high-risk/instruction surfaces): resolve the **effective lint config incl. extended/shared configs** (a local config often just extends a package; reading it alone misses inherited rules/plugins); type strictness; test & coverage config (is coverage collected, thresholds set, gated?); CI gates (what actually runs on PR/merge); pre-commit/commit hooks; **all instruction surfaces across tools** (`CLAUDE.md` root+nested, `.claude/rules/**`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/**`, `.cursorrules`, `.windsurfrules`, `.devin/rules/**`). Output: what's enforced, what's prose-only, and where enforcement runs (local hook / CI / both).

**Discovery safety**: read-only by default — file reads and the toolchain's own print-config/inspection commands. Never run install, build, deploy, migration, postinstall, or arbitrary package scripts. If resolving config would execute project code with side effects, propose the command and ask first.

## Reconciliation — declared vs. enforced

For each stated quality rule, check enforcement:

- stated + enforced → fine; don't re-flag.
- stated + unenforced + mechanizable → finding: codify it.
- stated + unenforced + questionable rule → finding: fix the rule (rewrite/remove); never codify badness.
- enforced + unstated → fine; document only if surprising.
- code violates a stated rule → code-level finding.

Also detect contradictions between surfaces and hand-maintained duplication/drift across tools.
