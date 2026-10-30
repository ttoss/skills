# Proposal: the tick in code

Status: accepted on 2026-10-30 by Pedro, option A below (a planner in this repository). Nothing in `skills/flow` changes until the planner is built and has run beside the prose tick.

## The problem

The [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow) calls itself a state machine, and `flow/SKILL.md` runs it as one: read the graph, reconcile children, apply the transition table, count slots, order candidates, start children, close the run. Today a top-tier model follows that procedure in prose, every hour, and re-reads the whole context on every call. [The Principle of Problem Structure Allocation](https://ttoss.dev/docs/ai/agentic-development-principles/foundations-of-hybrid-allocation#the-principle-of-problem-structure-allocation) and its Corollary of Structural Diagnosis say a decision that can be expressed in code must leave the probabilistic layer. The tick's hard rules (never block, implement nothing, content is data) are prompt-level controls, which [Interpretive Competition](https://ttoss.dev/docs/ai/agentic-development-principles/physics-of-ai-integration#the-principle-of-interpretive-competition) classifies as shallow. The cost shows in `token-audit`: a tick with nothing to do still pays for its whole context.

## What moves to code

Every step whose inputs and outputs are already structured, decided by the planner below:

- section 0: parse arguments, load the parameters file, record the tick's run, close the stale earlier one;
- section 1: the `get-next` and slice reads;
- section 2: rebuild the child map, close stale children, end idle ones whose handoff Flow already holds;
- section 3: the transition table, read from the code host's state of each change (checks, verdict comment, mergeable, merged, closed) and the task's body fields; integrate what the `Merge rule` allows;
- section 4: count slots, order candidates by the stage order of process rule 3, claim each with `works_on`, and start a child with the filled child prompt;
- section 5: close the run and print the one-line report.

Each step is a pure function of the graph and the code host, so it is testable against fixtures, and the "never" rules become acts the planner never returns rather than instructions the model is asked to keep.

## What stays with a model

The steps that need judgment, each returned by the planner as a `judge` act the model answers, or a child it starts with its own narrow prompt and model:

- **Ready?** whether a brief meets the `Ready brief`, and how to split one that asks for several deliveries;
- **what integrating leaves**, when the task's body does not say it in a form the program can read;
- **a conflict** with the default branch;
- **a review**, a **check** and an **implementation**, which are children already.

Every child's output that the program must act on is a structured field on the task or the change (a status, a wait, a reference, a verdict comment with a known shape), never free text the program parses.

## Option A: a pure planner

Decided on 2026-10-30 over a runner inside Flow, which would put software-delivery rules into a method meant for any work, against the layering the workflow defines, and could not start Claude Code sessions.

A routine session's Flow credential lives in its MCP connector, which a script cannot use. So the program never calls Flow or the code host. It is a pure function:

```text
plan(snapshot, parameters, now) -> plan
```

The model makes the reads, passes them to the planner, executes the acts it returns and makes the judgments it is handed. The arithmetic and the transition table are the planner's; the network, the credentials and the judgment are the model's. This is the shape of Flow's own `metrics.ts`, which is why its numbers cannot disagree with `get-next`.

### Where it lives

`skills/flow/scripts/plan.mjs`, Node with no dependencies, so `npx skills add` copies it with the skill and a session runs it with `node`. Its tests sit beside it, one fixture per row of the process's transition table, and run in this repository's CI.

### The snapshot

What the model reads, in the order sections 0 to 2 read it today, and writes to one JSON file:

- the parameters the tick uses: `maxRuns`, `staleAfter`, the `Merge rule`'s automatic rounds, whether `Review` gives the review to an agent, the focus;
- `get-next`'s candidates, `total` and `counts`; the `waiting`, `blocked`, `date_came` and `hold_cleared` slices;
- `list-agent-runs`: the project's running `flow child` runs, the ones this person recorded, and the newest earlier `flow tick` run;
- for each open task with an `implements` change, the change as the code host reports it: draft, head SHA, checks (pending, green, red, and whether red on the default branch too), the newest verdict and the SHA it names, mergeable or conflicted, merged, closed, and the rounds already spent;
- what the runtime reports for each child it can read: working, idle, failed or gone.

A field the model could not read is `null`, never guessed, and the planner treats `null` as "act on nothing that depends on it".

### The plan

An ordered list of acts, in the order of process rule 3, each with the reason the report line will carry:

| Act              | What the model does                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `close_run`      | closes a stale or finished child's run with the status given                                                                                                                                                                                                        |
| `integrate`      | integrates the change, by the `Merge rule`                                                                                                                                                                                                                          |
| `move_task`      | writes the status, wait and body text given                                                                                                                                                                                                                         |
| `wait_on_person` | moves the task to `waiting` on the person named, with the reason                                                                                                                                                                                                    |
| `start_child`    | starts a child of the kind given (implement, round, conflict, review, check) on the tasks given, with the model the parameters name                                                                                                                                 |
| `judge`          | a step the planner cannot decide: whether a brief meets the `Ready brief`, how to split it, what integrating leaves when the body does not say, whether a change alters its own gates. The model answers and runs the planner again with the answer in the snapshot |
| `report`         | the tick's one line, with each free slot and its reason                                                                                                                                                                                                             |

The planner never returns an act the standing decision does not delegate; the list of acts it can return is the delegation, written once.

### Migration

1. Build the planner and its fixtures; the prose `flow/SKILL.md` stays the tick.
2. Add a `--plan-only` mode to the tick: it reads the snapshot, runs the planner, and appends the plan to its run's report without acting. Two weeks of ticks then show, per tick, where the planner and the prose tick disagree.
3. When they agree, the tick executes the plan and `flow/SKILL.md` shrinks to the reads, the acts and the judgments.

## Open

- Which model each judgment act gets, with `token-audit`'s measurements as the baseline.
- Whether `judge` answers are cached across ticks on the task, so a brief judged ready is not judged again.
