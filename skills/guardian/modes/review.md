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
