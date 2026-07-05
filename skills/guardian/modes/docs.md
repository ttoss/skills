# Mode: docs

Review/improve the repo's context/instruction surfaces. A **surface = one file** (for a JSDoc/TSDoc target, one file's doc blocks). Submodes: `review` (diagnose one surface), `instructions` (diagnose all surfaces — the instruction-surface projection of `audit`; Deep baseline), `improve` (edit one approved surface; `jsdoc` is an alias for `improve` targeting a JSDoc/TSDoc surface; Core rule 7 applies). The Action axis (`SKILL.md`) governs which submodes write.

Steps: inspect the surfaces in scope; run the instruction-artifact syndromes on each (`reference/methodology.md`); identify the ambiguity/failure mode the doc should reduce; choose the smallest correct surface (stewardship table in `reference/methodology.md`); ensure surfaces are themselves written in basis-form and, where a basis-form rule belongs in a durable surface and is missing, write it there (propagate — `reference/basis-form.md`); prefer enforceable structure over prose; remove/propose removal of stale/duplicated text (stale criteria in methodology); verify any asserted behavior or recommend a test.

Required/Optional changes entries use the SKILL finding format — instruction findings anchor as `path:heading:dimension:rule`.

For `instructions`, prepend `### Surfaces found / reviewed`: one line per surface from the Deep baseline list — disposition `reviewed | absent`, and for reviewed surfaces the enforced/prose-only status. A discovered surface missing from this section means unchecked — a defect in the run, not an allowed omission.

```md
### Documentation verdict PASS | PASS_WITH_FIXES | PASS_WITH_ACCEPTED_RISK | BLOCK | DOCS_BACKLOG

### Surfaces found / reviewed (`instructions` submode only)

### Context cost LOW | MEDIUM | HIGH

### Ambiguity reduced

### Recommended surface enforcement | nested CLAUDE.md | .claude/rules | root CLAUDE.md | skill | \*.spec.md | JSDoc/TSDoc | AGENTS.md

### Required changes [P0/P1][G-###][dimension][rung] title + `Key:` line ...

### Optional changes [P2/P3][G-###][dimension][rung] title + `Key:` line ...

### Patch or proposal

### Verification needed
```

## Example

`docs review` of a bloated root `CLAUDE.md`.

```md
### Documentation verdict PASS_WITH_FIXES

### Context cost HIGH

### Ambiguity reduced
CLAUDE.md is 420 lines; most is a per-directory list — a case-enumeration where a path-scoped rule belongs.

### Recommended surface .claude/rules
Move the `src/api/**` conventions to `.claude/rules/api.md` with a `paths:` glob (loads on demand).

### Required changes
[P1][G-001][instruction-hygiene][path-scoped-context] Per-directory case-list bloats the always-loaded surface
  Key: CLAUDE.md:api-conventions:instruction-hygiene:global-case-list
  Evidence: lines list conventions per directory; 3 named commands don't exist in package.json (stale).
  Risk: context cost on every session; stale commands mislead agents.
  Fix: extract the API section to `.claude/rules/api.md` (`paths:` glob); delete the 3 stale commands; leave a one-line pointer.

### Optional changes
[P2][G-002][instruction-hygiene][path-scoped-context] Test conventions could move to a nested CLAUDE.md under `src/`
  Key: CLAUDE.md:test-conventions:instruction-hygiene:global-case-list

### Patch or proposal
(proposal — `docs review` is read-only; run `/guardian docs improve CLAUDE.md` to apply)

### Verification needed
Confirm the moved rules still load when editing an `src/api` file.
```
