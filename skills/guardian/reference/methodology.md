# Guardian — Methodology reference

## AI Repo dimensions

Review only relevant dimensions; never flag what the baseline shows already enforced. These 8 dimensions are the single operational lens: every finding carries exactly one of these slugs (the 4 basis-form tests are never a finding tag). Each dimension's parent test and promotion check live in the canonical crosswalk in `basis-form.md`; the bad-lists below are the operational detail, not a restatement of that table.

1. **Context compressibility** (`compressibility`) — can the change be explained through a small, bounded context packet? Bad: small behavior needs whole-system understanding; logic spread across layers; new cross-cutting knowledge with no contract; a large file becoming a gravity well.
2. **Executable specification** (`executable-spec`) — is important intent in tests, types, schemas, validators, or specs (not just conversation)? Bad: new behavior without acceptance tests; business rule hidden in a conditional; requirement only in an issue comment; spec duplicating code-readable facts instead of intent/boundaries/non-goals.
3. **Co-located specs** (`co-located-spec`) — when code can't express intent, use `*.spec.md` beside the artifact. Good: intent, constraints, acceptance criteria, boundaries, non-goals, risk class, verification commands. Bad: rewritten source, duplicated type shapes, generic prose, untested assertions.
4. **Verification loop** (`verification-loop`) — can a future agent run a focused check quickly? Bad: only manual testing proves it; only slow e2e covers local behavior; command not discoverable; PR claims success without evidence.
5. **Boundary integrity** (`boundary-integrity`) — are package/layer/domain/ownership/public-API boundaries preserved **and enforced**? Check both: does the change violate a boundary, and does the boundary exist only in prose (candidate for import-restriction lint / dependency-graph check)?
6. **Pattern hygiene** (`pattern-hygiene`) — did the change copy or strengthen a bad local pattern (more nesting in a complex fn, more special cases in a god file, a workaround becoming the norm, "file style" that is actually debt)? Agents replicate whatever they see.
7. **Debt containment** (`debt-containment`) — accept debt only if modular, visible, observable, cheap to repay. Unacceptable: invisible, systemic, untested, in core logic, or likely to be copied.
8. **Instruction & context hygiene** (`instruction-hygiene`) — review all instruction surfaces across tools (from the deep baseline). Bad: CLAUDE.md grown into a manual (target <200 lines); generic advice; commands that don't exist; contradictions within/across surfaces; local rule placed globally; procedure that belongs in a skill; the same rule hand-duplicated across tools (drift). Platform loading and precedence mechanics live in `bindings.md` — the primary agent-specific file (the durability ladder also names Claude surfaces as examples); the hygiene principles above are universal.

## Documentation stewardship

Choose the smallest correct surface, preferring higher ladder rungs:

```txt
machine-enforceable rule        -> test, type, schema, lint/check, CI, hook   (prefer)
directory/layer-scoped guidance -> nested CLAUDE.md (co-located, on demand)
file-type/cross-cutting rule    -> .claude/rules/*.md with `paths:` glob
always-relevant global rule     -> root CLAUDE.md (<200 lines)
repeatable procedure            -> a skill
domain/product intent           -> co-located *.spec.md
public API contract             -> JSDoc/TSDoc
cross-tool portability          -> AGENTS.md as source, imported/symlinked by CLAUDE.md
```

Add docs only when they cut future ambiguity more than they add context cost. A doc is **stale** when it: names commands that don't exist; contradicts package scripts or CI; describes removed APIs; repeats type shapes that changed; conflicts with a closer-scoped instruction; or asserts behavior not covered by tests or current code.

## JSDoc/TSDoc policy

Document invariants, side effects, fail-open/closed behavior, security/permission/billing/data semantics, deprecations, misuse-preventing examples, and behavior types can't express. Don't mandate exhaustive JSDoc on trivial exports (context cost + duplicates the signature); a repo rule that does is a flaggable quality claim. Don't assert guarantees stronger than the code enforces: if a comment says "never/always/must/throws/pure/idempotent/fail-closed/safe", verify code/tests enforce it — else soften the wording or raise a finding.
