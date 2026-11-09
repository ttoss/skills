import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The tick's planner (docs/proposals/tick-in-code.md): a pure function from
// what the tick read to the acts it should take, in order. It calls nothing;
// the model reads the snapshot, runs this, executes the acts and answers the
// `judge` acts, then runs it again with the answers in the snapshot.
//
// Usage: node plan.mjs < snapshot.json > plan.json
//
// Snapshot (a field the model could not read is null, and blocks only what
// depends on it):
// {
//   now: ISO date,
//   params: { maxRuns, staleAfterHours, autoRounds, reviewByAgent,
//             reviewRequired: bool | null,   // `Review` names a reviewer; null: not stated, a judge
//             agentsMayIntegrate, focus: null | { task } | { tag },
//             releaseQueue,                   // WIP limit on what waits between implementation and release; null: 20
//             leavesByAgent: bool | null,     // the Closing evidence gives the agent the choice of what integrating leaves; null: a judge
//             retargetByAgent: bool | null,   // the standing decision delegates retracting a blocks edge whose source integrated; null: a judge, only when one is found
//             branchesPerRepo: number | null }, // children that may push to one repo this tick (children sharing the tick's push branch: 1); null: no cap
//   defaults: [{ repo, sha,                   // each repo's default branch head
//                red: bool | null,            // its required checks or integration pipeline red there
//                repairTask: id | null }],    // the open task tagged `repair` for that repo
//   children: [{ run, tasks: [id], startedAt, byMe,
//                runtime: 'working' | 'idle' | 'failed' | 'gone' | null,
//                handoff: bool }],          // its task closed or waits on gates or a person
//   tasks: [{ id, status, priority, tags, rank, heldByPerson, inFocus,
//             inherited: priority | null,   // held through an open commitment it blocks, above its own
//             waitsOn: [holder],              // whom its waits are `on`
//             deferredUntil: ISO date | null, // every wait on a person is `scheduled` and still in the future: the latest `until`
//             heldOutside: bool,              // a wait on nobody, outside the team, still holds it
//             blockedBy: [id | null] | null,  // its open `blocks` sources (null: one in a project the caller cannot reach); null: not read
//             candidate: bool,                // in get-next's ready candidates
//             due: bool,                      // date_came, hold_cleared, or an external wait past until
//             dueKind: 'check' | 'other' | null,
//             brief: 'ready' | 'short' | 'split' | null,
//             leaves: 'close' | 'release' | 'check' | 'none' | null, // the task's after_integration; null: not handed off, a judge reads the body
//             check: null | { observe, where, visible_at }, // with leaves check: what the check's wait names, and its date
//             leavesWait: bool,               // it waits on a person because nothing said what integrating leaves (the tick's own wait)
//             rounds: number,                 // the task's fix runs, over all its changes
//             repos: [repo] | null,           // the repos its child pushes to, when it has no change yet; null: not read, a judge under a branch cap
//             repairs: repo | null,           // the repo whose red default branch this task repairs
//             changes: [{ url, repo, draft, headSha, // every live `implements` change, one per repo it touches
//                               checks: 'pending' | 'green' | 'red' | null,
//                               redOnDefault, conflict, merged, closed,
//                               checksBeforeRepair,   // its checks last ran before the repo's latest repair integrated
//                               pipelineRedAfterMerge,
//                               reversal: 'recorded' | 'none' | null, // the reversal path its description records (Before proposing); null: not read yet, a judge
//                               writtenSince,         // the task was written after the change merged and its pipeline finished
//                               checksDoneAt,         // when the head's checks finished green
//                               verdict: null | { sha, result: 'CLEAN' | 'FINDINGS' }, // bound to its commit and an allowed author (host.mjs)
//                               reviewPendingSince,   // a reviewer's pending flow/review status on the head
//                               reviewRunActive,      // a running run holds the task
//                               reviewEnforced,       // the code host refuses to integrate without the review
//                               touchesOwnGates, reservedToPerson,
//                               findingsToPerson }] }] // a FINDINGS the Merge rule gives to a person, not a round; null: a judge
// }
// A task written by hand may carry one `change` in place of `changes`.


const HOUR = 3600 * 1000;

/** A task's changes: the snapshot's `changes`, or the one `change` a hand-written task carries. */
export const changesOf = (task) => {
  return task.changes ?? (task.change ? [task.change] : []);
};

const openOf = (changes) => {
  return changes.filter((c) => { return !c.merged && !c.closed; });
};

