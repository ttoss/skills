# Project parameters

The loop is generic; everything about **how a project delivers** is a parameter. The manager reads them from the consuming repo, first match wins: the `/flow-manager <project id>` argument (project id only), `.agents/flow-manager.md`, `.claude/flow-manager.md`, or a `## Flow manager` section of `AGENTS.md` / `CLAUDE.md`. [`/flow-setup`](../../flow-setup/SKILL.md) defines them with the user and writes the file.

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
| Release procedure | After a merge, what turns delivered work into work in effect — publish, deploy, bump a consumer, wait for a restart? Which steps does the loop run, which are automatic, which are a person's? | none: merged is in effect once CI deploys it, and nothing is batched |
| Closing evidence | What proves a task done, when is it checked, and who runs the check? | the standing decision's closing evidence; if silent, merged plus the repo's own verification. The loop runs the checks that come due (GTF-E8) unless this names another reader of them |
| Verification target | Where and with what credential the closing evidence is checked (API, database, logs), and which calls are read-only | none: a check that needs one becomes a `decision` waiting on the user |
| Human-reserved decisions | Which choices always go to a person as a `decision` that `blocks` the task (GTF-T3)? | product intent, security, auth, billing, data loss, migrations, public contracts |
| Decision gate | How a child tests an open choice before raising it (GTF-T3) | none: every open choice the task and the standing decision leave unanswered is raised |
| Task size | What counts as an independent delivery that the manager splits before delegating (section 4, step 2)? | a brief asking for more than one delivery that can ship alone (code + guard, backend + screen, migration + use, more than one repo) |
| Findings rule | What a child does with something it notices outside its task | GTF-C1: capture it; a prerequisite `blocks` the task (GTF-T4). **No inbox** — `ingest-capture` answers `not_found` for a project-restricted credential: write it as an `incubated` task `derived_from` the task at hand, never `blocks`, source and words verbatim in the body, basis the standing decision (GTF-C4, GTF-L3), named in the PR body or tick report |

## Tuning

| Parameter | Default | Overridden by |
| --- | --- | --- |
| Max runs | 2, per manager: the running children of the manager's name (`--manager`, default `flow-manager`) | `--max-runs N` (alias `--max-sessions`) |
| Voice | `terse` | `--voice terse\|normal` |
| Child handoff | `close`: the child pursues its task to its close. Any other value names the point where it stops, writes its state, its next step and what the merge leaves (the closing evidence, or the check GTF-E8 needs), and ends, each later need of its PR going to a fresh child — e.g. `review`: PR ready and review requested by the `Merge rule`. A runtime whose children end with the tick needs a point reachable without waiting on a reviewer | — |
| Child model | the manager's own model | — |
| Verification model | a mid-tier model: checks are reads and a templated write-back | — |

## Example

```markdown
# Flow manager

| Parameter | Value |
| --- | --- |
| Flow project id | `proj_xxxxxxxxxx` |
| Standing-decision task id | `task_xxxxxxxxxx` |
| Repos | `acme/api`, `acme/web` |
| Runtime | `ops/agent-runtime.md` |
| Merge rule | `docs/agents/merge.md` |
| Release procedure | Every merge to `main` deploys `acme/api`; `acme/web` bumps the published client — `docs/agents/release.md` |
| Closing evidence | `docs/agents/done.md` |
| Verification target | Staging API `https://api.staging.acme.dev`, token in `ACME_TOKEN`, GET only |
| Human-reserved decisions | `AGENTS.md` § Decisions |
| Decision gate | `docs/agents/open-questions.md` |
| Findings rule | default |
| Max runs | 2 |
| Voice | terse |
| Child handoff | close |
| Child model | inherit |
| Verification model | `<a mid-tier model id>` |
```

Shapes a release procedure can take, for `/flow-setup` to offer — none is the loop's own:

- **Continuous**: every merge deploys; nothing for the loop to do after merge.
- **Per-merge publish + consumer bump**: each merge publishes a package; a consumer repo bumps to it, one task per bump or batched.
- **Batched release**: an open `Release <repo> (next)` task that tasks meant to ship `block`; the loop cuts it when the project's batch condition holds, then writes the bump as a task and each shipped task's check as its GTF-E8 wait. The batch `blocks` the bump and the bump `blocks` every task it ships, never the reverse.
- **Manual**: a person releases; the loop waits on them (`external` wait).
