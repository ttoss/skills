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
// precedes every stage; the stage order holds below that.
// A release step is its own task, delegated as new work once written.
const STAGES = ['conflict', 'integratedCheck', 'round', 'review', 'otherCheck', 'new'];

const bugTier = (task) => {
  if (!(task.tags || []).includes('bug')) return 2;
  if (task.priority === 'very_high') return 0;
  if (task.priority === 'high') return 1;
  return 2;
};

const reconcileChildren = ({ children, params, now }) => {
  const acts = [];
  const closed = new Set();
  for (const child of children) {
    const ageHours = (Date.parse(now) - Date.parse(child.startedAt)) / HOUR;
    const close = (status, reason) => {
      acts.push({ act: 'close_run', run: child.run, status, reason });
      closed.add(child.run);
    };
    if (child.runtime === null) {
      if (ageHours > params.staleAfterHours)
        close('failed', `stale: running ${ageHours.toFixed(1)} h, past Stale after`);
    } else if (child.runtime === 'failed' || child.runtime === 'gone') {
      close('failed', `the runtime reports it ${child.runtime}`);
    } else if (child.runtime === 'idle') {
      if (child.handoff) close('completed', 'idle with its handoff written');
      else
        acts.push({
          act: 'judge',
          about: 'child_left_no_handoff',
          run: child.run,
          tasks: child.tasks,
          reason: 'idle with nothing written: write what it did, then close it',
        });
    }
  }
  return { acts, closed };
};

// Section 3: the transitions on one task's change, in the process's order.
// Returns the acts and, when a child should run, the work item for section 4.
const advance = ({ task, params }) => {
  const change = task.change;
  const acts = [];
  let item = null;
  const roundOrPerson = (why) => {
    if (task.rounds < params.autoRounds) {
      acts.push({
        act: 'move_task',
        task: task.id,
        status: 'active',
        reason: `${why}: round ${task.rounds + 1} of ${params.autoRounds}`,
      });
      item = { stage: 'round', kind: 'round' };
    } else {
      acts.push({
        act: 'wait_on_person',
        task: task.id,
        reason: `${why}, and the ${params.autoRounds} automatic round(s) are spent`,
      });
    }
  };

  if (change.draft) return { acts, item };
  if (change.closed && !change.merged) {
    acts.push({
      act: 'retract_reference',
      task: task.id,
      url: change.url,
      reason: 'the change closed without integrating',
    });
    acts.push({
      act: 'wait_on_person',
      task: task.id,
      reason: 'the change closed without integrating: implement it again, or cancel the task',
    });
    return { acts, item };
  }
  if (change.merged) {
    if (change.pipelineRedAfterMerge) {
      acts.push({
        act: 'move_task',
        task: task.id,
        status: 'active',
        reason: 'the integration pipeline is red',
      });
      return { acts, item: { stage: 'round', kind: 'round' } };
    }
    if (task.status !== 'waiting') return { acts, item };
    if (task.leaves === null)
      acts.push({
        act: 'wait_on_person',
        task: task.id,
        reason: 'integrated, and the body does not say what integrating leaves',
      });
    else if (task.leaves === 'close')
      acts.push({
        act: 'move_task',
        task: task.id,
        status: 'completed',
        reason: `closed on integration, citing ${change.url}`,
      });
    else if (task.leaves === 'release')
      acts.push({
        act: 'release_step',
        task: task.id,
        reason:
          'integrated: write its release step by the Release procedure, a task that blocks it (GTF-N4)',
      });
    else
      acts.push({
        act: 'move_task',
        task: task.id,
        status: 'calendar',
        reason: "integrated: the check's wait the body names",
      });
    return { acts, item };
  }
  if (change.conflict) {
    acts.push({
      act: 'move_task',
      task: task.id,
      status: 'active',
      reason: 'a conflict with the default branch',
    });
    return { acts, item: { stage: 'conflict', kind: 'conflict' } };
  }
  if (change.checks === 'red') {
    if (change.redOnDefault) return { acts, item }; // caused outside the change: no round counted
    roundOrPerson('checks red');
    return { acts, item };
  }
  if (change.checks !== 'green') return { acts, item }; // pending, or unread
  const verdict =
    change.verdict && change.verdict.sha === change.headSha ? change.verdict.result : null;
  if (verdict === 'FINDINGS') {
    roundOrPerson('review findings');
    return { acts, item };
  }
  if (verdict === null && params.reviewByAgent) {
    if (!change.reviewRunActive) item = { stage: 'review', kind: 'review' };
    return { acts, item };
  }
  if (change.touchesOwnGates === null || change.reservedToPerson === null) {
    acts.push({
      act: 'judge',
      about: 'merge_rule',
      task: task.id,
      url: change.url,
      reason:
        'gates passed: does the change alter its own gates, or need what the Merge rule reserves to a person?',
    });
  } else if (change.touchesOwnGates || change.reservedToPerson || !params.agentsMayIntegrate) {
    acts.push({
      act: 'wait_on_person',
      task: task.id,
      reason: `ready for a person to integrate ${change.url}`,
    });
  } else {
    acts.push({ act: 'integrate', task: task.id, url: change.url, reason: 'gates passed' });
  }
  return { acts, item };
};