/**
 * Every change of the task integrated, one closed unmerged aside: only then
 * does it leave the release queue or take what integrating leaves, since one
 * change in a repo says nothing about the task's change in another.
 */
export const allIntegrated = (task) => {
  const live = changesOf(task).filter((c) => { return c.merged || !c.closed; });
  return live.length > 0 && live.every((c) => { return c.merged; });
};

/** The change the task's work stands on: its first open one, else its last integrated, else its last. */
export const changeOf = (task) => {
  const changes = changesOf(task);
  return openOf(changes)[0] || changes.filter((c) => { return c.merged; }).at(-1) || changes.at(-1) || null;
};

const NONE = { acts: [], item: null };

// Process rule 3: what ages fastest goes first, read from a fixed proxy and
// never estimated per task. A red default branch holds every change in its
// repo, so its repair precedes all; then any task at very_high, bug or not,
// since that priority is the person's word that waiting costs most; then a bug
// at high; then what integrated and nobody has seen in effect; then the waits
// that came due; then what is open at its gates (a conflict, a round, a
// review), among which only Flow's ranking orders; then new work. A release
// step is its own task, delegated as new work once written.
const STAGES = ['repair', 'integratedCheck', 'otherCheck', 'gates', 'new'];

// The priority a task is worked by: what it inherits from an open commitment
// it blocks, which Flow answers only when above its own, else its own. A
// blocker of a very_high is as urgent as the very_high, or the work it holds
// would wait on it while ranking first.
export const effectivePriority = (task) => {
  return task.inherited || task.priority || null;
};

export const urgencyTier = (task) => {
  const priority = effectivePriority(task);
  if (priority === 'very_high') {
    return 0;
  }
  if ((task.tags || []).includes('bug') && priority === 'high') {
    return 1;
  }
  return 2;
};

// Section 2: what to do with one child, or null to leave it.
const childAct = ({ child, params, now }) => {
  const ageHours = (Date.parse(now) - Date.parse(child.startedAt)) / HOUR;
  const close = (status, reason) => {
    return { act: 'close_run', run: child.run, status, reason };
  };
  if (child.runtime === null) {
    return ageHours > params.staleAfterHours
      ? close('failed', `stale: running ${ageHours.toFixed(1)} h, past Stale after`)
      : null;
  }
  if (child.runtime === 'failed' || child.runtime === 'gone') {
    return close('failed', `the runtime reports it ${child.runtime}`);
  }
  if (child.runtime !== 'idle') {
    return null;
  }
  if (child.handoff) {
    return close('completed', 'idle with its handoff written');
  }
  return {
    act: 'judge',
    about: 'child_left_no_handoff',
    run: child.run,
    tasks: child.tasks,
    reason: 'idle with nothing written: write what it did, then close it',
  };
};

const reconcileChildren = ({ children, params, now }) => {
  const acts = children.map((child) => {
    return childAct({ child, params, now });
  }).filter(Boolean);
  const closed = new Set(
    acts.filter((a) => {
      return a.act === 'close_run';
    }).map((a) => {
      return a.run;
    }),
  );
  return { acts, closed };
};

// Rounds are the task's fix runs, whichever of its changes they pushed to.
const roundOrPerson = ({ task, params, why }) => {
  if (task.rounds < params.autoRounds) {
    return {
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: `${why}: round ${task.rounds + 1} of ${params.autoRounds}` }],
      item: { stage: 'gates', kind: 'round' },
    };
  }
  return {
    acts: [{ act: 'wait_on_person', task: task.id, reason: `${why}, and the ${params.autoRounds} automatic round(s) are spent` }],
    item: null,
  };
};

// Findings get a round only when an agent can fix them: what the Merge rule
// reserves to a person (a gate it names, a finding only a person can act on)
// goes to them at once, since a round there spends a child and CI to arrive
// at the same person.
const findingsRound = ({ task, change, params }) => {
  const why = `review findings on ${change.url}`;
  if (task.rounds >= params.autoRounds) {
    return roundOrPerson({ task, params, why });
  }
  if (change.reservedToPerson === true || change.findingsToPerson === true) {
    return { acts: [{ act: 'wait_on_person', task: task.id, reason: `review findings on ${change.url} that the Merge rule gives to a person, with no automatic round` }], item: null };
  }
  if (change.findingsToPerson === null || change.findingsToPerson === undefined) {
    return { acts: [{ act: 'judge', about: 'findings', task: task.id, url: change.url, reason: 'review findings: does the Merge rule give any of them, or the change, to a person rather than a round?' }], item: null };
  }
  return roundOrPerson({ task, params, why });
};

