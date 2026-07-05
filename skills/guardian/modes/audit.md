# Mode: audit

Bounded health review; require a scope (ask if missing). **If the scope is too large to hold in one bounded context** (e.g. a whole `src/` in a big repo), don't Deep-dive it whole — propose 2–4 sub-scopes by seam (package/layer/domain) and audit one, so investigation cost is bounded, not just output. Run the Deep baseline; score the scope by dimension; assess basis-form across structure/code/instructions (case-enumeration, non-orthogonality, empty axes, partial functions) and whether durable surfaces encode it (`reference/basis-form.md`); reconcile declared-vs-enforced; review cross-tool instructions; check boundary enforcement; list findings with a short `G-NNN` **and** the durable composite key (`SKILL.md` finding format) so `improve` can resolve them later; propose a safe sequence.

Output limits — actionable, never hide blockers: surface **every P0**; cap P1 to the top 3 by impact/cost; cap P2/P3 to 5 combined; summarize remaining categories and recommend a narrower follow-up; name the first safe improvement.

```md
### Verdict AUDIT_BACKLOG

### Scope audited

### Baseline enforced vs prose-only, where enforcement runs

### AI Repo score | Dimension | Score (GOOD/WEAK/BAD/UNKNOWN) | Evidence |

### Findings all P0s · top P1s · capped P2/P3 (each in SKILL finding format, incl. `Key:` line)

### Remaining categories summary + follow-up scope

### Suggested sequence

### First safe improvement

### Do-not-touch without approval
```

## Example

Scope `src/payments` (a slice — a full `src/` would be narrowed first).

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