export const plan = ({ now, params, children = [], tasks = [] }) => {
  const acts = [];
  const reconciled = reconcileChildren({ children, params, now });
  acts.push(...reconciled.acts);

  const items = [];
  for (const task of tasks) {
    if (task.change) {
      const advanced = advance({ task, params });
      acts.push(...advanced.acts);
      if (advanced.item) items.push({ ...advanced.item, task });
      if (task.change.merged && task.due && task.dueKind === 'check')
        items.push({ stage: 'integratedCheck', kind: 'check', task });
    } else if (task.due && task.dueKind === 'check') {
      items.push({ stage: 'otherCheck', kind: 'check', task });
    } else if (task.due) {
      acts.push({
        act: 'judge',
        about: 'wait_against_world',
        task: task.id,
        reason:
          'a wait came due: cleared means active, citing what was checked; still held means its until moves',
      });
    } else if (task.candidate) {
      items.push({ stage: 'new', kind: 'implement', task });
    }
  }

  const running = children.filter((c) => c.byMe && !reconciled.closed.has(c.run)).length;
  let free = Math.max(0, params.maxRuns - running);
  const skipped = [];
  items.sort(
    (a, b) =>
      bugTier(a.task) - bugTier(b.task) ||
      STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) ||
      (a.task.rank ?? Infinity) - (b.task.rank ?? Infinity) ||
      a.task.id.localeCompare(b.task.id),
  );

  for (const item of items) {
    const { task } = item;
    if (item.stage === 'new') {
      if (task.inFocus === false) continue;
      if (task.heldByPerson) {
        skipped.push({ task: task.id, reason: 'held by a person' });
        continue;
      }
      if (task.brief === 'short') {
        acts.push({
          act: 'wait_on_person',
          task: task.id,
          reason: 'the brief is short of the Ready brief',
        });
        skipped.push({ task: task.id, reason: 'short of the Ready brief' });
        continue;
      }
    }
    if (free === 0) break;
    if (item.stage === 'new' && task.brief === null) {
      acts.push({
        act: 'judge',
        about: 'ready_brief',
        task: task.id,
        reason: 'does the brief meet the Ready brief, or ask for more than one delivery?',
      });
      free -= 1;
      continue;
    }
    if (item.stage === 'new' && task.brief === 'split') {
      acts.push({
        act: 'judge',
        about: 'split',
        task: task.id,
        reason: 'split into deliveries that ship alone, then delegate the first wave',
      });
      free -= 1;
      continue;
    }
    acts.push({ act: 'start_child', kind: item.kind, tasks: [task.id], reason: item.stage });
    free -= 1;
  }

  const started = acts.filter((a) => a.act === 'start_child').length;
  const freeReason = items.some((i) => i.stage === 'new' && i.task.inFocus !== false)
    ? 'every candidate left was skipped'
    : 'no candidate left in the focus';
  acts.push({
    act: 'report',
    started,
    runsByMe: running + started,
    cap: params.maxRuns,
    freeSlots: free,
    freeReason: free > 0 ? freeReason : null,
    skipped,
  });
  return acts;
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify(plan(JSON.parse(input)), null, 2) + '\n');
  });
}