// What the task's body says integrating leaves.
const LEAVES = {
  close: (task) => {
    const urls = changesOf(task).filter((c) => { return c.merged; }).map((c) => { return c.url; });
    return { act: 'move_task', task: task.id, status: 'completed', reason: `closed on integration, citing ${urls.join(', ')}` };
  },
  release: (task) => {
    return { act: 'release_step', task: task.id, reason: 'integrated: write its release step by the Release procedure, a task that blocks it (GTF-N4)' };
  },
  // The handoff's date becomes the wait's: `calendar` asserts a date holds
  // the work, and Flow refuses one without it. A date already past is dated
  // now, so the wait never records a hold that had cleared when written.
  check: (task, change, now) => {
    const until = task.check && now && Date.parse(task.check.visible_at) < Date.parse(now) ? now : task.check?.visible_at;
    return task.check
      ? { act: 'move_task', task: task.id, status: 'calendar', until, reason: `integrated: check ${task.check.observe}, at ${task.check.where}` }
      : { act: 'move_task', task: task.id, status: 'calendar', until: null, reason: "integrated: the check's wait the body names" };
  },
};

// A red default branch: one repair task per repo, never a round on each change
// that landed there, and nothing else integrates in that repo until it is green.
const isHeldByRepair = ({ task, change, underRepair }) => {
  return !task.repairs && underRepair.has(change.repo);
};

// The tick's own wait for a missing after_integration is read again when the
// Closing evidence gives the agent that choice: the parameter governs how
// integrated work is verified, and a wait written before it said so must not
// outlive it. A judge that answered no level since (`leaves: 'none'`) is not
// asked again in the same tick, and a wait a person wrote is theirs.
const rejudgeLeaves = ({ task, change, params }) => {
  if (task.leaves !== null && task.leaves !== undefined) {
    return NONE;
  }
  if (params.leavesByAgent === null || params.leavesByAgent === undefined) {
    return { acts: [{ act: 'judge', about: 'closing_evidence', task: task.id, url: change.url, reason: 'integrated and waiting on a person for what integrating leaves: does the Closing evidence give the agent that choice?' }], item: null };
  }
  return params.leavesByAgent
    ? { acts: [{ act: 'judge', about: 'leaves', task: task.id, url: change.url, reason: 'the Closing evidence gives the agent the choice: read the change, the task and its handoff, and answer close, release or check' }], item: null }
    : NONE;
};

const advanceMerged = ({ task, change, params, underRepair, now }) => {
  // "The change integrated, nothing written since": a task written after the
  // merge and its pipeline was already advanced, and is left as it stands.
  // Except the tick's own wait for what integrating leaves, once the task
  // carries it: that write is the person's answer, and a write after the merge
  // must not be what keeps the tick from reading it. Any other wait on a
  // person, such as a check child's for an act only they can do, asked for
  // something else, so a field written before it answers nothing. A red
  // pipeline's wait is about the pipeline, never about what integrating leaves.
  // An `active` task nobody holds was sent back after the merge (a failed
  // check, a revert whose round never started): it is a round, on a fresh
  // change, or it would sit ready with no path that starts it.
  if (change.writtenSince) {
    if (task.status === 'active' && !task.heldByPerson && !change.reviewRunActive) {
      return { acts: [], item: { stage: 'gates', kind: 'round' } };
    }
    const answered = task.status === 'waiting' && task.heldByPerson && task.leavesWait && !change.pipelineRedAfterMerge && LEAVES[task.leaves];
    if (answered) {
      return { acts: [answered(task, change, now)], item: null };
    }
    return task.status === 'waiting' && task.leavesWait && !change.pipelineRedAfterMerge ? rejudgeLeaves({ task, change, params }) : NONE;
  }
  if (change.pipelineRedAfterMerge && isHeldByRepair({ task, change, underRepair })) {
    return NONE;
  }
  // "The integration's pipeline red": the change is pulled by the reversal
  // path it recorded before the task goes back a round, since a defect in
  // effect costs by the hour and a round costs a child plus CI. A path nobody
  // recorded is not invented: the person decides.
  if (change.pipelineRedAfterMerge) {
    if (change.reversal === null || change.reversal === undefined) {
      return { acts: [{ act: 'judge', about: 'reversal', task: task.id, url: change.url, reason: 'the integration pipeline is red: does the change record a reversal path (recorded, or none)?' }], item: null };
    }
    if (change.reversal === 'none') {
      return { acts: [{ act: 'wait_on_person', task: task.id, reason: 'the integration pipeline is red and the change records no reversal path' }], item: null };
    }
    return {
      acts: [
        { act: 'revert', task: task.id, url: change.url, reason: 'the integration pipeline is red: pull the change by the reversal path its description records' },
        { act: 'move_task', task: task.id, status: 'active', reason: 'the integration pipeline is red; the change is reverted, the log and the revert in the body' },
      ],
      item: { stage: 'gates', kind: 'round' },
    };
  }
  if (task.status !== 'waiting') {
    return { acts: [], item: null };
  }
  if (task.leaves === null || task.leaves === undefined) {
    return { acts: [{ act: 'judge', about: 'leaves', task: task.id, url: change.url, reason: 'integrated: what does the body say integrating leaves (close, release, check, or none)?' }], item: null };
  }
  const leaves = LEAVES[task.leaves];
  const act = leaves
    ? leaves(task, change, now)
    : { act: 'wait_on_person', task: task.id, reason: "integrated, and the task does not say what integrating leaves, a choice the Closing evidence keeps for a person: write the task's after_integration and the next tick applies it" };
  return { acts: [act], item: null };
};

