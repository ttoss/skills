# Chase

`/flow <project id> --chase` runs the [Chase](routines.md#standard-routines): it tells each person what the graph waits on them for, once the wait asks to be chased (GTF-N4). It works on no task and writes nothing to Flow but its run, recorded in section 0 with `agent: flow chase`; it needs `get-next`, `get-task`, `get-project`, `upsert-agent-run`, `list-agent-runs` and the delivery's tool.

1. `get-next` with `project: [<id>]`, `slice: waiting`, `assignee: ["any"]` (the default hides what a teammate holds) and `limit` 100. Keep a task whose `readiness.blocked_by` holds an `external` wait, with the first label that matches:
   - **overdue**: the wait's `until` has passed, by that many whole days;
   - **no chase date**: the wait has no `until`, and the task was not written for 7 days (`updated_at`);
   - **decision waiting**: a `decision` not written for 7 days.

   The rest are within their date: leave them out.
   Then the runs of other agents left holding work: `list-agent-runs` with `project`, `status: [running]` and `limit` 100. Keep a run whose `agent` is not `flow tick`, `flow child` or `flow chase` (the tick closes stale children itself), and that started longer ago than the `Runtime`'s `Stale after` (default 4 hours); each open task in its `works_on` is kept as **held by a stale session**, with the run's `url` and start, under the person who recorded it (`by`).
2. `get-task` each task kept: a stale session's task only when open, a wait's for whom its wait is `on`; and group by that person: a member by their email (`get-project`), a team by its name, a wait with no `on` under "nobody named: say who decides".
3. Write the digest in the project's language: a title line with the date; per person, longest wait first, one line per task, `[title](url) — <label> — <the question, from the wait's reason>`, and for a stale session `[title](url) — held by a stale session — <run url> since <date>: close the run, or release the task`; the counts last. Nothing kept: no digest.
4. Deliver it where the Chase's row in `Routines` says, such as a channel; otherwise it is the run's final message, which the runtime delivers to the routine's owner.
5. The `Runtime`'s acts on every run, then close the run. The final message is the digest, one line naming where it went and how many tasks it holds, or one line saying there was nothing to chase.

Never move a task, change a wait or its `until`, or send anything but the one digest.
