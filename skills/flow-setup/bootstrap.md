# Bootstrap

The Flow part of [`flow-setup`](SKILL.md) step 7. It creates what the loop needs in Flow, once per project. Creating a commitment is the person's call ([GTF-A1, GTF-A4](https://flow.ttoss.dev/docs/agents/protocol.md#authority)): list every write, numbered, and wait for their answer.

1. **Project.** `list-projects`; ask which one, or offer `create-project`.
2. **Standing decision.** Search for an existing one (`list-tasks` `kind: decision`, `query: "standing"`). If none authorises the loop, propose one `decision` task, closed `completed` with the user's verbatim answer as `basis: { said }`, titled `Standing: the delivery loop runs autonomously`. Its body delegates by pointer, so a new version of the skills or a changed parameter needs no new decision ([GTF-A6, GTF-T1](https://flow.ttoss.dev/docs/agents/protocol.md#authority)):

   ```markdown
   The delivery loop runs the delivery process of the ttoss Flow skills that `<repo>`'s `skills-lock.json` pins, with this project's answers in `<parameters file>`, both as they stand on the default branch of `<repo>`, where they change only through a merge a person approved (<how: required review from the files' owners>).

   - **Acts:** every act that process gives the tick and its children under those answers: take, move and close tasks; start and end child runs; integrate what the `Merge rule` lets the loop integrate; ask for the reviews `Review` gives it; run the steps the `Release procedure` gives it; run the checks of the `Closing evidence`; write what it notices as the `Intake` says.
   - **Closing evidence:** the `Closing evidence` answer.
   - **Choices:** which ready task to start next, in `get-next` order, and the choices that pass the `Decisions` test.
   - **Tidying:** end finished child runs; retract the `implements` reference of a change closed without integrating; close the tasks an integrated change says it settles, citing it; re-point the `blocks` edges the `Release procedure` moves.
   - **Reserved to a person:** the classes `Decisions` reserves, any change to the files above or to the project's agent instructions, and every act the process does not give the loop.
   ```

3. **Release procedure tasks.** When the procedure tracks work in flight in a task, propose that task, `active`.
4. **Write the parameters**, with the standing decision's id, to the parameters file: `.agents/flow.md`, or `.claude/flow.md` where the repo keeps its agent files under `.claude/`. An older `flow-manager.md` moves there, in the PR of step 8.

## The parameters file

A list, one parameter per item, each a pointer or a short rule:

```markdown
# Flow

`flow` parameters for Acme. Each value points to the rule that holds it; edit the rule, not this list.

- **Flow project id**: `proj_xxxxxxxxxx`.
- **Standing-decision task id**: `task_xxxxxxxxxx`.
- **Repos**: `acme/api`, `acme/web`.
- **Runtime**: `ops/agent-runtime.md` (children, run records, max runs 2, child handoff `push`, models).
- **Routines**: the Tick hourly on weekdays 09:00–18:00 `America/Sao_Paulo` (`/flow proj_xxxxxxxxxx`); the Chase on weekdays at 08:50 (`/flow proj_xxxxxxxxxx --chase`), to `#eng`; the Audit on Fridays at 16:50 (`/token-audit --routine`); Sentry triage on each new issue (`.agents/routines/sentry-triage.md`). Models and connectors in `ops/agent-runtime.md`.
- **Intake**: `docs/agents/intake.md`; a pull request with no task gets one.
- **Ready brief**: default.
- **Decisions**: `AGENTS.md` § Decisions, tested by `docs/agents/open-questions.md`.
- **Before proposing**: `scripts/ci.sh`, the script the CI runs; every change records its flag and its monitoring (`docs/agents/change-checklist.md`).
- **Review**: an agent reviewer, asked by CI once `ci` is green on a ready pull request (`docs/agents/review.md`).
- **Merge rule**: `docs/agents/merge.md`.
- **Release procedure**: every merge to `main` deploys `acme/api`; `acme/web` bumps the published client (`docs/agents/release.md`).
- **Closing evidence**: `docs/agents/done.md`; checked against the Staging API `https://api.staging.acme.dev`, token in `ACME_TOKEN`, GET only.
- **Delivery kinds**: help-center articles (a person approves, an agent publishes, the live page proves it).
```

## The entry section

[`flow-setup`](SKILL.md) step 6 writes it, filled, into the repo's always-loaded entry file. It is what a session started without `/flow` knows about Flow, so it stays short: pointers, never the rules they point to.

```markdown
## Flow