// Gates passed: integrate, wait on a person, or ask what the Merge rule reserves.
const gatesPassed = ({ task, change, params }) => {
  // The planner's reading is never the only guard on the one act the next
  // tick cannot undo: a review the code host does not enforce, a person merges.
  if (params.reviewRequired && change.reviewEnforced !== true) {
    return { act: 'wait_on_person', task: task.id, reason: `ready for a person to integrate ${change.url}: the code host does not require the review (flow/review) on its default branch` };
  }
  if (change.touchesOwnGates === null || change.reservedToPerson === null) {
    return { act: 'judge', about: 'merge_rule', task: task.id, url: change.url, reason: 'gates passed: does the change alter its own gates, or need what the Merge rule reserves to a person?' };
  }
  if (change.touchesOwnGates || change.reservedToPerson || !params.agentsMayIntegrate) {
    return { act: 'wait_on_person', task: task.id, reason: `ready for a person to integrate ${change.url}` };
  }
  return { act: 'integrate', task: task.id, url: change.url, reason: 'gates passed' };
};

const minutesSince = (when, now) => {
  return when ? (Date.parse(now) - Date.parse(when)) / 60000 : null;
};

// Gates fail closed: no verdict for the head never means the gates passed,
// unless `Review` says there is no review.
const advanceGreen = ({ task, change, params, now }) => {
  const verdict = change.verdict && change.verdict.sha === change.headSha ? change.verdict.result : null;
  if (verdict === 'FINDINGS') {
    return findingsRound({ task, change, params });
  }
  if (verdict === 'CLEAN' || params.reviewRequired === false) {
    return { acts: [gatesPassed({ task, change, params })], item: null };
  }
  if (params.reviewRequired !== true) {
    return { acts: [{ act: 'judge', about: 'review', task: task.id, url: change.url, reason: 'no verdict, and the parameters do not state Review: does a reviewer judge this change? Write the Review item to stop asking' }], item: null };
  }
  // One clock: a review request nobody claimed, or a claim nobody is
  // working, is lost on the same slice that takes a silent child as gone.
  const grace = (params.staleAfterHours ?? 4) * 60;
  const claimed = minutesSince(change.reviewPendingSince, now);
  const active = change.reviewRunActive || (claimed !== null && claimed < grace);
  if (params.reviewByAgent) {
    return { acts: [], item: active ? null : { stage: 'gates', kind: 'review' } };
  }
  // A reviewer outside the tick: wait while the request is fresh or claimed;
  // past the grace with neither, the request is lost.
  const asked = minutesSince(change.checksDoneAt, now);
  if (active || asked === null || asked < grace) {
    return NONE;
  }
  return {
    acts: [{ act: 'review_lost', task: task.id, url: change.url, reason: `no verdict for the head ${Math.round(asked)} min after its checks passed, and no reviewer holds it: apply the Review fallback` }],
    item: null,
  };
};

