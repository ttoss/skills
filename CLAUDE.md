# CLAUDE.md

## A skill change is checked against the Agentic Workflow

The skills here carry out the ttoss [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow), whose pages live in [ttoss/ttoss](https://github.com/ttoss/ttoss) under `docs/website/docs/engineering/workflow/`. Every change to a skill is checked against those pages in the same piece of work, never left for later:

- `process.md`: the stages, states and transitions the tick applies;
- `parameters.md`: the extension points a project answers;
- `routines.md`: what each routine (tick, Chase, Audit, a project's own) does and reports;
- `principles.md`: the workflow's own principles, and the table mapping each rule to the product development and agentic development principles behind it.

When the change alters what a page says, or adds a rule the table does not map, open the matching pull request in ttoss/ttoss and link the two. A rule that cannot cite a principle is a candidate for removal, so name the principle in the ttoss pull request rather than skipping the row. When the change needs nothing there, say so in this pull request's description, with the page you checked.

If this session cannot push to ttoss/ttoss, ask for that access before calling the work done; a patch left in a scratch file is not a pull request.
