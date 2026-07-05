# Mode: improve

Fix exactly one approved finding — referenced by its in-session `G-NNN` or its durable composite key (`SKILL.md` finding format; the key resolves across sessions without re-running audit) — by ladder position (`reference/enforcement.md`).

- **Mechanizable** → codify the enforcement (lint/type/schema/test/coverage gate), not just patch the instance; first check the rule/plugin is already available; if a new dep or hook/CI change is needed, stop and propose.
- **Not mechanizable** → smallest correct prose/spec change, or produce a `plan` if it needs architectural/product judgment.
- **basis-form migration** → migrate case→basis or collapse an empty axis under the visible-axis guardrail (`reference/basis-form.md`); then promote the syndrome to a check (`reference/enforcement.md`).

Rules: one finding only; small patch; add/update verification if behavior changes; never mix feature work with repo-health cleanup; never touch the high-risk class without explicit instruction. A structural change (many files or redrawn boundaries) is not one `improve`: run `plan`, then execute it as an ordered sequence of contained, verified `improve` steps.

```md
### Finding fixed [G-###]

### Ladder rung targeted enforcement | path-scoped context | procedure | prose

### Files changed

### Why this improves the AI Repo

### Verification command / result

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
`pnpm test --filter payments` — 6 passed, incl. the former failing case.

### Residual risk
Other modules may still do float money math — proposed a repo-wide follow-up finding, not fixed here (one finding per improve).

### Suggested PR description
"Fix float money arithmetic in sumLineItems; add cents-based tests."
```
