# Project parameters

The manager reads these from the consuming repo, first match wins: the `/flow-manager <project id>` argument (project id only), `.claude/flow-manager.md`, or a `## Flow manager` section of `CLAUDE.md` / `AGENTS.md`. `/flow-manager setup` writes the file for you.

```markdown
# Flow manager

| Parameter | Value |
| --- | --- |
| Flow project id | `proj_vx1h3xshaq` |
| Standing-decision task id | `task_v61r7cn20q` |
| Repos | `naturali-ai/naturali.ai` (downstream), `ttoss/soat` (upstream) |
| Release procedure | `ttoss/soat` `.claude/rules/release.md` |
| Production target | `https://api.naturali.ai`, Sandbox project, token in `NATURALI_TOKEN` |
| Human-reserved decisions | `CLAUDE.md` § Standing decisions |
| Max sessions | 2 |
```

Only the first two rows are required. `Max sessions` is the default cap on live child sessions; `--max-sessions N` on the command overrides it. A single-repo project lists one repo and no release procedure, and skips loop steps 2–3. Without a production target, "done" falls back to merged plus the repo's own verification, and the manager says so in its first report.
