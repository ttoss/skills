# Judges

Read by the `flow` tick when the planner returns a `judge` act: read only the section of the judge it names (`sed -n '/^## `<judge>`/,/^## /p'`). **Each answer is written where it lives before the planner runs again**, so a tick that ends after any act leaves the next nothing to judge again (GTF-S4): an answer kept only in the snapshot dies with the tick, and the next judges it again. A write cites the standing decision through the tick's run. Each judge below names where its answer is written. Verdicts about a change stay on the change, bound to its commit, and readings of the parameters are read again each tick, since the parameters file is their home.

## `child_left_no_handoff`

Read what the child did (its change, its last message) and write it on the task, status, wait and `after_integration` included, then close its run. Written: the task.

## `merge_rule`

A **change to its own gates**, which the default `Merge rule` keeps for a person, is read from the change's file names first, never every patch at once (on GitHub, `gh api repos/<owner>/<repo>/pulls/<number>/files --paginate --jq '.[].filename'`), then the hunks of only the files that could hold one (tests, CI configuration, thresholds): a test file or case removed, a `skip`, `only` or `todo` marker added, a threshold lowered, the CI configuration or required checks altered. A test added or a threshold raised is none. What else the `Merge rule` reserves is the parameter's. Read again each tick from the change's file list, its home.

## `findings`

A FINDINGS verdict for the head with an automatic round left. Read the verdict and the `Merge rule`. A finding the rule gives to a person (one the reviewer marks for a person, such as product intent, a change outside the repo or a credential the agents lack), or a change the rule reserves to a person (a gate it names) → `change.findingsToPerson: true`, and the task waits on that person, naming the findings, with no round. Otherwise `false`, and the round goes. When unsure, it is a person's. Then run the planner again. Written: the wait, or the round's move, in the same tick.

## `review`

The parameters state no `Review`, so a change with no verdict cannot be read as reviewed. Read the parameters' prose: a reviewer named → `params.reviewRequired: true`; none → `false`; then run the planner again. Say in the report line that the `Review` item is missing. A reading of the parameters: read again each tick.

## `wait_against_world`

A wait that states a check is a check child's, not yours. Any other due wait is checked against the world: cleared → `active`, citing what you checked; still held → move `until` to the next check. A wait `on` a person stays: it is theirs. Written: the move, or the new `until`.

## `ready_brief`

A brief that meets the `Ready brief` → tag the task `flow-brief-ready`, citing the standing decision, and the snapshot reads `brief: 'ready'` from it. A brief short of the `Ready brief`, one that names no closing validation when the `Closing evidence` lists more than one (a validation that does not fit what the task promises counts as none), or a choice the standing decision does not delegate → the task waits on the person, naming what is missing (GTF-N6): the wait is the answer. Whoever writes a brief may tag it ready, so this judge is the fallback; an agent that rewrites a brief removes the tag. **Already done?** A change in the project's repos names the task and the task has no `implements` reference → add it, and the next planner run advances it. Every task that `blocks` it closed and they were its parts → its child is a check child, reading their outcomes against the task's acceptance; tag it `flow-brief-ready` too.

## `person_free`

The release queue is full, the lane is free and nobody read this candidate yet. `get-task` it and answer from the brief alone. Person-free only when all hold: the closing validation it names closes the task at integration, or by a check an agent reads (the `Closing evidence` names no person as its reader), with nobody testing; the `Merge rule` lets the agents integrate what the brief says it touches (no path, gate or instruction it reserves to a person); it needs no feature flag, manual step or release a person takes part in; and it leaves no choice open. Write the answer as a tag on the task, citing the standing decision, so no tick reads it again: `flow-person-free`, else `flow-needs-person`. When unsure, it needs a person. Then run the planner again: it starts the task in the lane, or asks about the next candidate.

## `reversal`

Whether the change's description records a reversal path, read from the description alone. A revert, a flag, a paired down-migration → that change's `reversal: 'recorded'`. It says it has none, or says nothing → `'none'`, which makes the task wait on a person, naming the red pipeline. Then run the planner again. Read again from the description, its home; the revert and its move, or the wait, land in the same tick.

