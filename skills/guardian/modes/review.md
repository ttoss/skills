# Mode: review

Use after implementation, before commit. Apply the trivial fast path first. Otherwise run the Light baseline (escalate to Deep per triggers), review relevant dimensions (`reference/methodology.md`), flag basis-form drift in both directions (case-enumeration where an axis is visible; empty/speculative axis — `reference/basis-form.md`), reconcile touched rules (`reference/baseline.md`), classify with the finding format, note missing verification, write a correction prompt.

```md
### Verdict PASS | PASS_WITH_FIXES | PASS_WITH_ACCEPTED_RISK | BLOCK

### Summary

### Required fixes [P0/P1][G-###][dimension][rung] ...

### Suggested improvements [P2/P3][G-###][dimension][rung] ...

### Missing verification

### Docs/instructions impact

### Correction prompt
```

## Example

Diff adds a permission check but no test.

```md
### Verdict PASS_WITH_FIXES

### Summary
New `canDelete()` gate on the delete route; behavior is correct but unverified and the rule is prose-only.

### Required fixes
[P1][G-001][verification-loop][enforcement] No focused test for the new permission gate
  Key: src/auth/canDelete.ts:canDelete:verification-loop:missing-test
  Evidence: `canDelete` added; `git diff` shows no test touched; `pnpm test --filter auth` covers no case.
  Risk: a future refactor silently opens the delete route; human review is the only sensor.
  Fix: add allow/deny unit tests; this is the high-risk class (permissions) → gate in CI.

### Suggested improvements
[P2][G-002][boundary-integrity][enforcement] Delete route imports the DB client directly
  Key: src/routes/delete.ts:handler:boundary-integrity:layer-bypass — consider an import-restriction rule.

### Missing verification
`pnpm test --filter auth` (add the cases above).

### Docs/instructions impact
None.

### Correction prompt
"Add allow/deny tests for canDelete and wire the auth suite into CI before merge."
```