const advanceOpen = ({ task, change, params, underRepair, now }) => {
  if (change.conflict) {
    return {
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: `a conflict with the default branch on ${change.url}` }],
      item: { stage: 'gates', kind: 'conflict' },
    };
  }
  if (isHeldByRepair({ task, change, underRepair })) {
    return NONE;
  }
  if (change.checks === 'red' && change.checksBeforeRepair) {
    // Red on a base the repair has since fixed says nothing about the change.
    return {
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: 'the default branch was repaired after its checks ran: update the branch onto it, no round counted' }],
      item: { stage: 'gates', kind: 'round' },
    };
  }
  if (change.checks === 'red') {
    // Red on the default branch too is caused outside the change: no round
    // counted. A repair's own change is never that: it is the fix.
    return change.redOnDefault && !task.repairs ? NONE : roundOrPerson({ task, params, why: `checks red on ${change.url}` });
  }
  return change.checks === 'green' ? advanceGreen({ task, change, params, now }) : NONE;
};

// The open change's own acts, in the process's order.
const advanceChange = ({ task, change, params, underRepair, now }) => {
  return change.draft ? NONE : advanceOpen({ task, change, params, underRepair, now });
};

// Which change an integrated task advances by: a red pipeline first, then one
// merged since the task was last written, else the last.
const integratedBy = (merged) => {
  return merged.find((c) => { return c.pipelineRedAfterMerge && !c.writtenSince; })
    || merged.find((c) => { return !c.writtenSince; })
    || merged.at(-1);
};

const ITEM_ORDER = ['conflict', 'round', 'review'];

// One status per task, whatever its changes asked: a wait on a person holds
// it, so it wins over a round, which the next tick starts once they answer;
// moves to `active` are one move. Every other act stands, each change's own.
const combine = (results) => {
  const acts = results.flatMap((r) => { return r.acts; });
  const rest = acts.filter((a) => { return a.act !== 'wait_on_person' && a.act !== 'move_task'; });
  const one = (list) => {
    return list.length ? [{ ...list[0], reason: list.map((a) => { return a.reason; }).join('; ') }] : [];
  };
  const waits = acts.filter((a) => { return a.act === 'wait_on_person'; });
  if (waits.length) {
    return { acts: [...rest, ...one(waits)], item: null };
  }
  const items = results.map((r) => { return r.item; }).filter(Boolean)
    .sort((a, b) => { return ITEM_ORDER.indexOf(a.kind) - ITEM_ORDER.indexOf(b.kind); });
  return { acts: [...rest, ...one(acts.filter((a) => { return a.act === 'move_task'; }))], item: items[0] || null };
};

// Section 3: the transitions on a task's changes, in the process's order.
// Each open change takes its own gates; what integrating leaves waits for the
// last of them, so a task with one change per repo never closes, or gets its
// release step, on the first merge.
const advance = ({ task, params, underRepair, now }) => {
  const changes = changesOf(task);
  const open = openOf(changes);
  const merged = changes.filter((c) => { return c.merged; });
  // A change closed unmerged leaves its part of the task undone, whatever
  // the others do: a person implements it again or cancels the task.
  const results = changes.filter((c) => { return c.closed && !c.merged; }).map((c) => {
    return {
      acts: [
        { act: 'retract_reference', task: task.id, url: c.url, reason: 'the change closed without integrating' },
        { act: 'wait_on_person', task: task.id, reason: `${c.url} closed without integrating: implement it again, or cancel the task` },
      ],
      item: null,
    };
  });
  if (open.length === 0 && merged.length === 0) {
    return combine(results);
  }
  if (open.length) {
    results.push(...open.map((change) => { return advanceChange({ task, change, params, underRepair, now }); }));
    // A red pipeline on an integrated change costs by the hour: its reversal
    // does not wait for the task's other changes.
    results.push(...merged.filter((c) => { return c.pipelineRedAfterMerge && !c.writtenSince; }).map((change) => {
      return advanceMerged({ task, change, params, underRepair, now });
    }));
    return combine(results);
  }
  results.push(advanceMerged({ task, change: integratedBy(merged), params, underRepair, now }));
  return combine(results);
};

const isCheck = (task) => {
  return task.due && task.dueKind === 'check';
};

const judgeWait = (task) => {
  return { act: 'judge', about: 'wait_against_world', task: task.id, reason: 'a wait came due: cleared means active, citing what was checked; still held means its until moves' };
};

