# ttoss skills

Agent skills shared across ttoss projects. The Flow skills are built on [Get Things Flowing](https://flow.ttoss.dev/docs/agents/protocol.md) (GTF), the method Flow defines for agents. Precedence is fixed: **GTF first, then these skills, then each project's own rules** — a lower level only fills what the levels above leave open. Each one lives in `skills/<name>/SKILL.md`; install it with the [`skills` CLI](https://github.com/vercel-labs/skills) (`npx skills add ttoss/skills`), which records it in the consuming repo's `skills-lock.json`.

| Skill | What it does |
| --- | --- |
| [`flow-manager`](skills/flow-manager/SKILL.md) | Manages a project's autonomous delivery loop from its Flow graph: one tick reads the graph, merges, releases, tests in production and delegates every ready task to a child session. Run it with `/loop 10m /flow-manager`; a task id, `tag:<name>` or a description focuses it on part of the graph, `--max-sessions N` caps child sessions and `--voice normal` turns off the terse default ([inspired by caveman](https://github.com/JuliusBrussee/caveman)). |
| [`flow-setup`](skills/flow-setup/SKILL.md) | Sets a repository up for the loop, or audits it again: installs the skills, removes rules that restate or contradict GTF and the skills, keeps only what is specific to the project, proposes the Flow standing decision and opens a PR for review. |
| [`flow-friction`](skills/flow-friction/SKILL.md) | Files friction met in a skill, the Get Things Flowing method or the Flow MCP tools as an issue here, deduplicated against open issues, and links it back to the Flow task. |
