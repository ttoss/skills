# ttoss skills

Agent skills shared across ttoss projects. Each one lives in `skills/<name>/SKILL.md`; install it with the [`skills` CLI](https://github.com/vercel-labs/skills) (`npx skills add ttoss/skills`), which records it in the consuming repo's `skills-lock.json`.

| Skill | What it does |
| --- | --- |
| [`flow-manager`](skills/flow-manager/SKILL.md) | Manages a project's autonomous delivery loop from its Flow graph: one tick reads the graph, merges, releases, tests in production and delegates every ready task to a child session. Run it with `/loop 10m /flow-manager`. |
| [`flow-friction`](skills/flow-friction/SKILL.md) | Files friction met in a skill, the Get Things Flowing method or the Flow MCP tools as an issue here, deduplicated against open issues, and links it back to the Flow task. |
