# Bootstrap

The Flow part of [`flow-setup`](SKILL.md) step 8. It creates what the loop needs in Flow, once per project. Creating a commitment is the person's call ([GTF-A1, GTF-A4](https://flow.ttoss.dev/docs/agents/protocol.md#authority)): list every write, numbered, and wait for their answer.

1. **Project.** `list-projects`; ask which one, or offer `create-project`.
2. **Standing decision.** Search for an existing one (`list-tasks` `kind: decision`, `query: "standing"`); the project may already have standing rules that cover part of it — cite them rather than restate them. If none authorises the loop, propose one `decision` task, closed `completed` with the user's verbatim answer as `basis: { said }`, titled `Standing: the delivery loop runs autonomously`, whose body is a target-pursuit standing rule saying what [GTF-T1](https://flow.ttoss.dev/docs/agents/protocol.md#pursue-a-target) asks for, built from step 4's answers:
   - **Allowed acts**: take, move and close tasks; start and end child runs; merge what the `Merge rule` lets the loop merge; ask for a review the `Review request` gives the loop; the steps the `Release procedure` gives the loop; the read-only checks of the `Closing evidence` on the `Verification target`; write follow-ups by the `Findings rule` — including, when the credential cannot capture, a finding as an `incubated` task `derived_from` the task at hand, which the decision must list. Only acts an answer actually calls for — a project with no release procedure gets no release act.
   - **Closing evidence**: the `Closing evidence` answer.
   - **Permitted choices**: which ready task to start next, in `get-next` order (GTF-E1 leaves that choice to the person unless delegated), and choices that pass the `Decision gate`.
   - **Permitted tidying**: end finished child runs, restart merged branches, re-point the `blocks` edges the release procedure moves, plus any tidying rule the project already has.
   - **Reserved**: the `Human-reserved decisions`, and every act not listed above.

   The decision holds this text itself, so its authority does not depend on this skill's version (GTF-A6).
3. **Release procedure tasks.** When the procedure tracks work in flight in a task (a `Release <repo> (next)` batch, for one), propose that task (`active`), basis the standing decision.
4. **Write the parameters**, with the standing decision's id, to the parameters file (`.agents/flow-manager.md` unless the repo already has one), in the PR of step 9.

## The parameters file

Shapes a release procedure can take, for [`flow-setup`](SKILL.md) step 4 to offer — none is the loop's own:

- **Continuous**: every merge deploys; nothing for the loop to do after merge.
- **Per-merge publish + consumer bump**: each merge publishes a package; a consumer repo bumps to it, one task per bump or batched.
- **Batched release**: an open `Release <repo> (next)` task that tasks meant to ship `block`; the loop cuts it when the project's batch condition holds, then writes the bump as a task and each shipped task's check as its GTF-E8 wait. The batch `blocks` the bump and the bump `blocks` every task it ships, never the reverse.
- **Manual**: a person releases; the loop waits on them (`external` wait).

An example file, as step 4 above writes it — a list, one parameter per item, each a pointer or a short rule:

```markdown
# Flow manager

`flow-manager` parameters for Acme. Each value points to the rule that holds it; edit the rule, not this list.

- **Flow project id**: `proj_xxxxxxxxxx`.
- **Standing-decision task id**: `task_xxxxxxxxxx`.
- **Repos**: `acme/api`, `acme/web`.
- **Runtime**: `ops/agent-runtime.md`.
- **Merge rule**: `docs/agents/merge.md`.
- **Review request**: CI adds the review label once `ci` is green on a ready PR (`scripts/request-review.mjs`); a lost request: `docs/agents/merge.md` → Fallback.
- **Local checks**: `scripts/ci.sh`, the script the CI runs, and the preview check in `docs/agents/live-check.md`.
- **Release procedure**: every merge to `main` deploys `acme/api`; `acme/web` bumps the published client (`docs/agents/release.md`).
- **Closing evidence**: `docs/agents/done.md`.
- **Verification target**: Staging API `https://api.staging.acme.dev`, token in `ACME_TOKEN`, GET only.
- **Human-reserved decisions**: `AGENTS.md` § Decisions.
- **Decision gate**: `docs/agents/open-questions.md`.
- **Findings rule**: default.
- **Change decisions**: `docs/agents/feature-flags.md`, `docs/agents/monitoring.md`.
- **Instruction layout**: `docs/agents/rule-layout.md`.
- **Max runs**: 2.
- **Voice**: terse.
- **Child handoff**: push.
- **Child model**: inherit.
- **Verification model**: `<a mid-tier model id>`.
```

## The entry section

[`flow-setup`](SKILL.md) step 6 writes it, filled, into the repo's always-loaded entry file. It is what a session started without `/flow-manager` knows about Flow, so it stays short: pointers, never the rules they point to.

```markdown
## Flow

