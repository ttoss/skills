# Mode: improve

Fix exactly one approved finding, by ladder position (`reference/enforcement.md`). Resolve the reference first:

1. In-session `G-NNN` → use the finding as reported. Durable key → read it right-to-left: last segment is the rule, second-last must be one of the 8 dimension slugs (if not, the key is malformed — stop and ask); the remainder is the path, then the symbol/heading.
2. Read the path; locate the symbol/heading.
3. Re-verify the violation still exists; if absent, report `ALREADY_RESOLVED` with the evidence and stop (no write).
4. If the path or symbol no longer exists, stop and ask (or propose a narrow re-audit).

Then fix:

- **Mechanizable** → codify the enforcement (lint/type/schema/test/coverage gate), not just patch the instance; first check the rule/plugin is already available; if a new dep or hook/CI change is needed, stop and propose.
- **Not mechanizable** → smallest correct prose/spec change, or produce a `plan` if it needs architectural/product judgment.
- **basis-form migration** → migrate case→basis or collapse an empty axis under the visible-axis guardrail (`reference/basis-form.md`); then promote the syndrome to a check (`reference/enforcement.md`).

Rules: one finding only; small patch; add/update verification if behavior changes; never mix feature work with repo-health cleanup; high-risk guard: Core rule 7. A structural change (many files or redrawn boundaries) is not one `improve`: run `plan`, then execute it as an ordered sequence of contained, verified `improve` steps.

```md
### Finding fixed [G-### or key]

### Ladder rung targeted enforcement | path-scoped context | procedure | prose

### Files changed

### Why this improves the AI Repo

### Verification command / result (run this session — else `NOT RUN` + reason)

### Residual risk

### Suggested PR description
```

## Example

Fixing `G-001` from the audit example.

```md
### Finding fixed [G-001] (key: src/payments/totals.ts:sumLineItems:verification-loop:float-money)

### Ladder rung targeted enforcement

### Files changed
`src/payments/totals.ts` (sum in integer cents), `src/payments/totals.test.ts` (new).

### Why this improves the AI Repo
Turns a prose rule ("money integers") into a test + type; the syndrome (non-spanning money math) now fails a check, not a human.

### Verification command / result
`pnpm test --filter payments` — run: 6 passed, incl. the former failing case.

### Residual risk
Other modules may still do float money math — proposed a repo-wide follow-up finding, not fixed here (one finding per improve).

### Suggested PR description
"Fix float money arithmetic in sumLineItems; add cents-based tests."
```
