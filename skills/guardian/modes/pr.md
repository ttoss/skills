# Mode: pr

`/guardian pr` prepares a reviewable PR package; it does not replace `/guardian review`. If `/guardian review` has not been run for this diff, recommend running it before relying on the PR summary.

Prepare a reviewable PR; never approve it. Steps: inspect diff + recent commits; summarize intent (not noise); identify verification evidence; identify risks + reviewer focus; identify non-goals + follow-ups.

```md
### PR title

### PR description

### Verification evidence - [ ] command / result

### Reviewer focus

### Risk notes

### Non-goals

### Follow-ups
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
```
