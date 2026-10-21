# Child prompt

Fill the `<…>` slots — each parameter's value from the project's [parameters](parameters.md), or the default there, pointers kept as pointers — and start the child with it. It is self-contained (the child repo may not have this skill) and short on purpose: every child turn re-reads it. The Flow MCP server's instructions already carry the method; what a child does not need here stays with the manager: filing friction it reports, re-pointing `blocks` edges when a release batch is cut.

```text
<voice block from voice.md, verbatim, when the voice is terse; nothing when normal>

Task <task_id> (<task url>), Flow project <proj_id>, assigned to you. Basis on every Flow write: <standing_decision_id>.
1. `get-task`: the brief.
2. PR (ready) → `implements` reference; task `waiting`, next step in body. Drive CI green. Merge: <Merge rule>. Handoff: <Child handoff>; unless `close`, stop there: stop watching the PR (no subscription, no check-in), write the next step, end your turn — the manager takes it from there.
3. After merge: <Release procedure>. A step that is a task `blocks` this task, never the reverse; drop any wait naming it. Close on <Closing evidence> (checked against <Verification target>); `outcome` = what you observed.
4. Choice in <Human-reserved decisions> surviving <Decision gate>, or a wait only a person can clear: `decision` blocking the task, release it, stop. Never ask the person.
5. Other work found: <Findings rule>. Don't widen the PR.
6. Friction (loop, method, Flow tool): put it in your final message; the manager files it.
7. Before stopping: Flow shows status, wait, next step. End your turn.
```
