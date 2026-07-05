# Guardian — Platform bindings (Claude Code)

These are the platform-specific mechanics Guardian relies on. The methodology (basis-form, dimensions, severity, the ladder rungs) is agent-agnostic; **this file isolates the Claude Code platform mechanics and is the primary file to swap when porting.** The durability ladder and doc-stewardship name Claude surfaces (`CLAUDE.md`, `.claude/rules`) as examples of the path-scoped rung — swap those names too; the rest of the skill stands.

## Instruction surfaces & loading

- Root `CLAUDE.md` (or `.claude/CLAUDE.md`) loads in full at session start; nested `CLAUDE.md` in subdirectories load on demand when a file there is read (co-located, directory-scoped).
- `.claude/rules/*.md` with `paths:` glob frontmatter are file-type/path-scoped (load when a matching file is read); without `paths:` they load always-on, like `.claude/CLAUDE.md`.
- `@import` in `CLAUDE.md` expands at launch (no context saving).
- Claude Code does not read `AGENTS.md` natively; import it (`@AGENTS.md`) or symlink.
- Precedence between a nested `CLAUDE.md` and a path-scoped rule for the same file is undefined — avoid overlap.
- Other tools' surfaces to discover during the Deep baseline: `.github/copilot-instructions.md`, `.github/instructions/**`, `.cursorrules`, `.windsurfrules`, `.devin/rules/**`.

## Enforcement mechanisms

`CLAUDE.md`/rules/skills are context, not enforcement — to block regardless of the model, use a hook. Where a check runs and what can block:

```txt
before a dangerous action      → PreToolUse hook (exit 2 blocks the call)
before stopping without checks  → Stop hook
after an edit, to flag/suggest  → PostToolUse hook (cannot prevent; advisory)
```

## Skill mechanics

- A skill's directory name is its command (`.claude/skills/guardian/` → `/guardian`). Its `SKILL.md` body stays in context for the whole session once invoked, so keep it lean and put depth in on-demand reference files; reference the skill's own files as `${CLAUDE_SKILL_DIR}/<path>`.
- `disable-model-invocation: true` = manual `/name` only.
- `allowed-tools` grants (does not restrict) tools without a prompt while the skill is active; `disallowed-tools` removes tools from the pool.
