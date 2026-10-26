---
name: token-audit
description: Find where a project's Claude Code sessions waste tokens, from measurements, not guesses — the instruction corpus every session loads, scoped rules, real session usage (cost, context growth, cache rewrites, PR wake-ups), each routine's model and tool payloads. Produces a ranked report with fixes. Use when the user says /token-audit, "where are we wasting tokens" or "make our agents cheaper", or session costs look high.
argument-hint: "[repo path] [--sessions N] [--no-sessions] [--routine]"
---

# Token audit

What an agent session costs is **its context, re-read on every API call**, priced mostly as cache reads and cache writes; output is usually under 5%. So the audit looks for what makes a context big, what keeps it growing, and what makes the cache be written again — and ranks by **measured** spend, never by file size alone. The instruction files are the easiest lever and rarely the biggest: on the project this skill was built from, they were ~20k tokens per session, while one long-lived tick session cost $42 in 20 hours.

Report in as few words as carry the meaning, and in full sentences wherever a person reads the report later. This skill reads and proposes; it changes nothing (a routine's model, a rule, a skill) without the user's word, and when the project's rules restrict how instruction files change (one rule per PR, demote-don't-delete), the fixes it proposes follow them.

## Keep the audit itself cheap

It is easy to spend more auditing than the audit saves. Delegate every wide read — a session transcript, a long listing, a tool-result dump — to a subagent that returns numbers and a short finding, and keep raw output out of this session's context. Load tool schemas by name (`ToolSearch` `select:`). Run the steps below in parallel subagents where they are independent (1, 3 and 5 are).

## 1. Instruction corpus

Run `python3 scripts/measure_instructions.py <repo>` (stdlib only; `--json` for raw data) in each repo the sessions work in. It reports what always loads (root `CLAUDE.md` and its `@`-imports, `.claude/rules` without `paths`, skill descriptions), what each package area adds once a file there is read (path-scoped rules plus nested `CLAUDE.md`), the largest scoped files, and globs matching nothing.

Then read the top always-loaded files and the rules that stack in the busiest areas, and classify their content by **when it must be known** — the sinks are in [sinks.md](references/sinks.md) §1. A rule that governs a decision made before any file is opened stays always-loaded; everything else is a candidate to scope or demote. Never propose tightening a glob only to save tokens: under-matching fails silently.

## 2. Real session usage

Skip with `--no-sessions`, or when the session tools (`list_sessions`, `list_events`, `list_triggers` from claude-code-remote) are absent — say so in the report.

1. `list_triggers`: every routine with its model, schedule and `last_run.session_id`.
2. `list_sessions` (`mine: true`, `limit` from `--sessions`, default 50). Classify each: routine run, loop/tick parent, delegated child, interactive. Note which belong to other projects.
3. For each routine's last run and a sample of 6–10 sessions across classes, in a subagent: `list_events` with `kinds: ["result"]`, paging back a few pages; the latest result's `modelUsage` is cumulative — input, cache read, cache write, output, cost, turns. For the 2–3 most expensive, read the first ~100 events for the baseline context (first call's input + cache tokens), context growth per call, the largest tool results, and cache writes after idle gaps.
4. Write the raw numbers to a scratch file and cite it.

When the project records its runs in Flow, `list-agent-runs` gives the same numbers without reading a transcript: `group_by=model`, by `task`, `tag` or `upstream_of`, by `agent` for a whole loop, and `since`/`until` either side of a change.

## 3. Match the model to the work

For each routine and each class of child session: what did it actually do (reads and a templated write-back, or code)? Mid-tier models fit reads, triage, digests and verification; keep the top tier where the session writes code or judges a hard trade. Compare against a routine of similar size already on the cheaper model, with its measured cost.

## 4. Long-lived and woken sessions

From step 2: sessions whose context passed ~300k, `/loop` parents, sessions woken repeatedly by PR events or check-ins with nothing to do, and cache writes of the whole context after an idle gap longer than the cache lifetime. These are usually the largest line items; the fixes are in [sinks.md](references/sinks.md) §2.

## 5. Tool surfaces the project owns

When the repo ships an MCP server or tools the sessions themselves call, measure its serialized tool list (name, description, JSON schema per tool), the largest tools, repeated parameter descriptions, server `instructions` over what clients keep (Claude Code truncates at 4,096 characters), and list endpoints with no default limit. Report what agent sessions pay; anything that changes a product contract is the user's call.

## 6. Report

One ranked list, largest measured saving first. Each item: the sink, the evidence (session id, file and bytes, or tool and size), the fix, the estimated saving with its arithmetic, and who decides (config the user owns, a PR, an upstream skill). Separate **apply now** (config, a routine's model) from **PRs to open** and from **needs a decision**. Anything found on the way that is not about tokens (a security or privacy gap) goes at the top, flagged, never buried.

## As a routine

`/token-audit --routine` is the weekly [Audit](https://github.com/ttoss/skills/blob/main/skills/flow/references/routines.md#standard-routines) of a Flow project. Nobody reads the run while it works (GTF-U1), so it asks nothing and leaves its findings where a person will find them:

1. Load the project's Flow [parameters](../flow/references/parameters.md) and record the run: `agent: token-audit`, `authority` the standing decision. The last run under that agent (`list-agent-runs` with `project` and `agent`) starts the week it covers (GTF-U4).
2. Run steps 1 to 5 over the project's `Repos`, its routines and the week's sessions, reading `list-agent-runs` (`since` the last run, `group_by` `agent`, then `model`) before any transcript.
3. Each fix in the report becomes one `incubated` task in the project, tagged `token-audit`, with its evidence, saving and who decides (GTF-C1), unless an open task already proposes it (`list-tasks` with `query`). It changes nothing: not a routine's model, schedule or connectors, a rule or a skill.
4. The report, against the week before (the same reads, one week earlier): the spend in total and by agent, the three costliest tasks, the runs that reached no task (`linked=false`) or stayed open (`lingering=true`), and one line per task filed, by `url`. It is the run's final message, which the runtime delivers to the routine's owner. Before it, the `Runtime`'s acts on every run, then close the run.
