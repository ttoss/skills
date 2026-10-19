# Bootstrap

The Flow part of [`flow-setup`](SKILL.md) step 6. It creates what the loop needs in Flow, once per project. Creating a commitment is the person's call ([GTF-A1, GTF-A4](https://flow.ttoss.dev/docs/agents/protocol.md#authority)): list every write, numbered, and wait for their answer.

1. **Project.** `list-projects`; ask which one, or offer `create-project`.
2. **Standing decision.** Search for an existing one (`list-tasks` `kind: decision`, `query: "standing"`); the project may already have standing rules that cover part of it — cite them rather than restate them. If none authorises the loop, propose one `decision` task, closed `completed` with the user's verbatim answer as `basis: { said }`, titled `Standing: the delivery loop runs autonomously`, whose body is a target-pursuit standing rule saying what [GTF-T1](https://flow.ttoss.dev/docs/agents/protocol.md#pursue-a-target) asks for, built from step 4's answers:
   - **Allowed acts**: take, move and close tasks; start and archive child sessions; merge what the `Merge rule` lets the loop merge; the steps the `Release procedure` gives the loop; the read-only checks of the `Closing evidence` on the `Verification target`; write follow-ups by the `Findings rule` — including, when the credential cannot capture, a finding as an `incubated` task `derived_from` the task at hand, which the decision must list. Only acts an answer actually calls for — a project with no release procedure gets no release act.
   - **Closing evidence**: the `Closing evidence` answer.
   - **Permitted choices**: which ready task to start next, in `get-next` order (GTF-E1 leaves that choice to the person unless delegated), and choices that pass the `Decision gate`.
   - **Permitted tidying**: archive finished sessions, restart merged branches, re-point the `blocks` edges the release procedure moves, plus any tidying rule the project already has.
   - **Reserved**: the `Human-reserved decisions`, and every act not listed above.

   The decision holds this text itself, so its authority does not depend on this skill's version (GTF-A6).
3. **Release procedure tasks.** When the procedure tracks work in flight in a task (a `Release <repo> (next)` batch, for one), propose that task (`active`), basis the standing decision.
4. **Write the parameters**, with the standing decision's id, to `.claude/flow-manager.md`, in the PR of step 7.
