---
name: flow-setup
description: Set up, or re-audit, a repository for the Flow delivery loop. Reads the target codebase's agent rules (CLAUDE.md, AGENTS.md, .claude/rules, .github/instructions and similar), installs the ttoss Flow skills, and rewrites those rules by precedence — Get Things Flowing (GTF) first, then the ttoss skills, then the project — so the repo keeps only what is specific to it. Proposes the Flow writes the loop needs (project, standing decision, release batch) and opens a PR in the target repo for review. Use when the user says /flow-setup, "set up flow", "onboard this repo to flow", "audit the flow rules", or wants to replace copied loop prose with the skills.
argument-hint: "[audit] [owner/repo]"
---

# Flow setup

Prepares a repository for [`flow-manager`](../flow-manager/SKILL.md), once, and audits it again whenever GTF or the skills change. It is interactive: it may ask the user questions, and it never writes to Flow or to the default branch without their answer.

## Precedence

Every rule an agent follows in a Flow project comes from one of three levels, and a higher level always wins:

1. **[Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md)** — the method. Cited by rule id (`GTF-E8`), never restated.
2. **The ttoss skills** — `flow-manager`, its [loop rules](../flow-manager/references/loop-rules.md), `flow-friction`, this skill. They add only what GTF leaves open.
3. **The project** — its parameters and its own rules. They add only what the two levels above leave open: stack, commands, release procedure, production target, which decisions are reserved to a human.

A lower level never overrides a higher one. A project rule that contradicts GTF or a skill is removed, not kept "as a local policy"; if it carries a lesson the higher level lacks, that lesson goes up through [`flow-friction`](../flow-friction/SKILL.md) as a proposal, and the project waits for the higher level to change.

## Steps

`/flow-setup` runs all of them; `/flow-setup audit` runs 1, 2, 4, 6 and 7 on a repo already set up, to catch rules that drifted or that a change to GTF or the skills made redundant.

1. **Read the target.** The repo named in the argument, else the current one. Collect every agent rule source: `CLAUDE.md`, `AGENTS.md` (any depth), `.claude/rules/**`, `.claude/skills/**`, `.github/instructions/**`, `.github/copilot-instructions.md`, `.cursor/rules/**`, plus `skills-lock.json` and `.claude/flow-manager.md` if present.
2. **Read the levels above.** The GTF protocol (the Flow MCP resource or the link above) and the installed ttoss skills, including `flow-manager/references/loop-rules.md`. Classify against the text as it is now, never from memory.
3. **Install the skills.** `npx skills add ttoss/skills` in the target repo, so `skills-lock.json` records `flow-manager`, `flow-friction` and `flow-setup`. Report any skill the loop names that is missing from the source (today `guardian`, used by loop rule 2).
4. **Classify every rule.** One row per rule (a bullet, a paragraph, a file section) that touches how agents work with tasks, PRs, releases, sessions or decisions. Rules about code style, tests or architecture that the loop does not touch are out of scope: leave them alone.

   | The rule… | Action |
   | --- | --- |
   | restates GTF | delete it; where readers need the pointer, leave the GTF id |
   | restates a ttoss skill | delete it; where readers need the pointer, name the skill |
   | contradicts GTF or a skill | delete it; if it holds a lesson the higher level lacks, file it with `flow-friction` and link the issue in the PR |
   | is a project parameter (production target, release procedure, upstream/downstream repos, human-reserved decisions) | move it to `.claude/flow-manager.md` ([parameters](../flow-manager/references/parameters.md)) |
   | fills a gap the levels above leave open | keep it, worded so it does not restate them |

   When a rule is half one thing and half another, split it. When unsure whether it contradicts or fills a gap, say so in the row and ask; do not guess (GTF-A4).
5. **Bootstrap Flow** by [bootstrap.md](bootstrap.md): the project, the standing decision and the release batch, each proposed numbered and written only on the user's answer (GTF-A1, GTF-A4). In an audit, check them instead: the standing decision is not superseded and still says what GTF-T1 asks for.
6. **Open a PR in the target repo** on a new branch, never on the default branch. The body is the classification table: each rule quoted short, its source `file:line`, its action, and the GTF id, skill or issue that justifies it. The PR is the user's review of every removal.
7. **Report** the prerequisites from [`flow-manager`](../flow-manager/SKILL.md#prerequisites-outside-the-repo), each passing or failing, and the command to start: `/loop 10m /flow-manager`.

## Done means

The target repo's rules say nothing GTF or the skills already say, contradict neither, and the remaining project rules plus `.claude/flow-manager.md` are everything a new manager needs that the levels above do not give it.
