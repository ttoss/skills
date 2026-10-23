# Project parameters

The loop is generic; everything about **how a project delivers** is a parameter. The manager reads them from the consuming repo, first match wins: the `/flow-manager <project id>` argument (project id only), `.agents/flow-manager.md`, `.claude/flow-manager.md`, or a `## Flow manager` section of `AGENTS.md` / `CLAUDE.md`. [`/flow-setup`](../../flow-setup/SKILL.md) defines them with the user and writes the file. They bind every session working in the repo, not only the loop's: the [entry section](../../flow-setup/bootstrap.md#the-entry-section) sends a session started by a plain prompt to them.

A value is either the rule written inline or a pointer to the project file that holds it (`` `docs/agents/release.md` ``). A pointer keeps one source of truth: the manager and every child read the file, never a copy.

## Identity

| Parameter | Required | What it is |
| --- | --- | --- |
| Flow project id | yes | `proj_...` |
| Standing-decision task id | yes | the `decision` that authorises the loop (GTF-T1) |
| Repos | no | every repo the tasks touch, so children start with them |
| Runtime | no | a pointer to the project file that says how its runtime starts, reads, ends and messages a child run, and which tools a tick loads — often the file the scheduler runs. Empty: the manager uses what its tools offer |

## Extension points

Each one answers a question the loop asks but cannot answer for every project. Left empty, the loop uses the default in the last column — and the first report says which defaults are in force.

| Parameter | The loop asks | Default when empty |
| --- | --- | --- |
| Merge rule | When may a done PR be merged, and by whom? | CI green on the head, no conflict, no unresolved blocking review thread |
| Review request | Who asks for the review of a PR that is ready, and when; and what the loop does with a request that was lost (it fired no review, or a review claimed it and posted nothing) | none when the `Merge rule` asks for no review; else the PR's author asks for it once CI is green on the head, and the next tick asks again for a ready PR whose head has green CI and no review |
| Local checks | What the CI runs that a child can run before it pushes — lint, types, tests, a build, a preview deploy, a live check — so its PR goes up green | the repo's own fast checks: lint, typecheck and the tests of what changed |
| Release procedure | After a merge, what turns delivered work into work in effect — publish, deploy, bump a consumer, wait for a restart? Which steps does the loop run, which are automatic, which are a person's? | none: merged is in effect once CI deploys it, and nothing is batched |
| Closing evidence | What proves a task done, when is it checked, and who runs the check? | the standing decision's closing evidence; if silent, merged plus the repo's own verification. The loop runs the checks that come due (GTF-E8) unless this names another reader of them |
| Verification target | Where and with what credential the closing evidence is checked (API, database, logs), and which calls are read-only | none: a check that needs one becomes a `decision` waiting on the user |
| Human-reserved decisions | Which choices always go to a person as a `decision` that `blocks` the task (GTF-T3)? | product intent, security, auth, billing, data loss, migrations, public contracts |
| Decision gate | How a child tests an open choice before raising it (GTF-T3) | none: every open choice the task and the standing decision leave unanswered is raised |
| Ready brief | What a task's body must state before a child may start it (section 4, step 3)? | an objective and an acceptance a child can check; a body that only says it needs triage or a person's input is not one |
| Task size | What counts as an independent delivery that the manager splits before delegating (section 4, step 3)? | a brief asking for more than one delivery that can ship alone (code + guard, backend + screen, migration + use, more than one repo) |
| Findings rule | What a child does with something it notices outside its task | GTF-C1: capture it; a prerequisite `blocks` the task (GTF-T4). **No inbox** — `ingest-capture` answers `not_found` for a project-restricted credential: write it as an `incubated` task `derived_from` the task at hand, never `blocks`, source and words verbatim in the body, basis the standing decision (GTF-C4, GTF-L3), named in the PR body or tick report |
| Change decisions | What every change must decide, and record in its PR, beyond passing the `Local checks` — e.g. whether it ships behind a feature flag, how production will show it broke, what a new scheduled job does on its first run, the order of a migration and its use | none: a change records only what its brief's acceptance asks |
| Instruction layout | Where the project's agent instructions live, when each loads (every session, only while some files are edited, only when linked), and where a new one goes | the entry file (`AGENTS.md` or `CLAUDE.md`) holds what a session must know before it opens any file; a rule about editing some files loads with those files; reference text is linked, never loaded by default |

## Tuning

| Parameter | Default | Overridden by |
| --- | --- | --- |
| Max runs | 2: the project's running children, whichever manager started them | `--max-runs N` (alias `--max-sessions`) |
| Voice | `terse` | `--voice terse\|normal` |
| Child handoff | `close`: the child pursues its task to its close. Any other value names the point where it stops, writes its state, its next step and what the merge leaves (the closing evidence, or the check GTF-E8 needs), and ends, each later need of its PR going to a fresh child — e.g. `push`: the PR is up after the `Local checks` pass, its CI and review left to the manager; `review`: PR ready and review requested by the `Review request`. A runtime whose children end with the tick needs a point reachable without waiting on a reviewer | — |
| Child model | the manager's own model | — |
| Verification model | a mid-tier model: checks are reads and a templated write-back | — |

An example parameters file, and the release-procedure shapes `/flow-setup` offers, are in [bootstrap](../../flow-setup/bootstrap.md#the-parameters-file).
