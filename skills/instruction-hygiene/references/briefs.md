# Subagent briefs

Two briefs, one per pass. Give each subagent the brief, the repo path and its file list; nothing else. Back to [the skill](../SKILL.md).

## History

> Strip decision history from instruction files. Edit only the files assigned to you, in place. Do not commit, do not run the formatter.
>
> **Remove**
>
> - Provenance: "Decided on #N by @x", "decided on task_…", "by <person> on <date>" trailers, decision labels (D9, E1, PRD 3), "superseded by", "narrowed on", inline PR citations, task links cited as a rule's origin.
> - Sections that are only history or justification: "Decided on", "Decision record", "History", "Incident", "Why …", "What happened", "Measured on", "Background".
> - Incident narrative, measurements, "used to be", "previously", "before #N", "(formerly X)".
> - Justification clauses attached to an instruction that is clear without them. Keep a why only when a reader would otherwise apply the rule wrongly, as one clause.
> - Dangling pointers after a cut ("Details and the decision record (E1, by @x): `file.md`" becomes "Details: `file.md`").
>
> **Keep**
>
> - Every instruction, procedure, table, command, path, name, registry, threshold, format and contract. Do not weaken a rule. Do not add text beyond what a cut needs for grammar.
> - `paths:` frontmatter, exactly.
> - The pointer from a rule to its reference half and back. Never delete or rename a file; if a file nearly empties, leave its title and what remains.
> - References that are data or a format, not provenance: a format example with an id in it, an eval set, a project id, a standing-decision id, a changelog, an open issue the reader must act on.
> - Operational numbers (a coverage floor, a queue size, a drain time, a cutover date).
>
> **Style**: imperative, direct. Rewrite a sentence only when the cut breaks it or when it narrates instead of instructing. Do not restructure sections you did not change. Valid Markdown.
>
> **When done**: one line per file (what kind of content was removed) and any passage you were unsure about (kept it, say why).

## Condense

> Condense instruction files into direct instructions. Edit only the files assigned to you, in place. Do not commit, do not run the formatter.
>
> **Target**: the same instructions in far fewer words. The limit is "no name lost", not a percentage. A file that is already a tight list is left alone or trimmed lightly.
>
> **How**
>
> - Paragraphs become bullets. One instruction per bullet, imperative mood. Drop "note that", "in other words", "so that", rhetorical set-ups, repeated statements of a rule, worked examples longer than one line, and the second half of any "X, because Y" where Y is obvious from X.
> - Keep every rule, every "Do not", every path, command, name, registry, threshold, table and contract; a why only when the rule is not clear without it, as one clause.
> - Keep `paths:` frontmatter exactly, and every pointer to another file.
> - **Headings**: the list at `<path to heading map>` names the headings other files or code comments point at. Before renaming or merging a heading, check the list and grep the repo for its text in quotes. A listed heading keeps its exact text; an unlisted one may be merged or dropped.
> - Tables stay; shorten prose in cells.
> - Valid Markdown. Do not pad or add text.
>
> **When done**: one line per file, before → after word count, and any heading you changed (none, ideally). Name any instruction you were unsure you preserved.