// One task's acts and the work items it adds for section 4.
const taskWork = ({ task, params, underRepair, now }) => {
  const changes = changesOf(task);
  if (changes.length) {
    const advanced = advance({ task, params, underRepair, now });
    const stage = task.repairs ? { stage: 'repair' } : {};
    const items = advanced.item ? [{ ...advanced.item, ...stage, task }] : [];
    const integrated = allIntegrated(task);
    if (integrated && isCheck(task)) {
      items.push({ stage: 'integratedCheck', kind: 'check', task });
    }
    // A task already advanced past its merge that nothing moves would keep a
    // past-due wait until a person reviews it. The tick's own wait for what
    // integrating leaves is excluded: "cleared means active" would start a round.
    const idle = integrated && changes.filter((c) => { return c.merged; }).every((c) => { return c.writtenSince; }) && advanced.acts.length === 0 && !advanced.item;
    if (idle && task.due && !isCheck(task) && !task.leavesWait) {
      return { acts: [judgeWait(task)], items };
    }
    return { acts: advanced.acts, items };
  }
  if (task.repairs && underRepair.has(task.repairs)) {
    return { acts: [], items: [{ stage: 'repair', kind: 'repair', task }] };
  }
  if (isCheck(task)) {
    return { acts: [], items: [{ stage: 'otherCheck', kind: 'check', task }] };
  }
  if (task.due) {
    return { acts: [judgeWait(task)], items: [] };
  }
  return { acts: [], items: task.candidate ? [{ stage: 'new', kind: 'implement', task }] : [] };
};

const byPriority = (a, b) => {
  return (
    (b.stage === 'repair') - (a.stage === 'repair') ||
    urgencyTier(a.task) - urgencyTier(b.task) ||
    STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) ||
    (a.task.rank ?? Infinity) - (b.task.rank ?? Infinity) ||
    a.task.id.localeCompare(b.task.id)
  );
};

// A task a person holds takes no slot at any stage (section 4, step 1); a new
// candidate also takes none out of focus or short of the brief.
const itemSkip = (item) => {
  const { task } = item;
  if (task.heldByPerson) {
    return { reason: 'held by a person' };
  }
  if (item.stage !== 'new') {
    return null;
  }
  if (task.inFocus === false) {
    return { reason: null };
  }
  if (task.brief === 'short') {
    return {
      reason: 'short of the Ready brief',
      act: { act: 'wait_on_person', task: task.id, reason: 'the brief is short of the Ready brief' },
    };
  }
  return null;
};

// The kinds of child that push a branch; a review or a check child only reads.
const PUSHES = new Set(['implement', 'round', 'conflict', 'repair']);

// The repos a child for this item pushes to: its open changes', else what
// the snapshot says the task touches; null when unknown.
const pushRepos = (item) => {
  if (!PUSHES.has(item.kind)) {
    return [];
  }
  const { task } = item;
  const open = openOf(changesOf(task));
  return open.length ? [...new Set(open.map((c) => { return c.repo; }))] : task.repos ?? null;
};

// The act that fills a slot.
const slotAct = (item, { branchCap } = {}) => {
  const { task } = item;
  if (branchCap && pushRepos(item) === null) {
    return { act: 'judge', about: 'repos', task: task.id, reason: "children share the tick's push branch: which repos does its child push to?" };
  }
  if (item.stage === 'new' && task.brief === null) {
    return { act: 'judge', about: 'ready_brief', task: task.id, reason: 'does the brief meet the Ready brief, or ask for more than one delivery?' };
  }
  if (item.stage === 'new' && task.brief === 'split') {
    return { act: 'judge', about: 'split', task: task.id, reason: 'split into deliveries that ship alone, then delegate the first wave' };
  }
  return { act: 'start_child', kind: item.kind, tasks: [task.id], reason: item.stage === 'gates' ? item.kind : item.stage };
};

