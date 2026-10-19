# Loop rules

The rules the manager applies and every child follows. They extend [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md) (GTF) and never restate it: each rule cites the GTF rules it applies and says only what the loop adds. Read the cited ids in the protocol; when GTF changes, the loop follows. Anything not covered here falls back to GTF.

Every rule here is true of any project. What differs between projects — how a PR is merged, what happens after, what proves a task done — is an extension point named in **bold** and answered by the project's [parameters](parameters.md); the [precedence](../../flow-setup/SKILL.md#precedence) says how the two combine.

| # | Loop rule | GTF it applies | What the loop adds |
| --- | --- | --- | --- |
| 1 | **Autonomy** | GTF-T1, GTF-T3, GTF-N6 | A clear task is worked to its close without the user. Choices in **Human-reserved decisions** are never delegated; each blocks only its task, other work continues. |
| 2 | **Open questions only** | GTF-T3 | A choice the task, the standing decision or a project rule already makes is not open: implement it. An open one runs the **Decision gate** before it becomes a `decision`. |
| 3 | **Standing decision as basis** | GTF-T1, GTF-A2, GTF-E4 | One standing decision per project authorises the loop; it is cited on every write. |
| 4 | **Done is the project's closing evidence** | GTF-E3, GTF-E8, GTF-T4, GTF-T5 | A task closes on its **Closing evidence**, checked against the **Verification target**, with what was observed as `outcome`. A failed check is a task that `blocks` the one it failed. |
| 5 | **Step order** | GTF-E1, GTF-T2 | First open step, no waiting: merge a done PR (**Merge rule**) → run the **Release procedure** on what merged → work the tasks it unblocks → verify what is due → start the next ready task, including while a deploy runs. |
| 6 | **Delivered is not in effect** | GTF-E8, GTF-S5 | Between merge and closing evidence, every step of the **Release procedure** is a task or a wait in Flow: the loop's steps are tasks, automatic ones `scheduled` waits, a person's `external` waits. |
| 7 | **Every wait lives in Flow** | GTF-S3, GTF-S5, GTF-N4 | CI, a deploy or a pipeline is a `scheduled` wait; a reviewer is `external`. The PR is an `implements` reference and the next step is in the body. |
| 8 | **One manager, which implements nothing** | GTF-T6 | The manager merges, runs the release procedure's loop steps through children, starts and archives sessions; each ready task gets its own child session, which pursues it to its close. |
| 9 | **The manager holds no state** | GTF-S1, GTF-S4, GTF-E9 | A delegated task cites its child session URL as a `context` reference; a new manager rebuilds everything from `get-next`. |
| 10 | **Parallel; verification wins a slot** | GTF-E8, GTF-R6 | Advance every cleared wait before new work. Under the session limit (`--max-sessions`), a free slot goes to verification that is due first. |
| 11 | **Sessions close as they finish** | GTF-S3 | A session whose part is done and written back is archived by its spawner, or by itself when nothing spawned it. |
| 12 | **Bugs and findings** | GTF-T4, GTF-C1, GTF-C3, GTF-A3 | Work the task cannot finish without becomes a task that `blocks` it, with the evidence (`file:line`, request, log). Everything else follows the **Findings rule**; search first, add to a match, and tell the user when it is urgent. |
