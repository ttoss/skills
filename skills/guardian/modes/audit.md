# Mode: audit

Bounded health review; require a scope (ask if missing). Probe first: `git ls-files <scope> | wc -l` — more than ~30 files or more than 1 package → too large (heuristics; the human may override): propose 2–4 sub-scopes by seam (package/layer/domain) and audit one. Steps:

1. Run the Deep baseline (`reference/baseline.md`); disposition every item (`enforced`/`prose-only`/`absent`).
2. Enumerate every file in scope; apply the applicable syndrome set to each — code: the crosswalk checks (`reference/basis-form.md`); instruction surfaces incl. skill files: the instruction-artifact syndromes (`reference/methodology.md`). When the scope is itself an instruction artifact, its files are the surface set for reconciliation.
3. Score **all 8 dimensions**, one row each: examined → score + the cited performed check (command run, per-file sweep, claim diff) and its result; not examined → `UNKNOWN` + one-word reason. No cited check → `UNKNOWN`, never `GOOD`. Omitted rows are not allowed.
4. Reconcile declared-vs-enforced; check boundary enforcement.
5. List findings in the SKILL finding format (incl. `Key:`); propose a safe sequence.

Output limits — actionable, never hide blockers: surface **every P0** in full; cap P1 detail to the top 3 by impact/cost; every cut P1 appears as one line `[P1][dimension] title — Key: ...`; report cut P2/P3 as counts per dimension; name the first safe improvement as a runnable command.

```md
### Verdict AUDIT_BACKLOG

### Scope audited

### Coverage files read · checks applied · explicitly not checked

### Baseline every item dispositioned enforced / prose-only / absent, where enforcement runs

### AI Repo score | Dimension | Score (GOOD/WEAK/BAD/UNKNOWN) | Evidence (cited check + result, or UNKNOWN reason) | — all 8 rows

### Findings all P0s · top-3 P1s in full (SKILL finding format, incl. `Key:`)

### Cut findings every cut P1 as `[P1][dim] title — Key: ...` · P2/P3 as counts per dimension

### Suggested sequence

### First safe improvement (a runnable `/guardian improve <ref>` command)

### Do-not-touch without approval
```

## Example

Scope `src/payments` (a slice — a full `src/` would be narrowed first via the probe).

```md
### Verdict AUDIT_BACKLOG

### Scope audited
src/payments (probe: 14 files, 1 package)

### Coverage
Read 14/14 files; checks: per-file syndrome sweep, tsc config resolved, CI workflow read, claim diff CLAUDE.md vs scripts. Not checked: runtime behavior (no focused check exists — see G-002).

### Baseline
Enforced: strict TS (tsconfig), lint (CI). Prose-only: "always use money integers" (CLAUDE.md) — no check. Absent: pre-commit hooks, coverage gate. Instruction surfaces: root CLAUDE.md only — no others found.

### AI Repo score
| Dimension | Score | Evidence |
| compressibility | GOOD | per-file sweep: max file 210 lines, no cross-layer logic |
| executable-spec | WEAK | "money integers" rule prose-only (claim diff vs enforcement) |
| co-located-spec | GOOD | totals.spec.md present, states non-goals |
| verification-loop | BAD | focused check: none for totals path |
| boundary-integrity | GOOD | import sweep: payments never imported outside its package |
| pattern-hygiene | UNKNOWN | not-swept (time-boxed; propose follow-up) |
| debt-containment | GOOD | 1 TODO, visible and issue-linked |
| instruction-hygiene | GOOD | syndrome pass on CLAUDE.md: no hits |

### Findings
[P0][G-001][verification-loop][enforcement] Float arithmetic on money in `sumLineItems`
  Key: src/payments/totals.ts:sumLineItems:verification-loop:float-money
  Evidence: `10.10+20.20+30.30 !== 60.6`; no test. Risk: billing drift. Fix: integer cents + test; CI gate.

### Cut findings
[P1][executable-spec] "money integers" rule unenforced — Key: CLAUDE.md:money-rule:executable-spec:prose-only
P2/P3: pattern-hygiene 1, debt-containment 1.

### Suggested sequence
G-001 first (high-risk), then the cut P1.

### First safe improvement
Run `/guardian improve G-001` — smallest change with the highest risk reduction.

### Do-not-touch without approval
The Stripe webhook signature check (high-risk class).
```
