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
//             reviewGraceMinutes,            // how long a review may take to start before its request is lost
//             agentsMayIntegrate, focus: null | { task } | { tag },
//             reviewQueue },                 // WIP limit on what waits for review or validation; null: 20
//   defaults: [{ repo, sha,                   // each repo's default branch head
//                red: bool | null,            // its required checks or integration pipeline red there
//                repairTask: id | null }],    // the open task tagged `repair` for that repo
//   children: [{ run, tasks: [id], startedAt, byMe,
//                runtime: 'working' | 'idle' | 'failed' | 'gone' | null,
//                handoff: bool }],          // its task closed or waits on gates or a person
//   tasks: [{ id, status, priority, tags, rank, heldByPerson, inFocus,
//             waitsOn: [holder],              // whom its waits are `on`
//             candidate: bool,                // in get-next's ready candidates
//             due: bool,                      // date_came, hold_cleared, or an external wait past until
//             dueKind: 'check' | 'other' | null,
//             brief: 'ready' | 'short' | 'split' | null,
//             leaves: 'close' | 'release' | 'check' | 'none' | null, // the task's after_integration; null: not handed off, a judge reads the body
//             check: null | { observe, where, visible_at }, // with leaves check: what the check's wait names, and its date
//             rounds: number,
//             repairs: repo | null,           // the repo whose red default branch this task repairs
//             change: null | { url, repo, draft, headSha,
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
//                               touchesOwnGates, reservedToPerson } }]
// }


const HOUR = 3600 * 1000;

const NONE = { acts: [], item: null };

// Process rule 3: what ages fastest goes first, read from a fixed proxy and
// never estimated per task. A red default branch holds every change in its
// repo, so its repair precedes all; then any task at very_high, bug or not,
// since that priority is the person's word that waiting costs most; then a bug
// at high; the stage order holds below that. A release step is its own task,
// delegated as new work once written.
const STAGES = ['repair', 'conflict', 'integratedCheck', 'round', 'review', 'otherCheck', 'new'];

const urgencyTier = (task) => {
  if (task.priority === 'very_high') {
    return 0;
  }
  if ((task.tags || []).includes('bug') && task.priority === 'high') {
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

const roundOrPerson = ({ task, params, why }) => {
  if (task.rounds < params.autoRounds) {
    return {
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: `${why}: round ${task.rounds + 1} of ${params.autoRounds}` }],
      item: { stage: 'round', kind: 'round' },
    };
  }
  return {
    acts: [{ act: 'wait_on_person', task: task.id, reason: `${why}, and the ${params.autoRounds} automatic round(s) are spent` }],
    item: null,
  };
};

// What the task's body says integrating leaves.
const LEAVES = {
  close: (task, change) => {
    return { act: 'move_task', task: task.id, status: 'completed', reason: `closed on integration, citing ${change.url}` };
  },
  release: (task) => {
    return { act: 'release_step', task: task.id, reason: 'integrated: write its release step by the Release procedure, a task that blocks it (GTF-N4)' };
  },
  // The handoff's date becomes the wait's: `calendar` asserts a date holds
  // the work, and Flow refuses one without it.
  check: (task) => {
    return task.check
      ? { act: 'move_task', task: task.id, status: 'calendar', until: task.check.visible_at, reason: `integrated: check ${task.check.observe}, at ${task.check.where}` }
      : { act: 'move_task', task: task.id, status: 'calendar', until: null, reason: "integrated: the check's wait the body names" };
  },
};

// A red default branch: one repair task per repo, never a round on each change
// that landed there, and nothing else integrates in that repo until it is green.
const isHeldByRepair = ({ task, change, underRepair }) => {
  return !task.repairs && underRepair.has(change.repo);
};

const advanceMerged = ({ task, change, underRepair }) => {
  // "The change integrated, nothing written since": a task written after the
  // merge and its pipeline was already advanced, and is left as it stands.
  if (change.writtenSince) {
    return { acts: [], item: null };
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
      item: { stage: 'round', kind: 'round' },
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
    ? leaves(task, change)
    : { act: 'wait_on_person', task: task.id, reason: 'integrated, and the body does not say what integrating leaves' };
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
    return roundOrPerson({ task, params, why: 'review findings' });
  }
  if (verdict === 'CLEAN' || params.reviewRequired === false) {
    return { acts: [gatesPassed({ task, change, params })], item: null };
  }
  if (params.reviewRequired !== true) {
    return { acts: [{ act: 'judge', about: 'review', task: task.id, url: change.url, reason: 'no verdict, and the parameters do not state Review: does a reviewer judge this change? Write the Review item to stop asking' }], item: null };
  }
  const grace = params.reviewGraceMinutes ?? 30;
  const claimed = minutesSince(change.reviewPendingSince, now);
  const active = change.reviewRunActive || (claimed !== null && claimed < grace);
  if (params.reviewByAgent) {
    return { acts: [], item: active ? null : { stage: 'review', kind: 'review' } };
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
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: 'a conflict with the default branch' }],
      item: { stage: 'conflict', kind: 'conflict' },
    };
  }
  if (isHeldByRepair({ task, change, underRepair })) {
    return NONE;
  }
  if (change.checks === 'red' && change.checksBeforeRepair) {
    // Red on a base the repair has since fixed says nothing about the change.
    return {
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: 'the default branch was repaired after its checks ran: update the branch onto it, no round counted' }],
      item: { stage: 'round', kind: 'round' },
    };
  }
  if (change.checks === 'red') {
    // Red on the default branch too is caused outside the change: no round
    // counted. A repair's own change is never that: it is the fix.
    return change.redOnDefault && !task.repairs ? NONE : roundOrPerson({ task, params, why: 'checks red' });
  }
  return change.checks === 'green' ? advanceGreen({ task, change, params, now }) : NONE;
};

