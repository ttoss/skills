# Guardian — an Agent Skill

Guardian keeps a repository in **basis-form**: its structure, code, scripts, and instructions written as a *basis* (the axes of the decision space), not as enumerated *cases*. It reviews and improves a repo's AI-readiness and migrates quality rules from prose into deterministic enforcement (lint, types, tests, CI, hooks).

Cross-agent — built on the [Agent Skills](https://agentskills.io) standard. `reference/bindings.md` isolates the Claude Code platform mechanics and is the primary file to swap when porting; the durability ladder also names Claude surfaces (`CLAUDE.md`, `.claude/rules`) as examples to swap.

## Install

```bash
npx skills add ttoss/skills --skill guardian
```

Scope the agent to avoid duplication. Without `--agent`, the CLI mirrors the skill into every supported agent's directory (e.g. both `.claude/skills/` and `.agents/skills/`). For Claude Code only:

```bash
npx skills add ttoss/skills --skill guardian --agent claude-code
```

Only install unscoped if the target repo also runs another agent (Copilot/Cursor/etc.) that should read the skill from its own directory.

## Use (Claude Code)

Manual only (`disable-model-invocation`). The first token selects the mode:

```
/guardian <mode> [task | path | finding-id]
```

| Mode      | Does                                                             | Argument                       | Writes              |
| --------- | --------------------------------------------------------------- | ------------------------------ | ------------------- |
| `plan`    | task → bounded, verifiable plan (axes, scope, risk class, tests) | task                           | no                  |
| `review`  | review the current diff before commit (findings + correction prompt) | — (uses the diff)          | no                  |
| `pr`      | prepare a reviewable PR package (does not replace `review`)      | —                              | no                  |
| `audit`   | bounded repo-health audit of a scope                            | path/package/domain (required) | no                  |
| `improve` | fix one approved finding; promote case→basis and prose→enforcement | one finding id / key (required) | yes, after approval |
| `docs`    | review/improve instruction surfaces                             | submode (below)                | submode-dependent   |

`docs` submode (second token, default `review`):

| Submode        | Does                                   | Writes              |
| -------------- | -------------------------------------- | ------------------- |
| `review`       | diagnose one surface                   | no                  |
| `instructions` | diagnose all surfaces (Deep baseline)  | no                  |
| `improve`      | edit one surface                       | yes, after approval |
| `jsdoc`        | edit JSDoc/TSDoc                        | yes, after approval |

Contracts:

- **Routing** — unknown first token → treated as a `plan` task; no argument → `review` if a diff exists, else asks for a mode.
- **Action axis (read-only vs write)** — DIAGNOSE modes (`plan`, `review`, `pr`, `audit`, `docs review`, `docs instructions`) only diagnose and propose; they never mutate the repo or session (no writes, no memory, no bookkeeping in output). ACT modes (`improve`, `docs improve`, `docs jsdoc`) write one approved unit at a time — a finding for `improve`, a surface for the docs writers.
- **Finding IDs** — a short `G-NNN` for in-session use plus a durable composite key (`path:symbol:dimension:rule`, structural anchor, no line numbers); `improve` accepts either. Across sessions use the key, or promote the finding to your issue tracker.

Typical loop — the ratchet that makes it pay off:

```
/guardian plan <task>      # plan before code
/guardian review           # findings on the diff
/guardian improve <id>     # fix one finding → durable enforcement
/guardian pr               # PR package
```

## Layout

- `CONCEPT.md` — what Guardian is and why, independent of any host agent or file format; read this to understand the thesis or to port Guardian to a new platform
- `SKILL.md` — router: identity, rules, severity, mode routing
- `reference/` — `basis-form` (the standard), `methodology` (dimensions), `baseline` (discovery + reconciliation), `enforcement` (promotion + checks), `bindings` (Claude Code specifics)
- `modes/` — `plan`, `review`, `pr`, `audit`, `improve`, `docs`

## License

MIT
