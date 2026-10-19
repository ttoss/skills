# Bootstrap (`/flow-manager setup`)

The only mode that talks to the user. It creates what the loop needs in Flow and in the repo, once per project. Creating a commitment is the person's call (Flow protocol GTF-A1), so list every write and wait for their yes before sending it.

1. **Project.** `list-projects`; ask which one, or offer `create-project`.
2. **Parameters.** Ask for each row of [parameters.md](parameters.md) the repo does not already state. Read the repo's `CLAUDE.md`/`AGENTS.md` first and propose values found there.
3. **Standing decision.** Search for an existing one (`list-tasks` `kind: decision`, `query: "standing"`). If none, propose one `decision` task, closed `completed` with the user's verbatim answer as `basis: { said }`, titled `Standing: the delivery loop runs autonomously`, whose body states what the loop may do without asking (take, move, close, merge, release, bump, test in production, start and archive sessions, write follow-ups) and what stays with the user (product intent, the human-reserved decisions, security/auth/billing/data-loss/migration/public-contract choices).
4. **Release batch.** With an upstream: one open `Release <upstream> (next)` task (`active`), basis the standing decision.
5. **Write the parameters** to `.claude/flow-manager.md` and tell the user to commit it.
6. **Check the prerequisites** listed in [SKILL.md](../SKILL.md#prerequisites-outside-the-repo) and report each one.
7. **Start it:** suggest `/loop 10m /flow-manager`, or a recurring routine running `/flow-manager <project id>` in a fresh session for a loop that outlives this session.
