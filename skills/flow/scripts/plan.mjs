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
//             agentsMayIntegrate, focus: null | { task } | { tag } },
//   children: [{ run, tasks: [id], startedAt, byMe,
//                runtime: 'working' | 'idle' | 'failed' | 'gone' | null,
//                handoff: bool }],          // its task closed or waits on gates or a person
//   tasks: [{ id, status, priority, tags, rank, heldByPerson, inFocus,
//             candidate: bool,                // in get-next's ready candidates
//             due: bool,                      // date_came, hold_cleared, or an external wait past until
//             dueKind: 'check' | 'other' | null,
//             brief: 'ready' | 'short' | 'split' | null,
//             leaves: 'close' | 'release' | 'check' | null, // what the body says integrating leaves
//             rounds: number,
//             change: null | { url, draft, headSha,
//                               checks: 'pending' | 'green' | 'red' | null,
//                               redOnDefault, conflict, merged, closed,
//                               pipelineRedAfterMerge,
//                               verdict: null | { sha, result: 'CLEAN' | 'FINDINGS' },
//                               reviewRunActive, touchesOwnGates, reservedToPerson } }]
// }


const HOUR = 3600 * 1000;

// Process rule 3: what ages fastest goes first. A bug at very_high, then high,
// precedes every stage; the stage order holds below that. A release step is
// its own task, delegated as new work once written.
const STAGES = ['conflict', 'integratedCheck', 'round', 'review', 'otherCheck', 'new'];

const bugTier = (task) => {
  if (!(task.tags || []).includes('bug')) {
    return 2;
  }
  return { very_high: 0, high: 1 }[task.priority] ?? 2;
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
  check: (task) => {
    return { act: 'move_task', task: task.id, status: 'calendar', reason: "integrated: the check's wait the body names" };
  },
};

const advanceMerged = ({ task, change }) => {
  if (change.pipelineRedAfterMerge) {
    return {
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: 'the integration pipeline is red' }],
      item: { stage: 'round', kind: 'round' },
    };
  }
  if (task.status !== 'waiting') {
    return { acts: [], item: null };
  }
  const leaves = LEAVES[task.leaves];
  const act = leaves
    ? leaves(task, change)
    : { act: 'wait_on_person', task: task.id, reason: 'integrated, and the body does not say what integrating leaves' };
  return { acts: [act], item: null };
};

// Gates passed: integrate, wait on a person, or ask what the Merge rule reserves.
const gatesPassed = ({ task, change, params }) => {
  if (change.touchesOwnGates === null || change.reservedToPerson === null) {
    return { act: 'judge', about: 'merge_rule', task: task.id, url: change.url, reason: 'gates passed: does the change alter its own gates, or need what the Merge rule reserves to a person?' };
  }
  if (change.touchesOwnGates || change.reservedToPerson || !params.agentsMayIntegrate) {
    return { act: 'wait_on_person', task: task.id, reason: `ready for a person to integrate ${change.url}` };
  }
  return { act: 'integrate', task: task.id, url: change.url, reason: 'gates passed' };
};

const NONE = { acts: [], item: null };

const advanceGreen = ({ task, change, params }) => {
  const verdict = change.verdict && change.verdict.sha === change.headSha ? change.verdict.result : null;
  if (verdict === 'FINDINGS') {
    return roundOrPerson({ task, params, why: 'review findings' });
  }
  if (verdict === null && params.reviewByAgent) {
    return { acts: [], item: change.reviewRunActive ? null : { stage: 'review', kind: 'review' } };
  }
  return { acts: [gatesPassed({ task, change, params })], item: null };
};

const advanceOpen = ({ task, change, params }) => {
  if (change.conflict) {
    return {
      acts: [{ act: 'move_task', task: task.id, status: 'active', reason: 'a conflict with the default branch' }],
      item: { stage: 'conflict', kind: 'conflict' },
    };
  }
  if (change.checks === 'red') {
    // Red on the default branch too is caused outside the change: no round counted.
    return change.redOnDefault ? NONE : roundOrPerson({ task, params, why: 'checks red' });
  }
  return change.checks === 'green' ? advanceGreen({ task, change, params }) : NONE;
};

// Section 3: the transitions on one task's change, in the process's order.
const advance = ({ task, params }) => {
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
  return change.merged ? advanceMerged({ task, change }) : advanceOpen({ task, change, params });
};

const isCheck = (task) => {
  return task.due && task.dueKind === 'check';
};

// One task's acts and the work items it adds for section 4.
const taskWork = ({ task, params }) => {
  if (task.change) {
    const advanced = advance({ task, params });
    const items = advanced.item ? [{ ...advanced.item, task }] : [];
    if (task.change.merged && isCheck(task)) {
      items.push({ stage: 'integratedCheck', kind: 'check', task });
    }
    return { acts: advanced.acts, items };
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
    bugTier(a.task) - bugTier(b.task) ||
    STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) ||
    (a.task.rank ?? Infinity) - (b.task.rank ?? Infinity) ||
    a.task.id.localeCompare(b.task.id)
  );
};

// A new candidate that takes no slot: out of focus, held, or short of the brief.
const newCandidateSkip = (task) => {
  if (task.inFocus === false) {
    return { reason: null };
  }
  if (task.heldByPerson) {
    return { reason: 'held by a person' };
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
const delegate = ({ items, free }) => {
  const acts = [];
  const skipped = [];
  let left = free;
  for (const item of [...items].sort(byPriority)) {
    const skip = item.stage === 'new' ? newCandidateSkip(item.task) : null;
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
    acts.push(slotAct(item));
    left -= 1;
  }
  return { acts, skipped, free: left };
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

export const plan = ({ now, params, children = [], tasks = [] }) => {
  const reconciled = reconcileChildren({ children, params, now });
  const work = tasks.map((task) => {
    return taskWork({ task, params });
  });
  const items = work.flatMap((w) => {
    return w.items;
  });
  const running = children.filter((c) => {
    return c.byMe && !reconciled.closed.has(c.run);
  }).length;
  const delegated = delegate({ items, free: Math.max(0, params.maxRuns - running) });
  const started = delegated.acts.filter((a) => {
    return a.act === 'start_child';
  }).length;
  const anyNew = items.some((i) => {
    return i.stage === 'new' && i.task.inFocus !== false;
  });
  const acted = [...reconciled.acts, ...work.flatMap((w) => {
    return w.acts;
  }), ...delegated.acts];
  const freeReason =
    delegated.free > 0 ? (anyNew ? 'every candidate left was skipped' : 'no candidate left in the focus') : null;
  const report = {
    act: 'report',
    started,
    runsByMe: running + started,
    cap: params.maxRuns,
    freeSlots: delegated.free,
    freeReason,
    skipped: delegated.skipped,
    // The tick's report line opens with this, quoted exactly, so a tick that
    // never ran the planner is visible in its own report.
    line: planLine({ acts: acted, runsByMe: running + started, cap: params.maxRuns, free: delegated.free, freeReason }),
  };
  return [...acted, report];
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
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