Work in this repo lives in the Flow project `<proj id>`; no other tracker holds it. Every session follows [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md), the delivery process of the `flow` skill (`references/process.md`) and this project's parameters in `<parameters file>`, started by `/flow` or not:

- Work through a task: the one you were given, or one you find (`list-tasks` with `query`) or propose before changing anything. Your run holds the task (GTF-S8).
- Apply the parameters on the way: `Before proposing` before the change; `Merge rule`; `Intake` for what you notice; `Decisions` for open choices.
- The change carries the task's URL and the tasks it settles; before you stop, the task carries the change as an `implements` reference, what integrating leaves, and its wait on the gates. After the verdict, the tick writes the task.
- Friction with a skill, GTF or a Flow tool → `flow-friction`, then continue.
```

## The workflow map

[`flow-setup`](SKILL.md) step 8 rebuilds `AGENTIC_WORKFLOW.md` whole on every setup and audit, for the project's people: the [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow) as the project runs it. It is generated and says so on its first line. It points: every line names the parameter, rule, skill or routine that holds it, so a change to it is a change to those, followed by `/flow-setup audit`. It tells apart the workflow's stages and the three kinds of actor in them: a routine's run (the tick and the runs it starts), a person, and automation (CI, a pipeline, a channel where signals arrive). The diagram colours each state by who acts next, the stage table gives each kind its column, and the routines table lists every routine the workflow has and whether this project runs it.

```markdown
# Agentic Workflow — <project name>

> Generated by `/flow-setup` from `<parameters file>` on <date>. Do not edit: change the parameters or the rules they point to, then run `/flow-setup audit`.

Work lives in the Flow project `<proj id>`, under the standing decision [`<task id>`](https://flow.ttoss.dev/app/tasks/<task id>); <the code host> holds the code and its changes. It runs the ttoss [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow): every run reads a task's state from Flow, acts and writes it back, so the next run starts from the graph.

<a mermaid stateDiagram-v2 of the workflow's states as this project has them, each transition labelled with who makes it, each state coloured by who acts next: classDef routine fill:#cfe2ff, person fill:#f6c177, automation fill:#e5e5e5>

Blue: a routine's run acts next. Orange: a person. Grey: automation.

| Stage | Routine | Person | Automation | Governed by |
| --- | --- | --- | --- | --- |
| Intake | <the intake routine; what runs write as they notice it> | <who writes a task by hand, for which signals> | <where signals arrive> | `Intake` |
| Decide | — | <the choices reserved to a person> | — | `Decisions` |
| Implement | <the tick starts a child per ready task> | <a person working a task in their own session> | — | `Before proposing`, `Child handoff` |
| Gates | <the tick's review child, when `Review` gives the loop the review> | <a person's review> | <the required checks> | `Review`, `Merge rule` |
| Integrate | <what the tick integrates> | <what a person integrates> | — | `Merge rule` |
| Release | <a release step the tick delegates> | <a person's release step> | <the pipeline> | `Release procedure` |
| Verify | <the tick's check child, or the routine `Closing evidence` names> | <a check a person reads> | — | `Closing evidence` |

## Routines

| Routine | What it does | Runs | Here |
| --- | --- | --- | --- |
| Tick | moves tasks through the stages: delegates, reviews, integrates, releases, verifies | `/flow <proj id>` | <its schedule, or "not scheduled: someone runs it by hand"> |
| Chase | tells each person what waits on them | `/flow <proj id> --chase` | <its schedule, or "not set up"> |
| Audit | finds where the loop spends tokens, files each fix as a task | `/token-audit --routine` | <its schedule, or "not set up"> |
| <each project routine> | <what it does> | `<its file>` | <what fires it> |

## Where each piece lives

| What | Where |
| --- | --- |
| The method | [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md) |
| The workflow | [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow) |
| The skills | `flow`, `flow-setup`, `flow-friction`, `token-audit`, pinned in `skills-lock.json` |
| The parameters | `<parameters file>` |
| <each file a parameter points to> | `<path>` |
```
