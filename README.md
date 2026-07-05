# skills

A catalog of [Agent Skills](https://agentskills.io) published by **ttoss**, installable into any repo via [`npx skills`](https://github.com/vercel-labs/skills).

## Available skills

| Skill | Description | Install |
| ----- | ----------- | ------- |
| [guardian](skills/guardian) | Guard and improve a repository's AI-readiness — keep it in basis-form and migrate rules from prose into deterministic enforcement. | `npx skills add ttoss/skills --skill guardian` |

## Install

Install a single skill by name:

```bash
npx skills add ttoss/skills --skill guardian
```

For Claude Code, skills install to `.claude/skills/` (project) or `~/.claude/skills/` (global).

## Layout

Each skill lives in `skills/<name>/` with a `SKILL.md` entrypoint, following the Agent Skills standard. `templates/` holds opt-in companion kits you copy into your own repos (e.g. [guardian-field-kit](templates/guardian-field-kit) — usage telemetry for guardian, recorded to your own private sink).

## License

MIT
