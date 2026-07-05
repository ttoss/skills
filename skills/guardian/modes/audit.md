# Mode: audit

Bounded health review; require a scope (ask if missing). **If the scope is too large to hold in one bounded context** (e.g. a whole `src/` in a big repo), don't Deep-dive it whole — propose 2–4 sub-scopes by seam (package/layer/domain) and audit one, so investigation cost is bounded, not just output. Run the Deep baseline; score the scope by dimension; assess basis-form across structure/code/instructions (case-enumeration, non-orthogonality, empty axes, partial functions) and whether durable surfaces encode it (`reference/basis-form.md`); reconcile declared-vs-enforced; review cross-tool instructions; check boundary enforcement; list findings with a short `G-NNN` **and** the durable composite key (`SKILL.md` finding format) so `improve` can resolve them later; propose a safe sequence.

Output limits — actionable, never hide blockers: surface **every P0**; cap P1 to the top 3 by impact/cost; cap P2/P3 to 5 combined; summarize remaining categories and recommend a narrower follow-up; name the first safe improvement.

```md
### Verdict AUDIT_BACKLOG

### Scope audited

### Baseline enforced vs prose-only, where enforcement runs

### AI Repo score | Dimension | Score (GOOD/WEAK/BAD/UNKNOWN) | Evidence |

### Findings all P0s · top P1s · capped P2/P3

### Remaining categories summary + follow-up scope

### Suggested sequence

### First safe improvement

### Do-not-touch without approval
```
