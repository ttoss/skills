---
name: flow-setup
description: Set up, or re-audit, a repository for the Flow delivery loop — installs the ttoss Flow skills, defines the project's answers to the ttoss Agentic Workflow's extension points (merge rule, release procedure, closing evidence…) with the user from what the repo already says, removes delivery rules that only restate Get Things Flowing (GTF), the workflow or the skills, writes the entry section every session reads and the workflow map people read (AGENTIC_WORKFLOW.md), proposes the Flow standing decision, opens a PR and, once it merges, creates the routines that fire the runs. Use when the user says /flow-setup, "set up flow", "onboard this repo to flow", "audit the flow rules" or "add a routine", or wants copied loop prose replaced by the skills.
argument-hint: "[audit | routines | routine <name>] [owner/repo]"
---

# Flow setup

Prepares a repository for [`flow`](../flow/SKILL.md) once, and audits it again whenever GTF, the skills or the project's way of delivering change. It is interactive: it asks the user questions, and it never writes to Flow or to the default branch without their answer. Its questions and the PR body are in full sentences; everything else it writes, in as few words as carry the meaning.

The [delivery process](../flow/references/process.md), a page of the ttoss [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow), is generic on purpose. Everything that differs between projects, such as when a change integrates, what happens after it and what proves a task done, is a [parameter](../flow/references/parameters.md) the project answers. Defining those answers with the user is most of this skill. The project's other instructions, about its own code, are the project's: this skill does not classify or move them.

## Precedence

GTF is a general method for any work, in any profession; the ttoss skills are for software delivery; a project is one product. A rule belongs at the most general level where it holds in every case. Every rule an agent follows in a Flow project comes from one of three sources:

1. **[Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md)**, the method. Always wins; cited by rule id (`GTF-E8`), never restated.
2. **The project**: its parameters and the rules they point to. Where the project answers a parameter, its answer is followed.
3. **The ttoss skills**: the delivery process, and a default for every parameter the project leaves empty.

A delivery rule in the project that only restates GTF or a skill is removed: one source of truth. One that contradicts a skill outside a parameter is kept and followed when the user confirms it, and filed through [`flow-friction`](../flow-friction/SKILL.md) as the parameter the skill lacks. A project rule never overrides GTF.

## Steps

