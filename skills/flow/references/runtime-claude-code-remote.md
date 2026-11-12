# Runtime preset: Claude Code sessions

The tick and each child run in a cloud session of their own, through the `claude-code-remote` tools. A project names this preset as its `Runtime` and adds what differs: `<repo>` below (the repo its sessions start from), the other repos a child adds, its models, its max runs.

**The tick** runs in a session of its own with the prompt `/flow <project id>`: the one a routine starts on each firing, or `create_session` with `source_url` `<repo>` and tag `flow-tick`. Its run address is that session's URL.

| Act | How |
| --- | --- |
| Start | `create_session` with `source_url` `<repo>`, tags `flow-child` and the task id. The child runs `add_repo` for each other repo its task touches, and `add_repo ttoss/skills` to file its own friction. The run address is `https://claude.ai/code/<session id>` |
| Read | `get_session`: `status_bucket` (`working`, `review_ready`, `blocked`, `completed`, `failed`); `SESSION_STATUS_ARCHIVED` is gone |
| End | Close the Flow run (`upsert-agent-run` `status`, `usage` from the session), then `archive_session`. A closed run with a live session is not ended |
| Message | `send_message` |

A tick without `create_session`, such as a routine fired with only the trigger tools, runs its children in-process, in the foreground, each in its own copy of each repo (`flow` § Child runs). Each pushes from that copy to a branch of its own per repo: `<the session's branch>-<task id>`, or on a later round the open change's head branch. No branch is shared, so there is no cap: `params.branchesPerRepo` stays `null`. The session's git proxy accepts a push to a branch other than its designated one but refuses to delete a remote branch, so a merged branch goes by the repo's "Automatically delete head branches" setting, or a person deletes it.

A child started with `create_session` pushes to its own session's branch. The Flow tools there may carry another server prefix, so its prompt adds: "Load the Flow tools by name (`ToolSearch` `+get-task`), never by `select:mcp__Flow__…`"; and a repo it pushes to other than `<repo>` needs `add_repo` with `access: "push"`.

**The code host** is GitHub, through the GitHub MCP tools; `gh` in these sessions is for search only, and the session's permission policy may refuse a write through it.

| Act | How |
| --- | --- |
| Integrate | `merge_pull_request` with `merge_method` the `Merge rule`'s and `expectedHeadSha` the head the verdict is for |

**Run records** are a hook: [`scripts/session-run.mjs`](../scripts/session-run.mjs) records every session's run at its session URL, creating it at the start, writing its `model` and `usage` at each turn's end and closing it `completed` at the end unless something else already closed it. Usage is kept per model: the session's run holds its main thread's model; an in-process child that recorded its own run (its first `upsert-agent-run`) gets its tokens on that run; any other model's tokens go to `<session URL>#model=<model>`, with the session's run as `parent`, so `group_by=model` never prices a child at the tick's model. A tick or a child writing the same address adds its `agent`, `parent`, `works_on` and `authority`. The key is `FLOW_API_KEY` in the environment; without it the hook writes nothing. `flow-setup` adds it to the repo's `.claude/settings.json`, with `<proj_id>` the project:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/flow/scripts/session-run.mjs\" --project <proj_id>", "timeout": 15 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/flow/scripts/session-run.mjs\" --project <proj_id>", "timeout": 15 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/flow/scripts/session-run.mjs\" --project <proj_id>", "timeout": 15 }] }]
  }
}
```

**A session its hooks never reach** writes its own: a cloud session with several repos runs from their parent directory, where no repo's `.claude/settings.json` is read, as a routine with more than one repo does. Its last act, after its run closes in § 3, is `node <flow skill>/scripts/session-run.mjs --project <proj_id> --self`, which finds its transcript by `CLAUDE_CODE_SESSION_ID` and writes `model` and `usage` as a Stop would, its in-process children's tokens included; only the final message after it goes uncounted.

A session's `usage` is its `external_metadata.usage`, with `peak_context` its `context_usage.used_tokens`, and a session reports it only after its turn ends, so a tick never knows its own.

**Each run**, last in § 2 of a tick and last before any other routine's run closes: the last run under its `agent` (§ 0) and, for a tick, that run's children (`list-agent-runs` with `parent`), each closed with no `usage` and addressed by a session URL with no query, get `usage` from `get_session` on that session, then `archive_session`. A child the tick ends is archived by End. A session without `get_session` and `archive_session`, as a routine fires with only the trigger tools, `send_later` and `add_repo`, skips this step: those runs keep no `usage` until a session that has them runs it, and a child it cannot read is left alone, as § 2 says.

**Routines** are Claude Code routines, each starting a fresh session on every firing with its row's invocation as the prompt:

| Act | How |
| --- | --- |
| Create | `create_trigger` with `create_new_session_on_fire: true`, `cron_expression` in the row's time zone (`CRON_TZ=<zone> <fields>`) on a minute other than :00 and :30, `prompt` the row's invocation, `connectors` the row's, `notifications` `{"push": true}` where the final message is what it delivers (the Chase, the Audit) and `initiation: human_request`; then `update_trigger` with the row's `model`, an exact id |
| List | `list_triggers`: each routine's schedule, model, enabled state and `last_run` |
| Validate | `fire_trigger`, then `get_session` on the `last_run` session: `<repo>` checked out, so the skills load; the row's connectors present; its run recorded in Flow |
| Event | a GitHub event or an API call fires a routine only through claude.ai's routine settings, which these tools cannot reach: the person sets it, one GitHub trigger per routine |
