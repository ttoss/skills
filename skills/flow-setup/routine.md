# Routine file

The file a [project routine](https://raw.githubusercontent.com/ttoss/ttoss/main/docs/website/docs/engineering/workflow/routines.md#project-routines) runs, on the default branch, beside the parameters file (`.agents/routines/<name>.md` or `.claude/routines/<name>.md`). Its row in `Routines` names it, and the runtime stores one line: `Read <path> from <repo>'s default branch and follow it.` Fill the `<…>` slots and keep it short: the run reads it on every turn.

```markdown
# <Name>

- **Fired by**: <a schedule, with its time zone | an event, and where it comes from>.
- **Model and connectors**: <model>, since it <writes no code | …>; <Flow, …>.
- **Rules**: <the project's instructions that own its signal>, GTF-<ids>. Its run is recorded with `agent: <name>` and the standing decision as `authority`.
- **Scope**: it reads <…>; it may change <…>.

## Procedure

1. <What fired it: from an event, take only the id it points at and read the rest from the source.>
2. <For an intake: find the task that covers the signal by its URL (`list-tasks` with `ref_url`); a new one carries that URL as its `source` and its `dedupe_on`.>
3. <The work, by the instruction that owns the signal's kind. An intake writes the investigation and the check its fix will leave, never a fix.>
4. Write-back: one line per item handled, by `url`.

## Never

- <What it must not do: the stages it does not own, writes outside its scope.>
```
