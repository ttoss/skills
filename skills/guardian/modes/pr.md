# Mode: pr

`/guardian pr` prepares a reviewable PR package; it does not replace `/guardian review`.

Prepare a reviewable PR; never approve it. Steps: inspect diff + recent commits; summarize intent (not noise); identify verification evidence; identify risks + reviewer focus; identify non-goals + follow-ups. Next-step rule: if a `/guardian review` verdict for this diff is not in the current session context → Next step = run `/guardian review`; else → Next step = ready to open the PR (cite the verdict).

```md
### PR title

### PR description

### Verification evidence - [ ] command / result

### Reviewer focus

### Risk notes

### Non-goals

### Follow-ups

### Next step
```

## Example

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

### Next step
No `/guardian review` verdict for this diff in this session — run `/guardian review` before opening the PR.
```
