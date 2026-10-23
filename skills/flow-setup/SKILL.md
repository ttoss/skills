---
name: flow-setup
description: Set up, or re-audit, a repository for Flow — the source of truth for every agent instruction in it. Installs the ttoss Flow skills, defines the project's delivery rules (merge rule, release procedure, closing evidence…) with the user from what the repo already says, classifies every other instruction the repo holds (written before Flow or since, about delivery or about code), removes what only restates Get Things Flowing (GTF) or the skills, writes the entry section every session reads and the workflow map people read, proposes the Flow standing decision and opens a PR. Use when the user says /flow-setup, "set up flow", "onboard this repo to flow" or "audit the flow rules", or wants copied loop prose replaced by the skills.
argument-hint: "[audit] [owner/repo]"
---

# Flow setup

Prepares a repository for [`flow-manager`](../flow-manager/SKILL.md), once, and audits it again whenever GTF, the skills or the project's way of delivering change. It is interactive: it asks the user questions, and it never writes to Flow or to the default branch without their answer. It writes in the [terse voice](../flow-manager/references/voice.md) unless the project's `Voice` parameter is `normal`; its questions to the user and the PR body stay in full sentences, as the voice rules require.

The loop is generic on purpose. Everything that differs between projects — when a PR merges, what happens after it, what proves a task done — is an **extension point** the project answers in its [parameters](../flow-manager/references/parameters.md). Defining those answers with the user is most of this skill.

It is also the **source of truth for the repo's agent instructions**. Every one — written before Flow or since, about delivery or about code — has a level ([precedence](#precedence)) and a home, and `/flow-setup audit` keeps it that way. Content about the product's own code (its architecture, domains, packages, providers) stays the project's to write; this skill decides only its level, where it lives and when it loads, by the project's `Instruction layout`. An instruction the repo holds that this skill never classified is a second source of truth.

## Precedence

Rule of thumb: GTF is a general method for any work, in any profession; the ttoss skills are for product development; a project is one product. A rule belongs at the most general level where it holds in every case.

Every rule an agent follows in a Flow project comes from one of three sources:

