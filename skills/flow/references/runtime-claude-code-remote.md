# Runtime preset: Claude Code sessions

The tick and each child run in a cloud session of their own, through the `claude-code-remote` tools. A project names this preset as its `Runtime` and adds what differs: `<repo>` below (the repo its sessions start from), the other repos a child adds, its models, its max runs.

**The tick** runs in a session of its own with the prompt `/flow <project id>`: the one a routine starts on each firing, or `create_session` with `source_url` `<repo>` and tag `flow-tick`. Its run address is that session's URL.

| Act | How |
| --- | --- |
| Start | `create_session` with `source_url` `<repo>`, tags `flow-child` and the task id. The child runs `add_repo` for each other repo its task touches, and `add_repo ttoss/skills` to file its own friction. The run address is `https://claude.ai/code/<session id>` |
| Read | `get_session`: `status_bucket` (`working`, `review_ready`, `blocked`, `completed`, `failed`); `SESSION_STATUS_ARCHIVED` is gone |
| End | Close the Flow run (`upsert-agent-run` `status`, `usage` from the session), then `archive_session`. A closed run with a live session is not ended |
| Message | `send_message` |

A session's `usage` is its `external_metadata.usage`, with `peak_context` its `context_usage.used_tokens`, and a session reports it only after its turn ends, so a tick never knows its own.

**Each run**, last in § 2 of a tick and last before any other routine's run closes: the last run under its `agent` (§ 0) and, for a tick, that run's children (`list-agent-runs` with `parent`), each closed with no `usage` and addressed by a session URL with no query, get `usage` from `get_session` on that session, then `archive_session`. A child the tick ends is archived by End. A session without `get_session` and `archive_session`, as a routine fires with only the trigger tools, `send_later` and `add_repo`, skips this step: those runs keep no `usage` until a session that has them runs it, and a child it cannot read is left alone, as § 2 says.

**Routines** are Claude Code routines, each starting a fresh session on every firing with its row's invocation as the prompt:

| Act | How |
| --- | --- |
| Create | `create_trigger` with `create_new_session_on_fire: true`, `cron_expression` in the row's time zone (`CRON_TZ=<zone> <fields>`) on a minute other than :00 and :30, `prompt` the row's invocation, `connectors` the row's, `notifications` `{"push": true}` where the final message is what it delivers (the Chase, the Audit, the Calibration) and `initiation: human_request`; then `update_trigger` with the row's `model`, an exact id |
| List | `list_triggers`: each routine's schedule, model, enabled state and `last_run` |
| Validate | `fire_trigger`, then `get_session` on the `last_run` session: `<repo>` checked out, so the skills load; the row's connectors present; its run recorded in Flow |
| Event | a GitHub event or an API call fires a routine only through claude.ai's routine settings, which these tools cannot reach: the person sets it, one GitHub trigger per routine |