// Section 3: the transitions on one task's change, in the process's order.
const advance = ({ task, params, underRepair, now }) => {
  const { change } = task;
  if (change.draft) {
    return NONE;
  }
  if (change.closed && !change.merged) {
    return {
      acts: [
        { act: 'retract_reference', task: task.id, url: change.url, reason: 'the change closed without integrating' },
        { act: 'wait_on_person', task: task.id, reason: 'the change closed without integrating: implement it again, or cancel the task' },
      ],
      item: null,
    };
  }
  return change.merged
    ? advanceMerged({ task, change, underRepair })
    : advanceOpen({ task, change, params, underRepair, now });
};

const isCheck = (task) => {
  return task.due && task.dueKind === 'check';
};

// One task's acts and the work items it adds for section 4.
const taskWork = ({ task, params, underRepair, now }) => {
  if (task.change) {
    const advanced = advance({ task, params, underRepair, now });
    const stage = task.repairs ? { stage: 'repair' } : {};
    const items = advanced.item ? [{ ...advanced.item, ...stage, task }] : [];
    if (task.change.merged && isCheck(task)) {
      items.push({ stage: 'integratedCheck', kind: 'check', task });
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
    return {
      acts: [{ act: 'judge', about: 'wait_against_world', task: task.id, reason: 'a wait came due: cleared means active, citing what was checked; still held means its until moves' }],
      items: [],
    };
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

// The act that fills a slot.
const slotAct = (item) => {
  const { task } = item;
  if (item.stage === 'new' && task.brief === null) {
    return { act: 'judge', about: 'ready_brief', task: task.id, reason: 'does the brief meet the Ready brief, or ask for more than one delivery?' };
  }
  if (item.stage === 'new' && task.brief === 'split') {
    return { act: 'judge', about: 'split', task: task.id, reason: 'split into deliveries that ship alone, then delegate the first wave' };
  }
  return { act: 'start_child', kind: item.kind, tasks: [task.id], reason: item.stage };
};

// Section 4: fill this person's free slots, what ages fastest first.
const delegate = ({ items, free, newWork }) => {
  const acts = [];
  const skipped = [];
  let left = free;
  let budget = newWork.budget;
  let held = 0;
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
    // New work beyond the WIP limit waits upstream, where waiting is cheap;
    // what the person said cannot wait (very_high, a high bug) starts anyway.
    if (item.stage === 'new' && urgencyTier(item.task) === 2) {
      if (budget === 0) {
        held += 1;
        skipped.push({ task: item.task.id, reason: `held upstream: ${newWork.why}` });
        continue;
      }
      budget -= 1;
    }
    acts.push(slotAct(item));
    left -= 1;
  }
  return { acts, skipped, free: left, held };
};

// The WIP limit that holds new work upstream (W1, W21): the review queue, what
// waits to be reviewed or validated after an implementation. That is each open
// change past draft, at its gates or with a person to integrate it, and each
// integrated change whose task waits on a person to see it in effect. Every new
// start lands in it, so the headroom is exact. Decisions are not in it: one
// holds only the work it blocks, so a thousand open choices never stop the work
// nobody has to choose about.
const reviewQueue = (tasks) => {
  return tasks.filter(({ change, waitsOn }) => {
    if (!change || change.closed) {
      return false;
    }
    return change.merged ? (waitsOn || []).length > 0 : !change.draft;
  }).length;
};

// How many new tasks this tick may start, and why fewer than its free slots.
const newWorkBudget = ({ tasks, params }) => {
  const limit = params.reviewQueue ?? 20;
  const queued = reviewQueue(tasks);
  return { budget: Math.max(0, limit - queued), why: `review queue ${queued}/${limit}`, wip: { reviewQueue: { now: queued, limit } } };
};

// `plan: <n> acts (<kind> <count>, …) · runs <n>/<cap> by me (<free> free: <why>)`
const planLine = ({ acts, runsByMe, cap, free, freeReason }) => {
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
  return `plan: ${acts.length} acts${kinds ? ` (${kinds})` : ''} · runs ${runsByMe}/${cap} by me${slots}`;
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
        return t.change && t.change.repo === d.repo && !t.change.closed;
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
  const delegated = delegate({ items, free: Math.max(0, params.maxRuns - running), newWork });
  const started = delegated.acts.filter((a) => {
    return a.act === 'start_child';
  }).length;
  const anyNew = items.some((i) => {
    return i.stage === 'new' && i.task.inFocus !== false;
  });
  const acted = [...reconciled.acts, ...repairActs({ defaults, tasks }), ...work.flatMap((w) => {
    return w.acts;
  }), ...delegated.acts];
  const freeReason = delegated.free === 0
    ? null
    : delegated.held > 0
      ? `new work held upstream: ${newWork.why}`
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
    // The tick's report line opens with this, quoted exactly, so a tick that
    // never ran the planner is visible in its own report.
    line: planLine({ acts: acted, runsByMe: running + started, cap: params.maxRuns, free: delegated.free, freeReason }),
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