1. **[Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md)** — the method. Always wins; cited by rule id (`GTF-E8`), never restated.
2. **The project** — one product: its parameters, the rules they point to, and its **domain rules** (what holds only for this product's code). Where the project defines an extension point, its answer is followed.
3. **The ttoss skills** — what holds for product development in general: the loop's cycle (tasks delivered through PRs, CI, review and merge), plus a default for every extension point the project leaves empty.

A project rule that only restates GTF or a skill is removed: one source of truth. A project rule that contradicts a skill **outside** an extension point is kept and followed when the user confirms it, and filed through [`flow-friction`](../flow-friction/SKILL.md) as the extension point the skill lacks. A project rule never overrides GTF.

## One owner per step

Each step of the loop has one owner, and each fact one home. Two owners of a step drift apart silently, each acting on a state the other already changed: an intake run that also fixes, an implementer that also merges or polls for the verdict, a reviewer that also writes the task. The owners, unless the project's parameters name others:

| Step | Owner |
| --- | --- |
| Intake | whatever finds the signal (a scheduled triage, a person, an agent mid-task): it writes a task with its investigation, or a capture, and never a fix |
| Implementation | a child run, or a person; the PR goes up ready (not draft) only when nothing is left to push |
| Review request | the `Review request` |
| Review and merge | the reviewer the `Merge rule` names, and whoever it lets merge; the verdict stays on the PR |
| After the verdict | the manager's tick, the only writer of the task once the review answers: a person's reservation, what the merge leaves ([flow-manager](../flow-manager/SKILL.md) 3.1) |
| Release | the `Release procedure` |
| Close | the reader the `Closing evidence` names, else the tick |

A fallback is not a second owner: the tick re-asks a lost review request or merges what the reviewer left, by the parameter that gives it that act.

## Steps

`/flow-setup` runs all of them; `/flow-setup audit` runs 1, 2, 4, 5, 6, 7, 9 and 10 on a repo already set up, to catch rules that drifted, answers that no longer match how the project delivers, text a change to GTF or the skills made redundant, and instructions added since without a level or a home.

1. **Read the target.** The repo named in the argument, else the current one. Collect every agent instruction source: `CLAUDE.md`, `AGENTS.md` (any depth), `.claude/rules/**`, `.claude/skills/**`, `.claude/agents/**`, `.github/instructions/**`, `.github/copilot-instructions.md`, `.cursor/rules/**`, the reference documents they link to, plus `skills-lock.json` and the parameters file (`.agents/flow-manager.md` or `.claude/flow-manager.md`) if present. Also read what shows how the project ships and how its agents run: CI workflows, release and deploy scripts, `CONTRIBUTING.md`, and whatever fires scheduled agent runs (a routine's file, a cron or CI job).
2. **Read the levels above.** The GTF protocol (the Flow MCP resource or the link above), the installed ttoss skills and the [parameters](../flow-manager/references/parameters.md) list. Classify against the text as it is now, never from memory.
3. **Install the skills.** `npx skills add ttoss/skills` in the target repo, so `skills-lock.json` records `flow-manager`, `flow-friction` and `flow-setup`.
4. **Define the project's rules.** For each [extension point](../flow-manager/references/parameters.md#extension-points), in the order of that table, and the `Runtime` parameter (how this project's runtime starts, reads, ends and messages a child run, and which tools a tick loads):
   1. **Find** what the repo already says: a rule, a CI step, a script, a standing decision in Flow. Quote it with `file:line`.
   2. **Propose** an answer built from that evidence, and the default the loop would use instead. For `Release procedure`, offer the shape that matches what you found (the shapes in [bootstrap](bootstrap.md#the-parameters-file) are a menu, not a requirement). An answer that is already a project file is proposed as a pointer to it, not copied.
   3. **Ask** the user to confirm, change or leave it empty (the default). Ask the open ones together, numbered, each with your proposal; never guess an answer the repo does not show (GTF-A4).
   4. **Record** the answer: a pointer, a short inline rule, or empty. An answer longer than a short list item that exists nowhere in the repo becomes a new project rule file in the PR, and the parameter points to it.
5. **Classify every other instruction.** One row per rule (a bullet, a paragraph, a file section) from any source of step 1 that is not already an answer from step 4 — about delivery or about code, written before Flow or since. Nothing is out of scope: a rule left unclassified stays a second source of truth.

   | The rule… | Action |
   | --- | --- |
   | restates GTF | delete it; where readers need the pointer, leave the GTF id |
   | holds for product development in general, but neither GTF nor a skill says it | keep it, and propose it to the skills with `flow-friction` |
   | restates a ttoss skill | delete it; where readers need the pointer, name the skill |
   | contradicts GTF | delete it, after showing the user the GTF rule it breaks |
   | contradicts a skill outside an extension point | ask; kept → file it with `flow-friction` and link the issue in the PR |
   | gives a step a second owner ([one owner per step](#one-owner-per-step)) — a scheduled run that fixes what it triages, an implementer that merges or polls, a reviewer that writes the task | ask, proposing the one owner; the other side becomes a task, a pointer or nothing |
   | answers an extension point — often a process rule written before Flow (a merge checklist, an open-questions gate, a feature-flag or monitoring policy) | make it the parameter's pointer (step 4); delete whatever in it restates GTF or a skill |
   | answers a question the loop asks that no extension point names | keep it, and propose the extension point with `flow-friction` |
   | states how this product's code is built — its architecture, a domain, a package, a provider, a code or test convention | keep it as a domain rule, content unchanged; move it only to the home and loading condition the `Instruction layout` gives |
   | restates another project rule | delete it; point to the one kept |
   | fills a gap the levels above leave open | keep it, worded so it does not restate them |

   When a rule is half one thing and half another, split it. When unsure, say so in the row and ask.
6. **Write the entry section.** The repo's always-loaded entry file (`AGENTS.md` or `CLAUDE.md` at the root, both when both exist) carries the [entry section](bootstrap.md#the-entry-section), filled from step 4, so a session started without `/flow-manager` — a person's prompt, a scheduled routine, a review — works by the same parameters as a child. It points to GTF and the parameters and restates neither: step 5 never removes it. In an audit, check it still names the current project, parameters file and skills.
7. **Write the workflow map.** Regenerate `AGENTIC_WORKFLOW.md` by [bootstrap](bootstrap.md#the-workflow-map), at the repo root beside the entry file unless the `Instruction layout` names another home: how work in this project goes from a signal to a closed task — who acts at each stage, what fires it, what it writes to Flow before it ends, which parameter governs it, and where each piece lives — built from step 4's answers, step 5's classification and the scheduled runs step 1 found. It is this skill's output, rebuilt whole on every setup and audit and never edited by hand: it holds pointers, never rules, so step 5 never classifies it, and a gap it would describe is a Flow task, not a paragraph.
8. **Bootstrap Flow** by [bootstrap.md](bootstrap.md): the project and the standing decision, built from step 4's answers, each proposed numbered and written only on the user's answer (GTF-A1, GTF-A4). In an audit, check them instead: the standing decision is not superseded and still authorises what step 4's answers ask the loop to do.
9. **Open a PR in the target repo** on a new branch, never on the default branch. It carries the parameters file (`.agents/flow-manager.md`, or the one the repo already has), any new rule file from step 4, the removals and moves of step 5, the entry section of step 6 and the workflow map of step 7. The body has two tables: the parameters, each with its evidence and whether the user confirmed, changed or left it default; and the classification, each rule quoted short with its `file:line`, its action and the GTF id, skill or issue that justifies it. The PR is the user's review of every answer and every removal.
10. **Report** the prerequisites from [`flow-manager`](../flow-manager/SKILL.md#prerequisites-outside-the-repo), each passing or failing, the extension points left at their default, and how to fire the tick in this runtime: a recurring routine or a cron or CI job running `/flow-manager <project id>` headless, a fresh run each time, or `/loop 10m /flow-manager` inside one conversation. Say whether the Flow deployment has `upsert-agent-run` and `list-agent-runs`; the loop needs them ([child runs](../flow-manager/SKILL.md#child-runs)). In an audit, read `list-agent-runs` with `linked=false` and `lingering=true` and report what it finds: spend that left no trace, and runs still open after their task closed.

## Done means

Every extension point has an answer the user confirmed or a default they accepted; every instruction in the repo has a level and the home the `Instruction layout` gives it; the repo's rules say nothing GTF, the skills or another project rule already say; the entry section lets a session started by a plain prompt find the project, its parameters and the skills; the workflow map matches the parameters as they now stand; and the project rules plus the parameters file are everything a new manager needs that the levels above do not give it.
