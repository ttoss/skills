# Mode: plan

Turn a task into a small, verifiable, bounded plan before any code.

Steps: restate the task; classify well-/ill-structured/mixed; identify relevant files, contracts, tests, boundaries; derive the axes native to this change's decision space and put scope along domain seams (parametrize over the axis, don't branch per case); define scope + non-goals; assign risk class (A local/low, B medium/focused, C high-risk/human, D architecture/product ambiguity); define required tests/commands; surface blocking questions; produce plan + implementation prompt.

```md
### Verdict READY | NEEDS_CLARIFICATION | TOO_RISKY_FOR_DIRECT_IMPLEMENTATION

### Task understanding

### Risk class A|B|C|D + reason

### Relevant files and contracts

### Scope

### Non-goals

### Required tests and verification

### Open questions

### Implementation plan

### Implementation prompt
```
