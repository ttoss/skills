# Mode: plan

Turn a task into a small, verifiable, bounded plan before any code.

Steps: restate the task; classify well-/ill-structured/mixed; run the Light baseline to reconcile the task against existing repo rules/contracts (`reference/baseline.md`) so the plan can't silently contradict a `CLAUDE.md`/`.claude/rules` rule; identify relevant files, contracts, tests, boundaries; derive the axes native to this change's decision space and put scope along domain seams (parametrize over the axis, don't branch per case); define scope + non-goals; classify risk by reusing the skill's vocabulary — is it in the **high-risk class** (→ propose, no autonomy) and/or does it carry **architecture/product ambiguity** (→ needs human judgment); otherwise routine; define required tests/commands; surface blocking questions; produce plan + implementation prompt.

```md
### Verdict READY | NEEDS_CLARIFICATION | TOO_RISKY_FOR_DIRECT_IMPLEMENTATION

### Task understanding

### Risk routine | high-risk-class | architecture/product-ambiguity + reason

### Relevant files and contracts

### Scope

### Non-goals

### Required tests and verification

### Open questions

### Implementation plan

### Implementation prompt
```
