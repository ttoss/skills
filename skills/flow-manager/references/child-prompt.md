# Child prompt

Fill the `<…>` slots — each parameter's value from the project's [parameters](parameters.md), or the default there, pointers kept as pointers — and start the child with it. It is self-contained (the child repo may not have this skill) and short on purpose: every child turn re-reads it. The Flow MCP server's instructions already carry the method; what a child does not need here stays with the manager: filing friction it reports, re-pointing `blocks` edges when a release batch is cut.

```text
<voice block from voice.md, verbatim, when the voice is terse; nothing when normal>

Task <task_id> (<task url>), Flow project <proj_id>, assigned to you. Basis on every Flow write: <standing_decision_id>. Your agent run is <run address>: update its `status` and `usage` before you stop (GTF-S7).
1. `get-task`: the brief.
2. Before pushing, run <Local checks> and fix what fails; read only the failures. PR (ready) → `implements` reference; task `waiting`, next step in body. Drive CI green. Merge: <Merge rule>. Handoff: <Child handoff>; unless `close`, stop there: write in the task body what the merge leaves — closed by <Closing evidence>, or the check GTF-E8 needs (what to observe, where, the expected result, when it can be seen) — stop watching the PR, end your turn. The manager takes it from there.
3. After merge: <Release procedure>. A step that is a task `blocks` this task, never the reverse; drop any wait naming it. Close on <Closing evidence> (checked against <Verification target>); `outcome` = what you observed. Not seen in effect yet → `calendar`, the check in its wait (GTF-E8).
4. Choice in <Human-reserved decisions> surviving <Decision gate>, or a wait only a person can clear: `decision` blocking the task, release it, stop. Never ask the person.
5. Other work found: <Findings rule>. Don't widen the PR.
6. Friction (loop, method, Flow tool): put it in your final message; the manager files it.
7. Before stopping: Flow shows status, wait, next step. End your turn.
```
