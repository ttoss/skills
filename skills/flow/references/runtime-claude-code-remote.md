# Runtime preset: Claude Code sessions

The tick and each child run in a cloud session of their own, through the `claude-code-remote` tools. A project names this preset as its `Runtime` and adds what differs: `<repo>` below (the repo its sessions start from), the other repos a child adds, its models, its max runs.

**The tick** runs in a session of its own with the prompt `/flow <project id>`: the one a routine starts on each firing, or `create_session` with `source_url` `<repo>` and tag `flow-manager`. Its run address is that session's URL.

| Act | How |
| --- | --- |
| Start | `create_session` with `source_url` `<repo>`, tags `flow-manager-child` and the task id. The child runs `add_repo` for each other repo its task touches, and `add_repo ttoss/skills` to file its own friction. The run address is `https://claude.ai/code/<session id>` |
| Read | `get_session`: `status_bucket` (`working`, `review_ready`, `blocked`, `completed`, `failed`); `SESSION_STATUS_ARCHIVED` is gone |
| End | Close the Flow run (`upsert-agent-run` `status`, `usage` from the session), then `archive_session`. A closed run with a live session is not ended |
| Message | `send_message` |

A session's `usage` is its `external_metadata.usage`, with `peak_context` its `context_usage.used_tokens`, and a session reports it only after its turn ends, so a tick never knows its own.

**Each tick**, last in § 2: the last run (§ 0) and its children (`list-agent-runs` with `parent`), each closed with no `usage` and addressed by a session URL with no query, get `usage` from `get_session` on that session, then `archive_session`. A child the tick ends is archived by End.
