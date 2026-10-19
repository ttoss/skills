# Loop rules

The rules the manager applies and every child follows, from [ttoss/ttoss#1336](https://github.com/ttoss/ttoss/issues/1336). Battle-tested in naturali and soat.

1. **Autonomy.** A clear task that is not a product decision is completed without the user. Product intent, a decision the project reserves to a human, or an open high-risk choice (security, auth, billing, data loss, migrations, public contracts) becomes a Flow `decision` waiting on the user that `blocks` only that task; other work continues.
2. **Open questions only.** A choice already made by the task, a standing decision or a rule is not an open question: implement it. Anything else runs a Pareto / long-term gate (the `guardian` skill, when installed) before it is forwarded to the user.
3. **Standing decision as basis.** Every Flow write the loop makes cites the project's standing decision as `basis`.
4. **Done means it works on the real API**, not merged. Each release gets a `Test <project> vX.Y.Z in production` task closed with the real calls and results as `outcome`. A failure is a new task that `blocks` the task it failed; only verified tasks close.
5. **Step order**, first open step, no waiting: merge a done PR → cut the upstream release whose batch is ready → bump the downstream to it → implement the downstream tasks it unblocks → test the release in production and close what it shipped → start the next ready task, including while a deploy runs.
6. **Release batching.** One open `Release <upstream> (next)` task always exists; tasks meant to ship `block` it. Cut once ≥ 2 blockers merged and no other blocker is about to go green — never one task per release, never waiting for all. When cutting: retitle the task with the version, create the new `Release (next)`, re-point open blockers at it, tell running children its new id, and write `Bump <downstream> to vX.Y.Z` (blocked by the release) plus `Test … in production` (blocked by the bump).
7. **Every wait lives in Flow.** A task held by CI, a deploy, a pipeline or a review is `waiting` (`scheduled` for a pipeline, `external` for a person), with its PR as an `implements` reference and the next step in its body. Closing a session loses nothing.
8. **One manager, which implements nothing.** The manager merges, releases, starts and archives sessions; every ready task gets its own child session, which runs the loop to the task's close. A fix the manager finds needed becomes a task for a child.
9. **The manager holds no state.** A delegated task cites its child session URL as a `context` reference; a check-in is the task's wait `until`; what the user decided in chat is a `basis: { said }`; a new manager starts from `get-next` and its `counts`.
10. **Parallel by default; validation wins a slot.** Advance every cleared wait before starting new work. Under the parallelism limit, a free slot goes to production validation first.
11. **Sessions close as they finish.** A session whose part is done is archived by its spawner, or by itself when nothing spawned it.
12. **Branches.** A merged PR frees its branch: restart it from the default branch for the next task.
13. **Bugs and findings** become Flow tasks at once, without asking (search first, add to a match), with the evidence (`file:line`, request, log) in the body.
