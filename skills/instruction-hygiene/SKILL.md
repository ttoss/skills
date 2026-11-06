---
name: instruction-hygiene
description: Make a repository's agent instructions (CLAUDE.md files, rules, their reference halves) short and direct — strip decision history, provenance and measurements, then condense what is left into imperative instructions — without losing a rule, a path, a threshold or a heading another file points at. Use when the user says /instruction-hygiene, "clean up the rules", "the CLAUDE.md is bloated", "remove the decision history", "condense the rules", or when token-audit names the instruction corpus as a top sink.
argument-hint: "[repo path] [--pass history|condense|both] [--scope loaded|all]"
---

# Instruction hygiene

Instruction files grow the way code does not: every decision leaves a "decided on", every incident a paragraph, every rule a justification. Each session re-reads all of it. In a Flow project the record of a decision lives in the graph (GTF), so the file needs only the result: what to do, what not to do. This skill applies that in two passes and opens one PR per pass per repo. It changes nothing without the user's word; `token-audit` measures and proposes, this skill applies.

Report in one line per file; the PR body in full sentences.

## What loads, and what does not

Scope `loaded` (the default) is what sessions pay for: the root `CLAUDE.md`, every rule under `.claude/rules` (scoped or not), nested `CLAUDE.md` files, and the project's entry files for Flow. Scope `all` adds the reference halves (the files a rule points at for its full text). Do the reference halves in their own PR: they load on demand, so their cost is lower and their diff larger. Installed third-party skills, changelogs, eval sets and routines are never in scope.

## Steps

1. **Measure.** `python3 <token-audit skill>/scripts/measure_instructions.py <repo>` for the inventory, then `wc -w` per file in scope, saved to a scratch file: the PR cites before and after.
2. **Map the referenced headings.** `python3 scripts/heading_refs.py <repo>` lists every `` `file.md` → "Heading" `` pointer in Markdown and in code comments, and which target heading each resolves to. A heading on that list keeps its exact text through both passes. Code comments count: a guard or a resolver citing a rule's section is a reader too.
3. **Pass one, remove history** ([briefs.md](references/briefs.md) § History). Fan out by file group to subagents with the brief; one commit after all finish. A pass that skips the "keep" list deletes operational ids with the provenance.
4. **Pass two, condense** ([briefs.md](references/briefs.md) § Condense). Same fan-out, a fresh brief. Bullets, one instruction each, imperative mood. The limit is "no name lost", never a percentage: a file that is a registry of contracts shrinks by a fifth, a narrative one by two thirds.
5. **Verify** before each commit: the repo's own check of rule pairs and globs when it has one; `python3 scripts/heading_refs.py <repo> --base <default branch>` reports every heading that resolved on the base and no longer does, and each is restored, not re-pointed; the repo's formatter; the word count again.
6. **Codify the policy** in the pass-one PR, in the file that owns how rules are written: an instruction carries no provenance, decision ids, task links, PR numbers, history, measurements or narrative; the graph holds the record; a rule is written as a direct instruction. Without it the corpus grows back.
7. **Open the PR** with the task's URL, the before and after counts, what was kept on purpose, and the headings restored in step 5. Instruction files are a person's merge in most projects: say so and leave the task `waiting` on them.

## Keep, in both passes

| Keep | Because |
| --- | --- |
| Ids the agents write back: the Flow project id, the standing-decision id, the ids rules cite as `basis` | Operational, not provenance |
| Format examples that contain an id or a number (`Guard: deferred to <task>`) | A format, not a record |
| Cutover dates and thresholds code or a query depends on | A reader acts on them |
| Pointers between a rule and its reference half, and `paths` frontmatter | A CI check or the loader reads them |
| Every heading in the step-2 map | Something points at it |
| A why that stops a reader applying the rule wrongly, as one clause | The rule is not clear without it |

## Do not

- Do not delete or rename a file: a demoted half unreachable from its rule is lost, and the pair check fails.
- Do not condense the reference halves in the same PR as the loaded files.
- Do not commit while subagents are still writing into the tree.
- Do not set a percentage as the target of pass two.
- Do not run this over a repo that is not a Flow project without asking where its decisions are recorded: with no record elsewhere, the history in the files is the record.
