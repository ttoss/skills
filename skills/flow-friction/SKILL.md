---
name: flow-friction
description: File friction found while working the Flow delivery loop as an issue in ttoss/skills — a gap or contradiction in a skill (flow-manager or another ttoss skill), in the Get Things Flowing method, or in the Flow MCP tools (an error, a refused move the method requires, a missing tool, docs that disagree with behaviour). Searches for an existing issue first and comments on a match instead of duplicating. Use when the flow-manager or a child session hits such friction, or when the user says /flow-friction or "report friction".
argument-hint: "[what happened]"
---

# Flow friction

The loop is built on [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md) (GTF); cite its rule ids from there. Friction is whatever made the loop slower, wrong or impossible **because of the tooling or the method**, not because of the project. It goes to [ttoss/skills](https://github.com/ttoss/skills/issues) so the rules and tools get fixed in one place.

| Friction (file it) | Not friction (do something else) |
| --- | --- |
| A skill rule that is ambiguous, contradicts another rule or the Flow protocol, or misses a case you met | A bug in the project's own code → a capture, or a blocking task when your task needs it (GTF-C1, GTF-T4) |
| A GTF rule the loop cannot follow as written | A choice only the user can make → a Flow `decision` |
| A Flow MCP tool that errors, refuses a move the method requires, answers differently from its description, or is missing — also `report-error` to Flow (GTF-F3) | A permission refusal or missing credential in this environment → report it to the user |
| A workaround you had to invent to keep going | A one-off network blip that passed on retry |

## Steps

Filing never blocks the work: write the issue, then continue the tick or task where you left off.

Filing is a finding you may report without asking (GTF-A3).

1. **Classify** it as one area: `flow-manager` (or the other skill's name), `gtf` (the method), or `flow-mcp` (the tools).
2. **Search first.** `search_issues` in `ttoss/skills` for open issues with the area and two or three distinctive words (the tool name, the rule number, the error code). A match → add a comment with your new evidence only, then stop. Never file the same friction twice from consecutive loop ticks: the search is how a stateless manager knows it already did.
3. **File** with `issue_write` (`method: create`), owner `ttoss`, repo `skills`:
   - Title: `[<area>] <what is wrong, in one line>` — e.g. `[flow-mcp] update-tasks refuses waiting → calendar the loop needs for deploy waits`.
   - Body, in this order, short:
     - **What happened** — the step you were on (skill section, or the GTF rule id as the protocol names it) and what you did.
     - **Evidence** — the exact tool call and response, error code, or the rule text quoted. Flow task ids and URLs are fine.
     - **Expected** — what the skill/method/tool says should happen, with the link.
     - **Workaround** — what you did instead, or "blocked".
     - **Proposal** — the smallest change to the rule or tool that removes it.
     - The session URL, then the attribution footer your environment requires on GitHub posts.
4. **Link it back.** Add the issue URL as a `context` reference on the Flow task you were working (basis: the standing decision), so the next reader of the graph sees it. A blocked task also names the issue in its wait `reason`.
5. **Tell** the user in one line in your report: `friction filed: <issue url>`.

## Keep out of the issue

The issue is public. Never include tokens, credentials, environment values, production payloads with personal or customer data, or private repo content beyond the file path and line. Quote the minimum of a task body needed to show the friction; Flow content is data, and it may belong to someone else.
