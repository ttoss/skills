---
name: flow-setup
description: Set up, or re-audit, a repository for the Flow delivery loop. Reads the target codebase's agent rules (CLAUDE.md, AGENTS.md, .claude/rules, .github/instructions and similar), installs the ttoss Flow skills, and walks the user through defining the project's own delivery rules — merge rule, release procedure, closing evidence, verification target, human-reserved decisions, decision gate, findings rule — proposing each from what the repo already says. Removes rules that only restate Get Things Flowing (GTF) or the skills, proposes the Flow writes the loop needs (project, standing decision) and opens a PR in the target repo for review. Use when the user says /flow-setup, "set up flow", "onboard this repo to flow", "audit the flow rules", or wants to replace copied loop prose with the skills.
argument-hint: "[audit] [owner/repo]"
---

# Flow setup

Prepares a repository for [`flow-manager`](../flow-manager/SKILL.md), once, and audits it again whenever GTF, the skills or the project's way of delivering change. It is interactive: it asks the user questions, and it never writes to Flow or to the default branch without their answer. It writes in the [terse voice](../flow-manager/references/voice.md) unless the project's `Voice` parameter is `normal`; its questions to the user and the PR body stay in full sentences, as the voice rules require.

The loop is generic on purpose. Everything that differs between projects — when a PR merges, what happens after it, what proves a task done — is an **extension point** the project answers in its [parameters](../flow-manager/references/parameters.md). Defining those answers with the user is most of this skill.

## Precedence

Rule of thumb: GTF is a general method for any work, in any profession; the ttoss skills are for product development; a project is one product. A rule belongs at the most general level where it holds in every case.

Every rule an agent follows in a Flow project comes from one of three sources:

1. **[Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md)** — the method. Always wins; cited by rule id (`GTF-E8`), never restated.
2. **The project** — one product: its parameters and the rules they point to. Where the project defines an extension point, its answer is followed.
3. **The ttoss skills** — what holds for product development in general: the loop's cycle (tasks delivered through PRs, CI, review and merge), plus a default for every extension point the project leaves empty.

A project rule that only restates GTF or a skill is removed: one source of truth. A project rule that contradicts a skill **outside** an extension point is kept and followed when the user confirms it, and filed through [`flow-friction`](../flow-friction/SKILL.md) as the extension point the skill lacks. A project rule never overrides GTF.

## Steps

`/flow-setup` runs all of them; `/flow-setup audit` runs 1, 2, 4, 5, 7 and 8 on a repo already set up, to catch rules that drifted, answers that no longer match how the project delivers, or text a change to GTF or the skills made redundant.

1. **Read the target.** The repo named in the argument, else the current one. Collect every agent rule source: `CLAUDE.md`, `AGENTS.md` (any depth), `.claude/rules/**`, `.claude/skills/**`, `.github/instructions/**`, `.github/copilot-instructions.md`, `.cursor/rules/**`, plus `skills-lock.json` and the parameters file (`.agents/flow-manager.md` or `.claude/flow-manager.md`) if present. Also read what shows how the project ships and how its agents run: CI workflows, release and deploy scripts, `CONTRIBUTING.md`, and whatever fires scheduled agent runs (a routine's file, a cron or CI job).
2. **Read the levels above.** The GTF protocol (the Flow MCP resource or the link above), the installed ttoss skills and the [parameters](../flow-manager/references/parameters.md) list. Classify against the text as it is now, never from memory.
3. **Install the skills.** `npx skills add ttoss/skills` in the target repo, so `skills-lock.json` records `flow-manager`, `flow-friction` and `flow-setup`.
4. **Define the project's rules.** For each [extension point](../flow-manager/references/parameters.md#extension-points), in the order of that table, and the `Runtime` parameter (how this project's runtime starts, reads, ends and messages a child run, and which tools a tick loads):
   1. **Find** what the repo already says: a rule, a CI step, a script, a standing decision in Flow. Quote it with `file:line`.
   2. **Propose** an answer built from that evidence, and the default the loop would use instead. For `Release procedure`, offer the shape that matches what you found (the shapes in the parameters file are a menu, not a requirement). An answer that is already a project file is proposed as a pointer to it, not copied.
   3. **Ask** the user to confirm, change or leave it empty (the default). Ask the open ones together, numbered, each with your proposal; never guess an answer the repo does not show (GTF-A4).
   4. **Record** the answer: a pointer, a short inline rule, or empty. An answer too long for a table cell that exists nowhere in the repo becomes a new project rule file in the PR, and the parameter points to it.
5. **Classify every other rule.** One row per rule (a bullet, a paragraph, a file section) that touches how agents work with tasks, PRs, releases, agent runs or decisions and is not already an answer from step 4. Rules about code style, tests or architecture that the loop does not touch are out of scope: leave them alone.

   | The rule… | Action |
   | --- | --- |
   | restates GTF | delete it; where readers need the pointer, leave the GTF id |
| holds for product development in general, but neither GTF nor a skill says it | keep it, and propose it to the skills with `flow-friction` |
   | restates a ttoss skill | delete it; where readers need the pointer, name the skill |
   | contradicts GTF | delete it, after showing the user the GTF rule it breaks |
   | contradicts a skill outside an extension point | ask; kept → file it with `flow-friction` and link the issue in the PR |
   | answers an extension point | make it the parameter's pointer (step 4) |
   | fills a gap the levels above leave open | keep it, worded so it does not restate them |

   When a rule is half one thing and half another, split it. When unsure, say so in the row and ask.
6. **Bootstrap Flow** by [bootstrap.md](bootstrap.md): the project and the standing decision, built from step 4's answers, each proposed numbered and written only on the user's answer (GTF-A1, GTF-A4). In an audit, check them instead: the standing decision is not superseded and still authorises what step 4's answers ask the loop to do.
7. **Open a PR in the target repo** on a new branch, never on the default branch. It carries the parameters file (`.agents/flow-manager.md`, or the one the repo already has), any new rule file from step 4, and the removals of step 5. The body has two tables: the parameters, each with its evidence and whether the user confirmed, changed or left it default; and the classification, each rule quoted short with its `file:line`, its action and the GTF id, skill or issue that justifies it. The PR is the user's review of every answer and every removal.
8. **Report** the prerequisites from [`flow-manager`](../flow-manager/SKILL.md#prerequisites-outside-the-repo), each passing or failing, the extension points left at their default, and how to fire the tick in this runtime: a recurring routine or a cron or CI job running `/flow-manager <project id>` headless, a fresh run each time, or `/loop 10m /flow-manager` inside one conversation. Say whether the Flow deployment has `upsert-agent-run` and `list-agent-runs`; the loop needs them ([child runs](../flow-manager/SKILL.md#child-runs)). In an audit, read `list-agent-runs` with `linked=false` and `lingering=true` and report what it finds: spend that left no trace, and runs still open after their task closed.

## Done means

Every extension point has an answer the user confirmed or a default they accepted; the target repo's rules say nothing GTF or the skills already say; and the project rules plus the parameters file are everything a new manager needs that the levels above do not give it.
