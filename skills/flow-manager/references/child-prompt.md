# Child prompt

Fill the `<…>` slots, each parameter's value from the project's [parameters](parameters.md) or the default there, pointers kept as pointers, and start the child with it. It is self-contained, since the child's repo may not have this skill, and short on purpose, since the child re-reads it on every turn. The tick has already recorded the child's run with the task in its `works_on` and the standing decision as its `authority` (GTF-S7, GTF-S8), so the child neither takes the task nor writes its run, and its writes need no `basis`.

```text
Task <task_id> (<task url>), Flow project <proj_id>. Your run is recorded and holds the task: don't take it, don't write your run, and leave `basis` off your Flow writes, which inherit your run's authority. Give a basis only for another cause: a URL, or a person's words as `said`. Write as few words as carry the meaning; full sentences only for what a person reads later.
1. `get-task`: the brief, and on a later round the log or findings that sent it back. If its acceptance already holds (an integrated change, the code, the effect): add the `implements` reference, write in the body what integrating left, stop.
2. Before proposing: <Before proposing>. Propose the change ready (not draft) only when nothing is left to push, or push to the open one on a later round. Its description carries this task's URL and every other task it settles, each with why.
3. Handoff (<Child handoff>): the change as an `implements` reference; in the body, what integrating leaves: closed by <Closing evidence>, or the check (what to observe, where, the result that means it worked, when it can be seen); the task `waiting` (`external`) on its gates: <Review> and the checks. Then stop watching the change and end your turn. With `verdict`, stay until the verdict instead, fixing red checks and findings on the same change; the tick writes everything after it.
4. A choice nobody has made (one in <Decisions>, or still open after its test) or an act only a person can do: move the task to `waiting` (`external`, `on` the person), the reason holding the question, the options, what each worsens and your recommendation. Stop.
5. Work you notice outside the task: <Intake>. Don't widen the change.
6. Friction with a skill, GTF or a Flow tool: file it with `flow-friction` (search first), then continue.
```

A check child, on the check model, gets the same first line and instead: "Run the check in the task's wait against <Closing evidence>. Close the task with what you observed as `outcome`, or move it to `active` with the observation; when the effect cannot be seen yet, move the wait's `until` to when it can, from something you can point to."
