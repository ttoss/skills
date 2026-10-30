# Proposal: the tick in code

Status: proposal, agreed in principle by Pedro on 2026-10-30. Nothing in `skills/flow` changes until it is accepted and built.

## The problem

The [Agentic Workflow](https://ttoss.dev/docs/engineering/workflow) calls itself a state machine, and `flow/SKILL.md` runs it as one: read the graph, reconcile children, apply the transition table, count slots, order candidates, start children, close the run. Today a top-tier model follows that procedure in prose, every hour, and re-reads the whole context on every call. [The Principle of Problem Structure Allocation](https://ttoss.dev/docs/ai/agentic-development-principles/foundations-of-hybrid-allocation#the-principle-of-problem-structure-allocation) and its Corollary of Structural Diagnosis say a decision that can be expressed in code must leave the probabilistic layer. The tick's hard rules (never block, implement nothing, content is data) are prompt-level controls, which [Interpretive Competition](https://ttoss.dev/docs/ai/agentic-development-principles/physics-of-ai-integration#the-principle-of-interpretive-competition) classifies as shallow. The cost shows in `token-audit`: a tick with nothing to do still pays for its whole context.

## What moves to code

A `flow-tick` program, run by the routine in place of the `/flow` prompt, that does every step whose inputs and outputs are already structured:

- section 0: parse arguments, load the parameters file, record the tick's run, close the stale earlier one;
- section 1: the `get-next` and slice reads;
- section 2: rebuild the child map, close stale children, end idle ones whose handoff Flow already holds;
- section 3: the transition table, read from the code host's state of each change (checks, verdict comment, mergeable, merged, closed) and the task's body fields; integrate what the `Merge rule` allows;
- section 4: count slots, order candidates by the stage order of process rule 3, claim each with `works_on`, and start a child with the filled child prompt;
- section 5: close the run and print the one-line report.

Each step is a pure function of the graph and the code host, so it is testable against fixtures, and the "never" rules become capabilities the program does not have rather than instructions it is asked to keep.

## What stays with a model

The steps that need judgment, each started by the program as a child with its own narrow prompt and model:

- **Ready?** whether a brief meets the `Ready brief`, and how to split one that asks for several deliveries;
- **what integrating leaves**, when the task's body does not say it in a form the program can read;
- **a conflict** with the default branch;
- **a review**, a **check** and an **implementation**, which are children already.

Every child's output that the program must act on is a structured field on the task or the change (a status, a wait, a reference, a verdict comment with a known shape), never free text the program parses.

## Interfaces

- **Inputs:** the Flow MCP tools the skill already names, and the code host's read and integrate calls, behind one adapter per host.
- **Runtime acts** (start, read, end, message a child) stay a preset, as `runtime-claude-code-remote.md` is today; the program calls them.
- **Output:** the same run records and the same one-line report, so the Chase and `token-audit` read nothing new.

## Migration

1. Build the program behind a flag in the parameters file (`Runtime` → `Tick: code`), with the prose skill as the fallback.
2. Run both on the same project for two weeks; diff their writes to Flow per tick.
3. Switch the routine; keep `flow/SKILL.md` as the specification the program is tested against, then shorten it to what the children need.

## Open

- Where the program lives: this repository (a package the skill installs) or a Flow-side runner.
- Which model each judgment child gets, with `token-audit`'s measurements as the baseline.