// Section 4: fill this person's free slots, what ages fastest first. From
// Max runs 2 up, new work never takes the last free slot (D15, F20): a child
// holds its slot for hours, so a repair or a very_high task arriving next
// would wait for one, and taking it back would mean interrupting a run. The
// slot is head-of-the-line room for what ages faster, never a preemption.
//
// Where children share the tick's push branch per repo (`branchesPerRepo`),
// a child past that count in a repo could not push what it made, so it is not
// started: the slot goes to the next candidate, or ends in that reason.
const delegate = ({ items, free, newWork, cap, branchCap = null }) => {
  const acts = [];
  const skipped = [];
  let left = free;
  let budget = newWork.budget;
  let held = 0;
  let reserved = 0;
  let branchTaken = 0;
  const pushing = new Map();
  const reserve = cap >= 2 ? 1 : 0;
  for (const item of [...items].sort(byPriority)) {
    const skip = itemSkip(item);
    if (skip) {
      if (skip.act) {
        acts.push(skip.act);
      }
      if (skip.reason) {
        skipped.push({ task: item.task.id, reason: skip.reason });
      }
      continue;
    }
    if (left === 0) {
      break;
    }
    const repos = branchCap ? pushRepos(item) || [] : [];
    if (repos.some((repo) => { return (pushing.get(repo) ?? 0) >= branchCap; })) {
      branchTaken += 1;
      skipped.push({ task: item.task.id, reason: "the repo's push branch is taken this tick" });
      continue;
    }
    // New work beyond the WIP limit waits upstream, where waiting is cheap;
    // what the person said cannot wait (very_high, a high bug) starts anyway.
    if (item.stage === 'new' && urgencyTier(item.task) === 2) {
      if (left <= reserve) {
        reserved += 1;
        skipped.push({ task: item.task.id, reason: 'the last free slot is kept for what ages faster' });
        continue;
      }
      if (budget === 0) {
        held += 1;
        skipped.push({ task: item.task.id, reason: `held upstream: ${newWork.why}` });
        continue;
      }
      budget -= 1;
    }
    acts.push(slotAct(item, { branchCap }));
    for (const repo of repos) {
      pushing.set(repo, (pushing.get(repo) ?? 0) + 1);
    }
    left -= 1;
  }
  return { acts, skipped, free: left, held, reserved, branchTaken };
};

// The WIP limit that holds new work upstream (W1, W21): the release queue, what
// waits between an implementation and its release to the customer (review,
// integration, validation, a flag's removal). That is each open
// change past draft, at its gates or with a person to integrate it, and each
// integrated change whose task waits on a person to see it in effect or came
// due. Every new start lands in it, so the headroom is exact. Decisions are not
// in it: one holds only the work it blocks, so a thousand open choices never
// stop the work nobody has to choose about. A validation a person dated in the
// future is held by that decision, like `incubated` work, and holding new work
// would not bring its date closer: it enters the queue when it comes due. What
// waits on nobody is outside the team, and holding new work never drains it,
// so a past chase date on it does not count.
// A task with one change per repo stays in it until the last integrates.
export const inReleaseQueue = (task) => {
  const { waitsOn, deferredUntil, due, heldOutside } = task;
  const open = openOf(changesOf(task));
  if (open.some((c) => { return !c.draft; })) {
    return true;
  }
  if (open.length || !allIntegrated(task)) {
    return false;
  }
  if (deferredUntil) {
    return false;
  }
  return (waitsOn || []).length > 0 || (Boolean(due) && !heldOutside);
};

const releaseQueue = (tasks) => {
  return tasks.filter(inReleaseQueue).length;
};

// How many new tasks this tick may start, and why fewer than its free slots.
const newWorkBudget = ({ tasks, params }) => {
  const limit = params.releaseQueue ?? 20;
  const queued = releaseQueue(tasks);
  return { budget: Math.max(0, limit - queued), why: `release queue ${queued}/${limit}`, wip: { releaseQueue: { now: queued, limit } } };
};

// `plan: <n> acts (<kind> <count>, …) · runs <n>/<cap> by me (<free> free: <why>)`
const planLine = ({ acts, runsByMe, cap, free, freeReason, held = 0 }) => {
  const counts = {};
  for (const a of acts) {
    counts[a.act] = (counts[a.act] ?? 0) + 1;
  }
  const kinds = Object.entries(counts)
    .map(([kind, n]) => {
      return `${kind} ${n}`;
    })
    .join(', ');
  const slots = free > 0 ? ` (${free} free: ${freeReason})` : '';
  const integrated = held > 0 ? ` · held by integrated blockers: ${held}` : '';
  return `plan: ${acts.length} acts${kinds ? ` (${kinds})` : ''} · runs ${runsByMe}/${cap} by me${slots}${integrated}`;
};

/**
 * Each open task held only by `blocks` sources whose change integrated while
 * the source stays open (released or checked later, GTF-E8): the edge still
 * gates, and whether it should is a choice nobody made once the merge
 * happened. A source the snapshot does not hold, or cannot name, is unknown,
 * and an unknown is never a finding.
 */
export const heldByIntegrated = (tasks) => {
  const byId = new Map(tasks.map((t) => { return [t.id, t]; }));
  return tasks.flatMap((task) => {
    const ids = task.blockedBy || [];
    if (ids.length === 0) {
      return [];
    }
    const sources = ids.map((id) => { return id && byId.get(id); });
    const integrated = sources.every((s) => { return s && allIntegrated(s); });
    if (!integrated) {
      return [];
    }
    return [{ task: task.id, sources: sources.map((s) => { return { task: s.id, url: changeOf(s).url }; }) }];
  });
};