`/flow-setup` runs all of them; `/flow-setup audit` runs them again on a repo already set up, to bring its skills up to date and catch answers that no longer match how the project delivers and delivery rules that a change to GTF or the skills made redundant. `/flow-setup routines` runs step 11 alone, and `/flow-setup routine <name>` adds [a project routine](#a-project-routine).

1. **Read the target.** The repo named in the argument, else the current one: its entry files (`AGENTS.md`, `CLAUDE.md`), the parameters file (`.agents/flow.md` or `.claude/flow.md`) and `skills-lock.json` if present, and the rules they point to about delivery. Read what shows how the project ships and how its agents run: CI workflows, release and deploy scripts, `CONTRIBUTING.md`, the default branch's protection and required checks on the code host, and whatever fires scheduled agent runs (a routine's file, a cron or CI job).
2. **Read the levels above:** the GTF protocol (a Flow MCP resource, or the link above), the installed skills and the [parameters](../flow/references/parameters.md) list, as they are now, never from memory.
3. **Install or update the skills.** `npx skills add ttoss/skills -s '*' -y --copy` in the target repo, with `-a <agent>` for the agent its sessions run (`claude-code`), so `skills-lock.json` records `flow`, `flow-friction` and `flow-setup` and the repo holds the files themselves, which `skills update` would replace with symlinks. A Flow skill the lock still lists but ttoss/skills no longer has, such as `flow-manager` (now `flow`), leaves with its directory, and the routines and scheduled jobs that invoked it call its successor. Open tasks a `flow-manager` run took by `assignee`, which records the person since the agents act as them, are proposed for release (`assignee: null`): under `flow`, a run's `works_on` is the agent's claim (GTF-S8).
4. **Define the parameters.** For the `Runtime`, the `Routines` and each extension point, in the order of the parameters page:
   1. **Find** what the repo already says: a rule, a CI step, a script, a branch protection, a standing decision in Flow. Quote it with `file:line`.
   2. **Propose** an answer built from that evidence, beside the default the loop would use instead. For `Runtime`, offer the [preset](../flow/references/parameters.md#runtime) that matches how the repo's agents run; for `Release procedure`, the [shape](../flow/references/parameters.md#release-procedure-shapes) that matches what you found; for `Routines`, the [standard routines](../flow/references/routines.md#standard-routines) at times in the project's time zone, and a [project routine](../flow/references/routines.md#project-routines) for each signal the team receives outside Flow today, such as an error tracker, a feedback channel or an alarm. An answer a project file already holds is proposed as a pointer to it, never copied.
   3. **Ask** the user to confirm, change or leave each one empty (the default): the open ones together, numbered, each with your proposal. Never guess an answer the repo does not show (GTF-A4).
   4. **Record** the answer: a pointer, a short inline rule, or nothing. An answer longer than a short list item that exists nowhere in the repo becomes a new rule file in the PR, and the parameter points to it.
5. **Remove what the levels above already say.** For each delivery rule the repo holds outside the answers of step 4: one that restates GTF, the Agentic Workflow, a skill or another project rule is deleted, leaving the GTF id or the skill's name where readers need the pointer; one that contradicts GTF is deleted after showing the user the rule it breaks; one that contradicts a skill outside a parameter is the user's call, filed with `flow-friction` when kept; one that gives a step of the process a second owner, such as an implementer that integrates or a reviewer that writes the task, is the user's call, proposing the one owner. When unsure, say so and ask.
6. **Write the entry section.** The file every session in the repo loads (`AGENTS.md` or `CLAUDE.md` at the root, both when both exist; a `.claude/rules/flow.md` with no `paths` where the repo keeps its always-loaded rules there) carries the [entry section](bootstrap.md#the-entry-section), filled from step 4, so a session started without `/flow` works by the same parameters as a child. In a project of several repos, each one carries it, pointing at the one parameters file. It points and restates nothing. In an audit, check it still names the current project, parameters file and skills.
7. **Bootstrap Flow** by [bootstrap.md](bootstrap.md): the project and the standing decision, each proposed numbered and written only on the user's answer (GTF-A1, GTF-A4). In an audit, check the standing decision is not superseded and still names the skills in `skills-lock.json` and the parameters file as they stand on the default branch.
8. **Write the workflow map**, the setup's final output for the project's people: `AGENTIC_WORKFLOW.md` at the repo root, by the [template](bootstrap.md#the-workflow-map), from step 4's answers. It is rebuilt whole on every setup and audit and never edited by hand; it holds pointers and no rule, so step 5 never removes it, and the entry section does not name it, so no session loads it.
9. **Open a PR in the target repo** on a new branch, never on the default branch. It carries the parameters file, any new rule or routine file from step 4, the removals of step 5, the entry section of step 6 and the workflow map of step 8. The body has two tables: the parameters, each with its evidence and whether the user confirmed, changed or left it default; and the removals, each quoted short with its `file:line` and the GTF id or skill that covers it. The PR is the user's review of every answer and every removal.
10. **Report the prerequisites** the [process](../flow/references/process.md#prerequisites) and [`flow`](../flow/SKILL.md#prerequisites-outside-the-repo) need, each passing or failing:
   - the default branch's required checks and review enforce the `Merge rule`;
   - the agent instruction files, the parameters file and `skills-lock.json` change only through a merge a person approved (required review from their owners, with agents under a code-host identity of their own: a review the agents' identity can give or bypass proves no person approved), so the standing decision can point at them (GTF-A6);
   - the runtime's permission rules allow each act the standing decision delegates (integrating, release steps) to the run that does it;
   - every credential the `Closing evidence` names is in the environment;
   - the Flow deployment has `upsert-agent-run` and `list-agent-runs`;
   - each row of `Routines` exists in the runtime and matches it (step 11).

   List the parameters left at their default. In an audit, also read `list-agent-runs` with `linked=false` and with `lingering=true`, and report what each finds: spend that reached no task, and runs still open after their task closed.
11. **Create the routines** once a person has integrated the PR, since each one invokes what the default branch holds (GTF-A6). For each row of `Routines`, on the user's answer, since every firing costs: create it by the runtime preset's acts, fire it once and validate what it started. An event the tools cannot wire, such as a GitHub event, goes to the user with where to set it. In an audit, compare the runtime's routines with the rows instead: missing, extra, a prompt, schedule or model that differs, a last run that failed.

## A project routine

`/flow-setup routine <name>` adds one in the [shapes](../flow/references/routines.md#project-routines) the workflow gives: ask the user what fires it, what it reads and may change, and which of the project's instructions own its signal; write its file from [routine.md](routine.md) and its row in `Routines`, and rebuild the workflow map (step 8); open the PR, which a person integrates like any change to the agent instructions; then step 11 for that row.

## Done means

Every parameter has an answer the user confirmed or a default they accepted; the repo's delivery rules say nothing GTF, the skills or another project rule already say; the entry section lets a session started by a plain prompt find the project, its parameters and the skills; the standing decision points at the skills and the parameters file the default branch holds; the workflow map matches the parameters as they now stand; and every row of `Routines` is a routine in the runtime, fired once and validated.
