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
