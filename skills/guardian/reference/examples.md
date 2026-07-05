# Guardian — Worked examples (one per mode)

Compact anchors, not templates to copy verbatim. Each shows the shape and the depth expected. Read only the block for the mode you're running.

## plan

Task: "add CSV export to the invoices table."

```md
### Verdict READY

### Task understanding
Add a "Download CSV" action that exports the currently-filtered invoice rows.

### Risk routine + reason
No high-risk-class surface (no billing mutation, no auth change); read-only export of already-visible data.

### Relevant files and contracts
`src/invoices/InvoiceTable.tsx` (renders rows), `src/invoices/useInvoices.ts` (filter state),
existing `src/lib/csv.ts` (reuse — do not write a new serializer).

### Scope
Serialize the in-memory filtered rows via `csv.ts`; wire one button.

### Non-goals
Server-side export; new columns; changing the filter model.

### Required tests and verification
Unit test: filtered rows → expected CSV string (incl. comma/quote escaping). `pnpm test --filter invoices`.

### Open questions
None blocking.

### Implementation plan
1. `toCsv(rows)` in `csv.ts` if missing. 2. Button calls it on current rows. 3. Test escaping.

### Implementation prompt
"Reuse src/lib/csv.ts; export the filtered rows from useInvoices; add an escaping unit test."
```

## review

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

## pr

```md
### PR title
Add CSV export to invoices table

### PR description
Exports the currently-filtered invoice rows client-side, reusing `src/lib/csv.ts`.

### Verification evidence
- [x] `pnpm test --filter invoices` — 4 passed (incl. comma/quote escaping)

### Reviewer focus
Escaping correctness in `toCsv`; that export respects the active filter.

### Risk notes
Client-side only; no billing/auth surface touched.

### Non-goals
Server-side export; new columns.

### Follow-ups
Server-side export if row counts grow past client memory.
```

## audit

Scope `src/payments` (a slice — full `src/` would be narrowed first).

```md
### Verdict AUDIT_BACKLOG

### Scope audited
src/payments

### Baseline enforced vs prose-only, where enforcement runs
Enforced: strict TS, lint (CI). Prose-only: "always use money integers" (CLAUDE.md) — no check.

### AI Repo score
| Dimension | Score | Evidence |
| verification-loop | BAD | totals path has no test |
| executable-spec | WEAK | "money integers" rule unenforced |
| boundary-integrity | GOOD | payments never imported outside its package |

### Findings
[P0][G-001][verification-loop][enforcement] Float arithmetic on money in `sumLineItems`
  Key: src/payments/totals.ts:sumLineItems:verification-loop:float-money
  Evidence: `10.10+20.20+30.30 !== 60.6`; no test. Risk: billing drift. Fix: integer cents + test; CI gate.

### Remaining categories summary + follow-up scope
2 P2 (naming, a dead branch) — run `audit src/payments/refunds` next.

### Suggested sequence
G-001 first (high-risk), then the P2s.

### First safe improvement
G-001 — smallest change with the highest risk reduction.

### Do-not-touch without approval
The Stripe webhook signature check (high-risk class).
```

## improve

Fixing `G-001` from the audit above.

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

## docs

`docs review` of a bloated root `CLAUDE.md`.

```md
### Documentation verdict PASS_WITH_FIXES

### Context cost HIGH

### Ambiguity reduced
CLAUDE.md is 420 lines; most is a per-directory list — a case-enumeration where a path-scoped rule belongs.

### Recommended surface .claude/rules
Move the `src/api/**` conventions to `.claude/rules/api.md` with a `paths:` glob (loads on demand).

### Required changes
Extract the API section; leave a one-line pointer. Delete 3 commands that don't exist in package.json (stale).

### Optional changes
Split test conventions into a nested `CLAUDE.md` under `src/`.

### Patch or proposal
(proposal — `docs review` is read-only; run `docs improve` to apply one surface)

### Verification needed
Confirm the moved rules still load when editing an `src/api` file.
```