## `leaves`

The task carries no `after_integration`. Read what integrating leaves from its body and its handoff (the reasons of its waits, the change's description), in whatever language they are written: `close`, `release`, `check`, or `none` only when none states a level or a check. A closing validation the brief names from the `Closing evidence` is a stated level: `close` for the one at integration, else the `release` or `check` that validation needs. A stated level counts even when its date is relative ("release + 30 days") or it carries a caveat: derive `visible_at` from the merge or release date and the stated rule. When none states one and the `Closing evidence` gives the agent the choice, choose it yourself from the change and the task's acceptance, with the reason; `none` only when the choice is a person's, or the change cannot be read. The level is written as the task's `after_integration` with the act, its reason in the body, so no tick reads it again. `none` writes no field and makes the task wait on a person, naming what is missing; the person answers by writing `after_integration`, and the next tick applies it.

## `closing_evidence`

A task waits on a person because nothing said what integrating leaves, and `params.leavesByAgent` is not known. Read the `Closing evidence` and what it points to: it gives the agent the choice of the level → `true`; it keeps it for a person, or says nothing about it → `false`; then run the planner again. A reading of the parameters: read again each tick. With `true`, the planner asks `leaves` again for each such wait, so a parameter changed after the wait was written governs it without a person touching every task.

## `sent_back`

A task nobody holds is `active`, written after its change integrated. Read its history with `get-task`: a failed check's observation, a revert or a person asking for rework → `sentBack: 'round'`; a person moved it off `calendar` before its check's date, with no failing observation, asking for the check now → `'check'`, and a check child takes it; the last write only handed it off, an `implements` reference to a change that had already integrated (its acceptance already held) with `after_integration` → `'handoff'`, and the planner applies what integrating leaves. A round or a check waits for a slot, so it is written as a tag, `flow-sent-back-round` or `flow-sent-back-check`, citing the standing decision; the tick removes it when it starts the child (`untag`), since the task's next send-back is a new question. A handoff is written by the acts it leads to. Then run the planner again.

## `released`

A task that waited for its release is `active` and nothing holds it. Read its history with `get-task`: a `blocks` source that closed after its change integrated, the release step, → `released: true`, and the planner applies its check's wait or closes it citing the step; moved to `active` after a failed check or a revert → `false`, a round, written as the tag `flow-sent-back-round` (removed as above). `true` is written by the move or close it leads to, in the same tick. Then run the planner again.

## `integrated_blockers`

A task is held only by `blocks` sources whose change integrated and that stay open (a release or a check later). Retracting the edge is the person's, since building on work nobody validated makes reverting the source cost more while the target's wait costs only delay: no option dominates. Read the standing decision: it delegates retracting such an edge, in general or for a kind of dependency the task matches (such as "a code-only dependency is released on integration") → `params.retargetByAgent: true`; it says nothing → `false`, and the finding stays in the report for the person. Then run the planner again. A reading of the standing decision: read again each tick.

## `default_red`

No required check or integration pipeline ran on the repo's default branch head, so the script could not tell whether it is red. Read the head's runs against the repo's CI configuration: a failed check that gates every change there → that default's `red: true`; housekeeping, a deployment of something else, or nothing failed → `false`. Then run the planner again. Read again each tick: the head moves.

## `repos`

Children share the tick's push branch and a candidate has no change yet: name the repos its child will push to, from its brief (`owner/repo` as the parameters' `Repos` write them). A brief naming none touches the repo the tick runs in. Write each as a `context` reference on the task to the repo's root (`https://github.com/<owner>/<repo>`), which the snapshot reads back as its `repos`, then run the planner again.

## `split`

A brief asking for more than one delivery that can ship alone → tasks with their own acceptance, `blocks` edges in the order they ship and the original as the target they block (GTF-T4); the first wave is delegated. A part inherits only premises you checked: one about another repo is read in that repo's code first, cheaply, and one you cannot check goes into the part's brief as one to verify first. Written: the tasks it made; the original's brief is rewritten, so its `flow-brief-ready` tag goes, and a part you judged ready carries it.
