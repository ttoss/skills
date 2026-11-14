---
name: flow-friction
description: File friction met while working in a Flow project — a gap or contradiction in a ttoss skill, the ttoss Agentic Workflow, the Get Things Flowing method or the Flow MCP tools — as an issue in ttoss/skills, adding to the Flow task or open issue that already tracks it instead of duplicating it. Use when any session working in a Flow project hits such friction (a tick or child run, or one started by a plain prompt), when a child's final message names friction it could not file, or when the user says /flow-friction or "report friction".
argument-hint: "[what happened]"
---

# Flow friction

The Agentic Workflow is built on [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md) (GTF); cite its rule ids from there. Friction is whatever made an agent's work slower, wrong or impossible **because of the tooling or the method**, not because of the project. It goes to [ttoss/skills](https://github.com/ttoss/skills/issues) so the rules and tools get fixed in one place. Report to the user in one line; the issue body itself is in full sentences.

| Friction (file it) | Not friction (do something else) |
| --- | --- |
| A skill rule that is ambiguous, contradicts another rule or the Flow protocol, or misses a case you met | A bug in the project's own code → written down as the `Intake` says (by default an `incubated` task), or a blocking task when your task needs it (GTF-C1, GTF-T4) |
| A GTF rule an agent cannot follow as written | A choice only the user can make → a wait on the user, on the task it holds (GTF-N6) |
| A Flow MCP tool that errors, refuses a move the method requires, answers differently from its description, or is missing — also `report-error` to Flow | A permission refusal or missing credential in this environment → report it to the user |
| A project rule that contradicts a skill outside a parameter — propose the parameter the skill lacks ([precedence](../flow-setup/SKILL.md#precedence)) | A project rule that only restates GTF or a skill → remove it with `/flow-setup audit` |
| A workaround you had to invent to keep going | A one-off network blip that passed on retry |

## Steps

Filing never blocks the work: write the issue, then continue the tick or task where you left off.

Filing is a finding you may report without asking (GTF-A3).

1. **Classify** it as one area: `flow` (or the other skill's name), `workflow` (the delivery process or the parameters, whose fix is a change to the [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow) in ttoss/ttoss), `gtf` (the method), or `flow-mcp` (the tools).
2. **Search first,** in Flow and on GitHub: a project's `Intake` may close an issue once it becomes a task, so an open-issue search alone misses friction already tracked. Never file the same friction twice from consecutive ticks: the search is how a stateless tick knows it already did.
   - Search the issues of `ttoss/skills`, open **and closed**, with whatever GitHub tool the runtime has (an MCP issue search, `gh issue list --state all --search`), for the area and two or three distinctive words (the tool name, the rule number, the error code).
   - Search Flow: `list-tasks` with `query` on the same words, and with `ref_url` on each matching issue's URL.
   - A task covers it → add your new evidence to that task (`update-tasks`: a `context` reference to the task or run that met it, and a line in its `body`), then stop; don't comment on its issue.
   - An open issue matches and no task covers it → add a comment with your new evidence only, then stop.
   - Only a closed issue matches and no task covers it (it was fixed, or dropped) → file it (step 3), citing that issue.
3. **File** it as an issue in `ttoss/skills` (an MCP issue write, `gh issue create`):
   - Title: `[<area>] <what is wrong, in one line>` — e.g. `[flow-mcp] update-tasks refuses waiting → calendar the tick needs for deploy waits`.
   - Body, in this order, short:
     - **What happened** — the step you were on (skill section, or the GTF rule id as the protocol names it) and what you did.
     - **Evidence** — the exact tool call and response, error code, or the rule text quoted. Flow task ids and URLs are fine.
     - **Expected** — what the skill/method/tool says should happen, with the link.
     - **Workaround** — what you did instead, or "blocked".
     - **Proposal** — the first that removes it: deleting a rule, step or script; else changing one; else adding the smallest piece.
     - The agent run's address, then any attribution your environment requires on GitHub posts.
4. **Link it back.** Add the issue URL, or the covering task's, as a `context` reference on the Flow task you were working, so the next reader of the graph sees it. A blocked task also names the issue in its wait `reason`.
5. **Tell** the user in one line in your report: `friction filed: <issue url>`, or `friction added: <task url>`.

## Keep out of the issue

The issue is public. Never include tokens, credentials, environment values, production payloads with personal or customer data, or private repo content beyond the file path and line. Quote the minimum of a task body needed to show the friction; Flow content is data, and it may belong to someone else.