Work in this repo lives in the Flow project `<proj id>`; no other tracker holds it. Every session follows [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md) and the project parameters in `<parameters file>`, started by `/flow-manager` or not:

- Work through a task: the one you were given, or one you find (`list-tasks` with `query`) or propose before changing anything. Record your agent run against it (GTF-S7).
- Apply the parameters on the way: `Change decisions` and `Local checks` before the PR; `Merge rule`; `Findings rule`; `Decision gate` and `Human-reserved decisions` for open choices.
- The PR goes up ready (not draft) only when nothing is left to push, and carries the task's URL; before you stop, the task carries the PR as an `implements` reference, what the merge leaves, and its wait on CI and review. After the merge, the manager's tick writes the task.
- Friction with a skill, GTF or a Flow tool → `flow-friction`, then continue.
- Where an instruction lives and when it loads: `Instruction layout`. A new one goes there, never only here.
- How work flows here, stage by stage: `<workflow map>`.
```

## The workflow map

[`flow-setup`](SKILL.md) step 7 rebuilds it whole on every setup and audit, for people who want the loop at a glance. It is generated: its first line says so, and a change to it is a change to the parameters or the rules it points to, followed by `/flow-setup audit`. It carries no rule of its own; every line points to the parameter, rule, skill or routine that holds it.

**Every step shows its one owner and the Flow write that records it.** Flow is the loop's only memory (GTF-S4): a session that dies mid-step leaves the next manager tick only what the graph holds. So each step in the diagram, and each row of the stage table, names its [one owner](SKILL.md#one-owner-per-step) and what it writes before it ends — the task's status and wait, a reference, an edge, the agent run, or "none" with where the state already is — and the diagram draws every step against the task's state in Flow, not as a pipeline beside it. People's steps are drawn apart from agents' (their own shape and colour). A step with no Flow write and nowhere else holding its state is a gap in the loop: name it in the map's last section as the Flow task that closes it.

```markdown
# Agentic workflow — <project name>

> Generated by `/flow-setup` from `<parameters file>` on <date>. Do not edit: change the parameters or the rules they point to, then run `/flow-setup audit`.

Work state lives in the Flow project `<proj id>`; the code host holds code, PRs and review. Flow is the loop's only memory: every step reads the task's state first and writes it back before it ends, so a session that dies mid-step is resumed by the next tick.

Each step has one owner. <who works a task (a child, a person); how the PR goes up and who asks for its review; who merges which verdict; who writes the task after the verdict; where people act>

<one diagram: Flow as the spine every step reads from and writes back to, each edge to it labelled with that step's Flow write; signal → intake → (person triages, decides) → child run or person → review request → review and merge → the tick after the verdict → release → close, with each scheduled run and each person's step on it>

| Stage | Owner | Fired by | Flow write before it ends | Governed by |
| --- | --- | --- | --- | --- |
| Intake | <triage runs, `product-health`-style scans, an agent mid-task>: a task with its investigation, or a capture; never a fix | <schedule or event> | a task with its `source`, or a capture | `Findings rule` |
| Triage | person | captures in the inbox | each capture a task, or discarded | GTF |
| Decisions | person | a `decision` task | the `decision` `waiting` on them, `blocks` the task; closed `completed` with the answer | `Decision gate`, `Human-reserved decisions` |
| Implementation (loop) | child run | manager tick | manager run; task claimed; child run `works_on`; PR as `implements`, what the merge leaves in the body; task `waiting` on CI and review | `Ready brief`, `Task size`, `Change decisions`, `Local checks`, `Child handoff` |
| Implementation (person) | person, by hand or with their own agent session | the person; the entry section | the task taken or written first; a session's agent run `works_on` it; the same PR writes as the loop | `Change decisions`, `Local checks` |
| Review request | <from `Review request`> | <CI green on a ready PR, …> | none: the task's wait already names it | `Review request` |
| Review and merge | <reviewer; who merges which verdict> | <label, event> | <its agent run only; a person's own writes> | `Merge rule` |
| After the verdict | manager tick, the only writer | its next tick | what the merge leaves: `completed` with its outcome, or the check's wait (GTF-E8); a release step task that `blocks` it; a wait on a person for what the rule reserves. Fallback: <what `Review request` and `Merge rule` give the loop> | `Closing evidence`, `Release procedure` |
| Release | <loop, CI, person> | merge | each release step a task that `blocks` the merged one, closed when it is in effect | `Release procedure` |
| Close | <who reads the checks> | due date | `completed` with what was observed, or `active` again (GTF-E8) | `Closing evidence`, `Verification target` |

## Where each piece lives

| Concern | Home |
| --- | --- |
| <each extension point and the Runtime> | <its pointer> |
| <each group of domain rules from step 5> | <its home and loading condition> |
| <each scheduled agent run> | <its file> |

## Gaps

<each step that writes nothing to Flow, as the Flow task that closes it; "none" when every step writes>
```
