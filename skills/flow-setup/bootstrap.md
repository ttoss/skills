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
- The change carries the task's URL and the tasks it settles; before you stop, the task carries the change as an `implements` reference, what integrating leaves, and its wait on the gates. After the verdict, the manager's tick writes the task.
- Friction with a skill, GTF or a Flow tool → `flow-friction`, then continue.
```
