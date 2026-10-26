# Token sinks and their fixes

Each sink was measured on a real project (OneClick Ads, 2026-10-19/20). Numbers are what was observed there, as calibration, not thresholds. Back to [the skill](../SKILL.md).

## 1. Instructions

| Sink | Evidence it was | Fix |
| --- | --- | --- |
| Rules with no `paths` that govern editing, not deciding | 18 always-loaded rules, 73 KB; about half was editing guidance, procedure or history | Scope by `paths` (generous globs), or demote the procedure and history to a linked file that loads on demand |
| Incident narrative, measurements and decision history inside a rule | "Decided on", issue numbers and measured tables were 10–14% of package `CLAUDE.md` files | Keep the rule and its why; move the evidence to a linked companion file |
| Busy packages stacking scoped rules | Reading any file in the app package loaded 16 rules + `CLAUDE.md`, 81 KB | Demote content inside the big rules; do not tighten their globs |
| The same rule in two places | A notifications rule in the root `CLAUDE.md` and the package's own | One owner; the other links |
| Long skill descriptions | Descriptions load every session; 13 skills = 8 KB, the longest 950 B | Trigger phrases and scope only, ~400 B; the body holds the rest |
| Path-specific sections in a root `CLAUDE.md` | 4 KB of package-only sections in a 9 KB root file | Nested `CLAUDE.md` in the directory it governs |
| A stale size claim used as an argument | A rule cited "~294 KB / 75k tokens" always loaded; measured 81 KB / 20k | Re-measure with the script before any rule argues from size |
| Line-initial `@word` in a `CLAUDE.md` | An attribution handle wrapped onto its own line | Rewrap: a line-initial `@path` is an import |

## 2. Sessions

| Sink | Evidence it was | Fix |
| --- | --- | --- |
| A tick that never starts fresh | A `/loop 30m` tick reached a 760k context, $42 in 20 h; ~700k re-read per call | One routine firing a fresh session per tick (state lives in the task graph), or `/compact` when it grows |
| Cache rewritten after idle gaps | Two full-context cache writes (657k, 698k tokens, ~$5 each) after 2 h and 9 h idle | Same as above; a session that must idle long should be small |
| Top-tier model on read-only work | Opus routines $4–5 per run; a same-size Sonnet routine $0.87 | Mid-tier for reads, triage, digests, verification; top tier where code is written |
| Children inherit the parent's model | A one-query verification child on Opus, $2.45 | Pass `model` per child by the kind of task |
| PR and check-in wakes on big sessions | 300–380k re-read per "nothing to do" wake, several per PR | Finish and archive after merge; poll from a small fresh session |
| Bulk tool-schema loading | `ToolSearch "+Flow"`, 30 results: a 41k-token cache write | `select:` the tools the procedure names |
| Large list payloads kept to the end | Error-tracking list at limit 100 (19k chars), task lists and task bodies up to 20k; one run grew 84k → 292k | Small pages; summaries before full reads; subagents for wide reads |
| Scoped rules attaching mid-run | Reading 9k of source in one package triggered a 32k-token write | Section 1 fixes; read only the files the task needs |
| A routine cloning repos it never reads | A routine configured with three repos for a Flow-only procedure | Configure only the repos the procedure touches |

## 3. Tool surfaces the project owns

| Sink | Evidence it was | Fix |
| --- | --- | --- |
| Shared sub-schemas inlined per variant | Four tools were 45% of an 83-tool list (309 KB); one was 64k chars | `$defs` / references, or one shorter description and a pointer |
| The same parameter description repeated | 76 KB of repeats (one 2 KB description ×10) | Shorten at the source; a shared constant still repeats on the wire |
| Server `instructions` past the client limit | 9.6 KB; Claude Code keeps 4,096 chars, the rest never arrives | Cross-tool routing only, under 4 KB; per-tool rules live in the tool |
| Every tool sent up front | An 80k-token list for clients that do not defer tools | Deferred registration (search / describe / call) where the server supports it |
| Raw rows and no page cap | Read tools returning DB rows unformatted; list endpoints with no default limit or `.max()` | Format results to what a caller uses; default and maximum page size |
