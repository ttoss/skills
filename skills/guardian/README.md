# Guardian — an Agent Skill

Guardian keeps a repository in **basis-form**: its structure, code, scripts, and instructions written as a *basis* (the axes of the decision space), not as enumerated *cases*. It reviews and improves a repo's AI-readiness and migrates quality rules from prose into deterministic enforcement (lint, types, tests, CI, hooks).

Cross-agent — built on the [Agent Skills](https://agentskills.io) standard. Only `reference/bindings.md` is Claude Code-specific; swap that one file to port Guardian to another coding agent.

## Install

```bash
npx skills add ttoss/skills --skill guardian
```

## Use (Claude Code)

```
/guardian plan|review|pr|audit|improve|docs [task|path|finding-id]
```

- **plan** — turn a task into a bounded, verifiable plan
- **review** — review the current diff before commit
- **pr** — prepare a reviewable PR
- **audit** — bounded repo-health audit of a scope
- **improve** — fix one approved finding (migrate case→basis; promote to enforcement)
- **docs** — review/improve instruction surfaces

## Layout

- `SKILL.md` — router: identity, rules, severity, mode routing
- `reference/` — `basis-form` (the standard), `methodology` (dimensions), `baseline` (discovery + reconciliation), `enforcement` (promotion + checks), `bindings` (Claude Code specifics)
- `modes/` — `plan`, `review`, `pr`, `audit`, `improve`, `docs`

## License

MIT