// What the tick does with a target held only by integrated sources: report it
// (P7), since retracting the edge builds on work nobody has validated and
// makes reverting the source cost more; or, when the standing decision
// delegates it, retract each edge and record a `mentions` with the change.
const integratedBlockerActs = ({ tasks, params }) => {
  const found = heldByIntegrated(tasks);
  if (found.length === 0) {
    return { acts: [], findings: [] };
  }
  if (params.retargetByAgent === null || params.retargetByAgent === undefined) {
    return {
      acts: [{ act: 'judge', about: 'integrated_blockers', tasks: found.map((f) => { return f.task; }), reason: 'a task is held only by blocks sources whose change integrated: does the standing decision delegate retracting such an edge?' }],
      findings: found,
    };
  }
  if (!params.retargetByAgent) {
    return { acts: [], findings: found };
  }
  return {
    acts: found.flatMap((f) => {
      return f.sources.map((s) => {
        return { act: 'retarget_blocks', task: f.task, from: s.task, url: s.url, reason: `its source's change ${s.url} integrated: retract the blocks edge and record mentions, citing the standing decision` };
      });
    }),
    findings: [],
  };
};

// Each repo whose default branch is red with no repair task open yet: the tick
// opens one, blocking every task whose change there it holds, and plans again.
const repairActs = ({ defaults, tasks }) => {
  return defaults
    .filter((d) => {
      return d.red === true && !d.repairTask;
    })
    .map((d) => {
      const held = tasks.filter((t) => {
        return changesOf(t).some((c) => { return c.repo === d.repo && !c.closed; });
      });
      return {
        act: 'repair_default',
        repo: d.repo,
        sha: d.sha,
        blocks: held.map((t) => {
          return t.id;
        }),
        reason: 'the default branch is red: open its one repair task, then run the planner again',
      };
    });
};

export const plan = ({ now, params, children = [], tasks = [], defaults = [] }) => {
  const reconciled = reconcileChildren({ children, params, now });
  const underRepair = new Set(
    defaults
      .filter((d) => {
        return d.red === true;
      })
      .map((d) => {
        return d.repo;
      }),
  );
  const work = tasks.map((task) => {
    return taskWork({ task, params, underRepair, now });
  });
  const items = work.flatMap((w) => {
    return w.items;
  });
  const running = children.filter((c) => {
    return c.byMe && !reconciled.closed.has(c.run);
  }).length;
  const newWork = newWorkBudget({ tasks, params });
  const delegated = delegate({ items, free: Math.max(0, params.maxRuns - running), newWork, cap: params.maxRuns, branchCap: params.branchesPerRepo ?? null });
  const started = delegated.acts.filter((a) => {
    return a.act === 'start_child';
  }).length;
  const anyNew = items.some((i) => {
    return i.stage === 'new' && i.task.inFocus !== false;
  });
  const blockers = integratedBlockerActs({ tasks, params });
  const acted = [...reconciled.acts, ...repairActs({ defaults, tasks }), ...work.flatMap((w) => {
    return w.acts;
  }), ...blockers.acts, ...delegated.acts];
  const freeReason = delegated.free === 0
    ? null
    : delegated.held > 0
      ? `new work held upstream: ${newWork.why}`
      : delegated.reserved > 0
        ? 'kept for what ages faster'
        : delegated.branchTaken > 0
          ? "the repo's push branch is taken this tick"
          : anyNew ? 'every candidate left was skipped' : 'no candidate left in the focus';
  const report = {
    act: 'report',
    started,
    runsByMe: running + started,
    cap: params.maxRuns,
    freeSlots: delegated.free,
    freeReason,
    skipped: delegated.skipped,
    wip: newWork.wip,
    // Targets held only by integrated but open sources, for the person: a
    // finding, never a write.
    heldByIntegrated: blockers.findings,
    // The tick's report line opens with this, quoted exactly, so a tick that
    // never ran the planner is visible in its own report.
    line: planLine({ acts: acted, runsByMe: running + started, cap: params.maxRuns, free: delegated.free, freeReason, held: blockers.findings.length }),
  };
  return [...acted, report];
};

// Resolved on both sides: a skill installed through a symlink (`.claude/skills`
// pointing at `.agents/skills`) is run by its link path, while Node reports
// the module at its real path.
const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    process.stdout.write(`${JSON.stringify(plan(JSON.parse(input)), null, 2)}\n`);
  });
}
