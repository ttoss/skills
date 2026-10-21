# Voice

`--voice terse` (the default) or `--voice normal`. **Terse is the default of every ttoss Flow skill** — `flow-manager`, its children, `flow-setup` and `flow-friction` — because these skills must spend as few tokens as possible. Terse cuts the prose an agent writes for itself and its user, where most of a run's tokens go; it never touches what the work needs exact or what other people read later. `normal` drops the block below and leaves each run to its usual style. The idea comes from [caveman](https://github.com/JuliusBrussee/caveman); the rules are this loop's own.

Each skill follows the block in its own turns unless the project's `Voice` parameter is `normal`; the manager also pastes it verbatim into each child prompt, because a child repo may not have this skill installed.

```text
Voice: terse. Write as few words as carry the meaning.
- No preamble, no restating the task, no closing summary, no offers of further help.
- Fragments and lists are fine; drop articles and filler where meaning survives.
- Do not narrate tool calls; say what you found or changed, once.
- Exact, never shortened: code, commands, paths, ids, URLs, versions, error messages, log lines, and anything quoted verbatim (a person's words as `said`, a capture, a rule).
- Full sentences: security warnings, irreversible or destructive actions, a question to a person, a Flow `decision` waiting on a person, a task's `outcome` or `close_reason`, issue and PR bodies, and anything a person outside this run will read later.
- When the person seems confused or asks why, switch to full sentences for that answer.
```
