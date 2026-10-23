# Bootstrap

The Flow part of [`flow-setup`](SKILL.md) step 7. It creates what the loop needs in Flow, once per project. Creating a commitment is the person's call ([GTF-A1, GTF-A4](https://flow.ttoss.dev/docs/agents/protocol.md#authority)): list every write, numbered, and wait for their answer.

1. **Project.** `list-projects`; ask which one, or offer `create-project`.
2. **Standing decision.** Search for an existing one (`list-tasks` `kind: decision`, `query: "standing"`); the project may already have standing rules that cover part of it — cite them rather than restate them. If none authorises the loop, propose one `decision` task, closed `completed` with the user's verbatim answer as `basis: { said }`, titled `Standing: the delivery loop runs autonomously`, whose body is a target-pursuit standing rule saying what [GTF-T1](https://flow.ttoss.dev/docs/agents/protocol.md#pursue-a-target) asks for, built from step 4's answers:
   - **Allowed acts**: take, move and close tasks; start and end child runs; merge what the `Merge rule` lets the loop merge; the steps the `Release procedure` gives the loop; the read-only checks of the `Closing evidence` on the `Verification target`; write follow-ups by the `Findings rule` — including, when the credential cannot capture, a finding as an `incubated` task `derived_from` the task at hand, which the decision must list. Only acts an answer actually calls for — a project with no release procedure gets no release act.
   - **Closing evidence**: the `Closing evidence` answer.
   - **Permitted choices**: which ready task to start next, in `get-next` order (GTF-E1 leaves that choice to the person unless delegated), and choices that pass the `Decision gate`.
   - **Permitted tidying**: end finished child runs, restart merged branches, re-point the `blocks` edges the release procedure moves, plus any tidying rule the project already has.
   - **Reserved**: the `Human-reserved decisions`, and every act not listed above.

   The decision holds this text itself, so its authority does not depend on this skill's version (GTF-A6).
3. **Release procedure tasks.** When the procedure tracks work in flight in a task (a `Release <repo> (next)` batch, for one), propose that task (`active`), basis the standing decision.
4. **Write the parameters**, with the standing decision's id, to the parameters file (`.agents/flow-manager.md` unless the repo already has one), in the PR of step 8.

## The parameters file

Shapes a release procedure can take, for [`flow-setup`](SKILL.md) step 4 to offer — none is the loop's own:

- **Continuous**: every merge deploys; nothing for the loop to do after merge.
- **Per-merge publish + consumer bump**: each merge publishes a package; a consumer repo bumps to it, one task per bump or batched.
- **Batched release**: an open `Release <repo> (next)` task that tasks meant to ship `block`; the loop cuts it when the project's batch condition holds, then writes the bump as a task and each shipped task's check as its GTF-E8 wait. The batch `blocks` the bump and the bump `blocks` every task it ships, never the reverse.
- **Manual**: a person releases; the loop waits on them (`external` wait).

An example file, as step 4 above writes it:

```markdown
# Flow manager

| Parameter | Value |
| --- | --- |
| Flow project id | `proj_xxxxxxxxxx` |
| Standing-decision task id | `task_xxxxxxxxxx` |
| Repos | `acme/api`, `acme/web` |
| Runtime | `ops/agent-runtime.md` |
| Merge rule | `docs/agents/merge.md` |
| Local checks | `scripts/ci.sh`, the script the CI runs, and the preview check in `docs/agents/live-check.md` |
| Release procedure | Every merge to `main` deploys `acme/api`; `acme/web` bumps the published client — `docs/agents/release.md` |
| Closing evidence | `docs/agents/done.md` |
| Verification target | Staging API `https://api.staging.acme.dev`, token in `ACME_TOKEN`, GET only |
| Human-reserved decisions | `AGENTS.md` § Decisions |
| Decision gate | `docs/agents/open-questions.md` |
| Findings rule | default |
| Change decisions | `docs/agents/feature-flags.md`, `docs/agents/monitoring.md` |
| Instruction layout | `docs/agents/rule-layout.md` |
| Max runs | 2 |
| Voice | terse |
| Child handoff | close |
| Child model | inherit |
| Verification model | `<a mid-tier model id>` |
```

## The entry section

[`flow-setup`](SKILL.md) step 6 writes it, filled, into the repo's always-loaded entry file. It is what a session started without `/flow-manager` knows about Flow, so it stays short: pointers, never the rules they point to.

```markdown
## Flow

Work in this repo lives in the Flow project `<proj id>`; no other tracker holds it. Every session follows [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md) and the project parameters in `<parameters file>`, started by `/flow-manager` or not:

- Work through a task: the one you were given, or one you find (`list-tasks` with `query`) or propose before changing anything. Record your agent run against it (GTF-S7).
- Apply the parameters on the way: `Change decisions` and `Local checks` before the PR; `Merge rule`; `Findings rule`; `Decision gate` and `Human-reserved decisions` for open choices.
- The PR carries the task's URL; the task carries the PR as an `implements` reference and its state before you stop.
- Friction with a skill, GTF or a Flow tool → `flow-friction`, then continue.
- Where an instruction lives and when it loads: `Instruction layout`. A new one goes there, never only here.
```
