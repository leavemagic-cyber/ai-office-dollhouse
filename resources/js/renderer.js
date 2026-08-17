import { cueAppearsOnFloor, globalChoreography } from './choreography.js';
import {
  activeDiscussionProviders,
  baseFloorSessions,
  FLOOR_WORKSTATIONS,
  orderedDiscussionProviders,
  sessionsForProvider,
  SHARED_FLOOR_KEY,
  sharedFloorSessions,
  teamSessions
} from './floor-layout.js';
import {
  assignSeats,
  clamp,
  drawConstructionScene,
  drawArchiveClosure,
  drawFigure,
  drawOfficeItem,
  drawPlate,
  ease,
  IDENTITY,
  itemDepth,
  itemProgressFor,
  officeLayout,
  phaseAt,
  PLAN,
  SEATS_PER_ISLAND,
  planProjector,
  drawPlanFigure,
  drawPlanItem,
  drawPlanPlate,
  drawPlanStairs,
  PLATE,
  projector,
  themeFor,
  TIMELINE
} from './sketch.js';

export const ROOM_META = Object.freeze({
  owner: { title: 'Owner 決策室', subtitle: '永久主位 · 最終決定權', emblem: '#9a7a50' },
  shared: { title: '共用辦公層', subtitle: '沒有 subagent 的單獨工作', emblem: '#7d8a85' },
  codex: { title: 'Codex 工事樓', subtitle: '多任務與 subagent 團隊', emblem: '#637b80' },
  claude: { title: 'Claude 審閱樓', subtitle: '文件、覆核與反方檢查', emblem: '#88755c' },
  gemini: { title: 'Gemini 諮詢樓', subtitle: '短委派與臨時席位', emblem: '#70817d' },
  grok: { title: 'Grok 探索樓', subtitle: '單席研究與查核工作台', emblem: '#657368' },
  lobby: { title: '既有工作大廳', subtitle: 'presence 與檔案，不冒充 live', emblem: '#777166' }
});

// One-floor mode: everyone shares a single plate, told apart by the identity bar
// under their feet.
export const SINGLE_FLOOR_KEY = 'all';
// A compact work floor holds workers only. Owner permanently lives on the separate,
// larger decision floor and is never merged into this capacity.
export const SINGLE_FLOOR_CAPACITY = 6;

const TEAM_ROOMS = ['codex', 'claude', 'gemini', 'grok'];

// The two approved office drawings are transparent scene plates.  They deliberately
// contain no people: every person shown above them is produced from a live lifecycle
// event, never baked into a decorative image.  These anchors place the live line-art
// actor at its matching chair while retaining a small local coordinate system for the
// existing work, handoff, idle and delivery motions.
const FIRST_FLOOR_SCENE_ANCHORS = Object.freeze([
  { gx: 2.15, gy: 7.05, x: 58.0, y: 65.0 }, // Owner, lower left
  { gx: 2.65, gy: 3.4, x: 60.0, y: 35.0 },
  { gx: 1.15, gy: 4.4, x: 45.5, y: 40.5 },
  { gx: 7.05, gy: 6.4, x: 95.0, y: 64.5 },
  { gx: 8.45, gy: 7.28, x: 111.0, y: 65.0 },
  { gx: 7.0, gy: 3.4, x: 95.0, y: 35.0 },
  { gx: 8.42, gy: 4.4, x: 111.0, y: 40.5 },
  { gx: 12.05, gy: 3.55, x: 133.0, y: 36.0 },
  { gx: 12.05, gy: 7.25, x: 133.0, y: 57.0 },
  { gx: 10.45, gy: 5.35, x: 123.0, y: 48.0 },
  { gx: 13.55, gy: 5.35, x: 145.0, y: 48.0 }
]);

const EXECUTION_SCENE_ANCHORS = Object.freeze([
  { gx: 2.7, gy: 2.35, x: 60.0, y: 29.0 },
  { gx: 6.85, gy: 2.35, x: 93.0, y: 29.0 },
  { gx: 2.7, gy: 4.45, x: 60.0, y: 44.0 },
  { gx: 6.85, gy: 4.45, x: 93.0, y: 44.0 },
  { gx: 2.7, gy: 6.55, x: 60.0, y: 60.0 },
  { gx: 6.85, gy: 6.55, x: 93.0, y: 60.0 },
  { gx: 1.35, gy: 8.65, x: 56.0, y: 75.0 }, // supervisor behind S3
  { gx: 10.65, gy: 5.25, x: 122.0, y: 49.0 },
  { gx: 12.0, gy: 6.25, x: 135.0, y: 59.0 },
  { gx: 11.2, gy: 7.65, x: 132.0, y: 73.0 }
]);

function sceneImageBox(image, logicalWidth, logicalHeight) {
  const ratio = Number(image?.naturalWidth || image?.width) / Number(image?.naturalHeight || image?.height);
  if (!Number.isFinite(ratio) || ratio <= 0) return { x: 0, y: 0, width: logicalWidth, height: logicalHeight };
  const width = Math.min(logicalWidth, logicalHeight * ratio);
  const height = width / ratio;
  return { x: (logicalWidth - width) / 2, y: (logicalHeight - height) / 2, width, height };
}

function sceneProjector(room, box) {
  const anchors = room === 'owner' ? FIRST_FLOOR_SCENE_ANCHORS : EXECUTION_SCENE_ANCHORS;
  return (gx, gy, gz = 0) => {
    const nearest = anchors.reduce((best, anchor) => {
      const distance = (anchor.gx - gx) ** 2 + (anchor.gy - gy) ** 2;
      return distance < best.distance ? { anchor, distance } : best;
    }, { anchor: anchors[0], distance: Number.POSITIVE_INFINITY }).anchor;
    // The original coordinate delta is intentionally compact: it preserves a readable
    // walking/typing action near the chair without letting a cue drift into another
    // fixed desk in the approved reference art.
    const localX = (gx - nearest.gx) * 5.6;
    const localY = (gy - nearest.gy) * 4.6 - gz * 3.2;
    return [box.x + nearest.x * (box.width / 160) + localX, box.y + nearest.y * (box.height / 100) + localY];
  };
}

function statusColor(theme, activity) {
  if (activity === 'waiting_owner') return theme.waiting;
  if (activity === 'failed') return theme.error;
  if (activity === 'cancelled' || activity === 'unknown') return theme.quiet;
  if (activity === 'working' || activity === 'running' || activity === 'discussing') return theme.working;
  return theme.quiet;
}

function activityOfSessions(sessions, snapshotFallback = false) {
  if (sessions.some((session) => session.activity === 'failed')) return 'failed';
  if (sessions.some((session) => session.activity === 'waiting_owner')) return 'waiting_owner';
  if (sessions.some((session) => session.activity === 'running' || session.activity === 'discussing' || session.activity === 'working')) {
    return sessions.every((session) => session.source === 'snapshot') ? 'snapshot' : 'working';
  }
  if (sessions.length) return sessions[0].activity || 'idle';
  return snapshotFallback ? 'snapshot' : 'idle';
}

function floorStatusActivity(room, model, annexIndex = 0) {
  if (room === SINGLE_FLOOR_KEY) {
    const states = TEAM_ROOMS.map((team) => activityOfSessions(sessionsForProvider(model?.providers?.[team])));
    if ((model?.owner?.inboxCount || 0) > 0 || states.includes('waiting_owner')) return 'waiting_owner';
    if (states.includes('failed')) return 'failed';
    return states.includes('working') ? 'working' : 'idle';
  }
  if (room === 'owner') return (model?.owner?.inboxCount || 0) > 0 ? 'waiting_owner' : 'idle';
  if (room === 'lobby') return 'idle';
  if (room === SHARED_FLOOR_KEY) return activityOfSessions(sharedFloorSessions(model));
  // A team floor reports its own session's state, not the whole provider's.
  const session = teamSessions(model, room)[annexIndex];
  return session ? activityOfSessions([session]) : 'idle';
}

/** Everyone in the building on one floor, in a stable provider order. */
function singleFloorOccupants(model) {
  const occupants = [];
  for (const room of TEAM_ROOMS) {
    for (const person of allOccupantsForProvider(room, model)) {
      if (person.hidden) continue;
      occupants.push({ ...person, provider: room });
    }
  }
  // Islands fill one at a time. Owner never appears here; the independent decision room
  // remains visible above this compact work floor.
  return occupants.slice(0, SINGLE_FLOOR_CAPACITY).map((person, order) => ({ ...person, podIndex: Math.floor(order / SEATS_PER_ISLAND) }));
}

/**
 * How many people the building holds right now, used to pick single vs stacked floors.
 * Counted from the raw session populations, never from the drawn occupants: those are
 * already clipped to what one plate can seat, so counting them would report a full
 * building as small enough for the single-floor view and silently drop the rest.
 */
export function totalOccupants(model) {
  // Owner has a separate permanent floor and does not consume a work-floor seat.
  return TEAM_ROOMS.reduce((sum, room) => sum
    + sessionsForProvider(model?.providers?.[room])
      .filter((session) => session.source === 'live')
      .reduce((people, session) => people + session.population, 0), 0);
}

/**
 * One session's people, in seating order: the main worker first, then its subagents, then
 * the summarised overflow. `podIndex` is the work island they belong to, so a session fills
 * one three-seat bank completely before the next one opens.
 */
function providerForAgent(agent, fallback) {
  const role = String(agent?.role || '').toLowerCase();
  if (role.includes('claude')) return 'claude';
  if (role.includes('gemini')) return 'gemini';
  if (role.includes('grok')) return 'grok';
  if (role.includes('codex')) return 'codex';
  return fallback;
}

function occupantsForSession(room, model, session, { location = 'execution' } = {}) {
  if (session?.source !== 'live') return [];
  const pod = (model?.providers?.[room]?.livePods || [])[session.index];
  if (!pod) return [];
  const sourceAgents = pod.agents || [];
  const mainAgent = sourceAgents.find((agent) => agent?.isMain) || sourceAgents[0] || {
    id: `main:${pod.id}`, isMain: true, role: 'main AI', activity: pod.activity
  };
  const activeAgents = sourceAgents.some((agent) => agent?.isMain)
    ? sourceAgents
    : [mainAgent, ...sourceAgents.slice(1)];
  const supervisorAgent = activeAgents.find((agent) => agent.id === pod.actingLeadAgentId) || mainAgent;
  const sessionId = pod.id;
  const common = {
    label: pod.label,
    sessionId,
    snapshot: false,
    idleFrom: pod.idleFrom || null,
    idleSinceAt: Number(pod.idleSinceAt) || null,
    deliveredCount: Math.max(0, Number(pod.deliveredCount) || 0),
    workVisual: pod.workVisual || null,
    discussionVisual: pod.discussionVisual || null,
    closingUntil: Number(pod.closingUntil) || null
  };
  const personFor = (agent, index, extra = {}) => {
    const isMain = agent === mainAgent || Boolean(agent?.isMain);
    const supervisor = location === 'execution' && agent === supervisorAgent;
    return {
      ...common,
      id: isMain ? `${pod.id}:main` : agent.id,
      rawAgentId: agent.id,
      provider: providerForAgent(agent, room),
      workVisual: isMain ? pod.workVisual || null : null,
      activity: ['unknown', 'idle', 'completed'].includes(pod.activity)
        ? pod.activity
        : (isMain && pod.activity === 'running' ? 'working' : agent.activity || 'working'),
      manager: location === 'base' && isMain,
      supervisor,
      hidden: (supervisor || (location === 'base' && isMain)) && pod.activity === 'waiting_owner',
      actionStyle: [2, 0, 1, 3, 2][index % 5],
      podIndex: location === 'base' ? session.baseSlot : 0,
      zone: location,
      ...extra
    };
  };

  if (location === 'base') {
    const working = activeAgents.map((agent, index) => personFor(agent, index));
    const finished = (pod.restingAgents || []).map((agent, index) => personFor(agent, working.length + index, {
      id: agent.id,
      activity: 'idle',
      manager: false,
      supervisor: false,
      finishedAt: Number(agent.finishedAt) || 0
    }));
    return [...working, ...finished].slice(0, 2);
  }

  const supervisor = personFor(supervisorAgent, 0, { supervisor: true, manager: true });
  const workers = activeAgents
    .filter((agent) => agent !== supervisorAgent)
    .map((agent, index) => personFor(agent, index + 1, { supervisor: false, manager: false }));
  for (let index = 0; index < Math.max(0, Number(pod.overflowAgentCount) || 0); index += 1) {
    workers.push({
      ...common,
      id: `${pod.id}:overflow:${index}`,
      provider: room,
      activity: pod.activity === 'running' ? 'working' : pod.activity,
      supervisor: false,
      manager: false,
      aggregated: true,
      actionStyle: [0, 1, 3, 2][index % 4],
      podIndex: 0,
      zone: 'execution'
    });
  }

  const resting = (pod.restingAgents || []).map((agent, index) => ({
    ...common,
    id: `rest:${agent.id}`,
    provider: providerForAgent(agent, room),
    activity: 'resting',
    resting: true,
    finishedAt: Number(agent.finishedAt) || 0,
    restOriginIndex: Number.isInteger(agent.seatOrdinal) ? agent.seatOrdinal % FLOOR_WORKSTATIONS : index % FLOOR_WORKSTATIONS,
    actionStyle: index,
    podIndex: 0,
    zone: 'rest'
  }));
  for (let index = 0; index < Math.max(0, Number(pod.restingOverflowCount) || 0); index += 1) {
    resting.push({
      ...common,
      id: `${pod.id}:rest-overflow:${index}`,
      provider: room,
      activity: 'resting',
      resting: true,
      finishedAt: Number(pod.restingOverflowAt) || Number(model?.generatedAt) || Date.now(),
      restOriginIndex: index % FLOOR_WORKSTATIONS,
      actionStyle: index + 2,
      podIndex: 0,
      zone: 'rest'
    });
  }
  return [supervisor, ...workers.slice(0, FLOOR_WORKSTATIONS), ...resting.slice(0, 3)];
}

/** Every session of one provider, used by the single-floor view and the headcount. */
function allOccupantsForProvider(room, model) {
  if (!TEAM_ROOMS.includes(room)) return [];
  return sessionsForProvider(model?.providers?.[room])
    .filter((session) => session.source === 'live')
    .flatMap((session) => occupantsForSession(room, model, session, {
      location: session.floorAssignment === 'base' ? 'base' : 'execution'
    }));
}

/**
 * The shared office: every session that never opened a subagent, from all four providers,
 * told apart by the identity bar under their feet (Owner, 2026-08-11).
 */
function sharedFloorOccupants(model) {
  return sharedFloorSessions(model)
    .flatMap((session) => occupantsForSession(session.room, model, session))
    .filter((person) => !person.hidden)
    .slice(0, FLOOR_WORKSTATIONS)
    .map((person, order) => ({ ...person, podIndex: Math.floor(order / SEATS_PER_ISLAND) }));
}

export function occupantsFromModel(room, model, annexIndex = 0) {
  if (room === SINGLE_FLOOR_KEY) return singleFloorOccupants(model);
  if (room === SHARED_FLOOR_KEY) return sharedFloorOccupants(model);
  if (room === 'owner') {
    const occupants = [{ id: 'owner', label: 'Owner', provider: 'owner', activity: 'idle', manager: true, snapshot: false, actionStyle: 1, podIndex: -1 }];
    for (const session of baseFloorSessions(model)) {
      occupants.push(...occupantsForSession(session.provider, model, session, { location: 'base' }));
    }
    const visitors = Object.entries(model?.providers || {}).flatMap(([provider, team]) =>
      (team.livePods || []).filter((pod) => pod.activity === 'waiting_owner').map((pod) => ({ provider, pod }))
    );
    for (const visitor of visitors.slice(0, 3)) {
      occupants.push({
        id: `visitor:${visitor.provider}:${visitor.pod.id}`,
        label: visitor.provider,
        provider: visitor.provider,
        activity: 'waiting_owner',
        manager: false,
        snapshot: false,
        actionStyle: 3,
        podIndex: -1,
        waitingVisitor: true
      });
    }
    for (const [index, provider] of activeDiscussionProviders(model).entries()) {
      occupants.push({
        id: `discussion:${provider}:${index}`,
        label: provider,
        provider,
        activity: 'discussing',
        manager: false,
        meeting: true,
        snapshot: false,
        podIndex: -1,
        actionStyle: index
      });
    }
    return occupants;
  }
  if (room === 'lobby') {
    // Reception only gets a host while something is actually waiting to be received.
    const hosting = (model?.owner?.inboxCount || 0) > 0;
    return Object.entries(model?.providers || {}).flatMap(([provider, team]) =>
      (team.livePods || []).filter((pod) => pod.activity === 'discussing').map((pod, index) => ({
        id: `meeting:${provider}:${pod.id}`,
        label: provider,
        provider,
        activity: 'discussing',
        manager: false,
        hosting: hosting && index === 0,
        snapshot: false,
        podIndex: 0,
        actionStyle: 1
      }))
    ).slice(0, 4);
  }
  if (!TEAM_ROOMS.includes(room)) return [];
  // A provider floor is one subagent team, so it only ever shows that session's people.
  const session = teamSessions(model, room)[annexIndex];
  return session ? occupantsForSession(room, model, session, { location: 'execution' }) : [];
}

function podCountFor(room, model, occupants) {
  if (![SINGLE_FLOOR_KEY, SHARED_FLOOR_KEY, ...TEAM_ROOMS].includes(room)) return 1;
  const distinct = new Set(occupants.map((person) => person.podIndex || 0));
  return Math.max(1, distinct.size);
}

/**
 * Bounded travel: full mode moves at most two figures at once, other modes
 * one, and every trip keeps the prepare/travel/perform/return/recover beats from V2 7.1.
 */
function travelPose(seat, target, progress) {
  const stage = progress < .12 ? 'prepare'
    : progress < .38 ? 'travel'
      : progress < .6 ? 'perform'
        : progress < .84 ? 'return' : 'recover';
  if (stage === 'prepare') return { gx: seat.gx, gy: seat.gy, pose: 'stand', swing: 0, intensity: ease(progress / .12) };
  if (stage === 'travel' || stage === 'return') {
    const local = stage === 'travel' ? (progress - .12) / .26 : 1 - (progress - .6) / .24;
    const eased = ease(local);
    // Walking figures face where they are going, and the walk home is the other way.
    // Screen x is (gx - gy) in this 2:1 projection, so a purely +gy trip travels left:
    // testing gx alone makes diagonal walkers moonwalk.
    const outbound = (target.gx - target.gy) - (seat.gx - seat.gy) >= 0 ? 1 : -1;
    return {
      gx: seat.gx + (target.gx - seat.gx) * eased,
      gy: seat.gy + (target.gy - seat.gy) * eased,
      pose: 'walk',
      swing: Math.sin(progress * Math.PI * 16) * .55,
      facing: stage === 'travel' ? outbound : -outbound,
      intensity: 1
    };
  }
  if (stage === 'perform') {
    const local = (progress - .38) / .22;
    return { gx: target.gx, gy: target.gy, pose: 'stand', swing: Math.sin(local * Math.PI) * .8, lean: Math.sin(local * Math.PI) * .9, intensity: Math.sin(local * Math.PI) };
  }
  return { gx: seat.gx, gy: seat.gy, pose: 'stand', swing: 0, intensity: 1 - ease((progress - .84) / .16) };
}

/** The permanent Owner has quiet, non-authority idle actions from the approved design. */
export function ownerIdleActionAt(time) {
  return ['coffee', 'documents', 'rest'][Math.floor(Math.max(0, Number(time) || 0) / 8_000) % 3];
}

/** Signature G is a journey and a three-knock request, not a floating question mark. */
export function ownerRequestStage(progress) {
  const value = clamp(progress);
  if (value < .34) return 'leave_team';
  if (value < .58) return 'elevator';
  if (value < .78) return 'three_knocks';
  return 'request_queue';
}

/** Signature J must preserve worker -> lead -> lift -> Owner as distinct visual beats. */
export function completionStage(progress) {
  const value = clamp(progress);
  if (value < .3) return 'worker_to_lead';
  if (value < .48) return 'lead_accepts';
  if (value < .72) return 'lead_to_lift';
  if (value < .84) return 'elevator';
  return 'owner_report';
}

export const TURN_SETTLE_MS = 1_500;
export const P4_SLOT_MS = 30_000;
export const P4_ACTION_MS = 10_000;
// These are deliberately visual-only routines.  A real lifecycle record decides whether
// an actor exists and what broad state they are in; the local renderer then keeps that
// already-real actor from looking frozen between events.  They never write an event,
// change a pod activity, create another person, or claim that a tool/result happened.
export const LIVE_ROUTINE_SLOT_MS = 9_000;
export const LIVE_WORK_ROUTINES = Object.freeze(['keyboard', 'notes', 'inspect', 'organize', 'stretch']);
export const LIVE_WAITING_ROUTINES = Object.freeze(['wait', 'waiting_notes', 'check']);
export const LIVE_IDLE_ROUTINES = Object.freeze(['pause', 'read', 'drink', 'stretch']);
export const LIVE_DISCUSSION_ROUTINES = Object.freeze(['listen', 'gesture', 'notes']);
export const LIVE_REST_ROUTINES = Object.freeze(['read', 'drink', 'pause']);
export const P4_ACTIONS = Object.freeze([
  'daze', 'drink', 'read', 'water', 'blanket', 'pet', 'robot',
  'elevator_wait', 'stickers', 'photo'
]);
let p4Schedule = { slot: null, ownerId: null, action: null, cancelled: false };

/**
 * Return a stable, low-stakes routine for an already-visible live person.  The seed uses
 * only the existing placement/style, not prompt content or a new inferred task fact.
 * Full mode changes every nine seconds; low mode is deliberately calmer.  Important and
 * DND stay quiet, just as they do for the existing P4 choreography.
 */
export function liveRoutineFor(placement, options = {}) {
  const person = placement?.person || {};
  const mode = options.mode || 'low';
  if (person.snapshot || person.provider === 'owner' || mode === 'important' || mode === 'dnd') return null;
  const activity = person.resting ? 'resting' : person.activity;
  const actions = activity === 'working' || activity === 'running'
    ? LIVE_WORK_ROUTINES
    : activity === 'waiting_owner'
      ? LIVE_WAITING_ROUTINES
      : activity === 'idle'
        ? LIVE_IDLE_ROUTINES
        : activity === 'discussing'
          ? LIVE_DISCUSSION_ROUTINES
          : activity === 'resting'
            ? LIVE_REST_ROUTINES
            : null;
  if (!actions) return null;
  const slotMs = mode === 'full' ? LIVE_ROUTINE_SLOT_MS : LIVE_ROUTINE_SLOT_MS * 2;
  const time = Math.max(0, Number(options.time) || 0);
  const slot = Math.floor(time / slotMs);
  const style = Math.abs(Math.trunc(Number(person.actionStyle) || 0));
  const order = Math.max(0, Math.trunc(Number(placement?.order) || 0));
  const index = (slot + style + order * 2) % actions.length;
  return {
    action: actions[index],
    progress: (time % slotMs) / slotMs,
    startedAt: slot * slotMs,
    slotMs
  };
}

function localRoutinePose(seat, placement, options, fallbackPose = 'sit') {
  const routine = liveRoutineFor(placement, options);
  const facing = placement.facing;
  if (!routine) return { ...seat, pose: fallbackPose, swing: 0, lean: 0, facing, alpha: 1 };
  const wave = Math.sin(routine.progress * Math.PI * 2);
  const seated = fallbackPose === 'sit' || fallbackPose === 'type';
  let pose = fallbackPose;
  let swing = 0;
  let lean = 0;
  switch (routine.action) {
    case 'keyboard':
      pose = seated ? 'type' : fallbackPose;
      swing = wave * .65;
      break;
    case 'notes':
    case 'waiting_notes':
    case 'read':
      pose = seated ? 'sit' : fallbackPose;
      lean = .2 + wave * .1;
      break;
    case 'inspect':
    case 'check':
      pose = seated ? 'sit' : fallbackPose;
      lean = .38 + wave * .12;
      break;
    case 'organize':
      pose = seated ? 'sit' : fallbackPose;
      lean = .12 + wave * .08;
      break;
    case 'stretch':
      pose = 'stand';
      lean = wave * .24;
      break;
    case 'wait':
      pose = 'raise';
      break;
    case 'gesture':
      pose = 'stand';
      swing = wave * .34;
      break;
    case 'listen':
      pose = seated ? 'sit' : fallbackPose;
      lean = .22;
      break;
    case 'drink':
      pose = 'drink';
      swing = wave * .28;
      lean = .2;
      break;
    case 'pause':
      pose = seated ? 'sit' : fallbackPose;
      lean = -.28 + wave * .05;
      break;
    default:
      break;
  }
  return {
    ...seat,
    pose,
    swing,
    lean,
    facing,
    alpha: 1,
    routineAction: routine.action,
    routineProgress: routine.progress
  };
}

/**
 * One deterministic building-wide P4 slot. A slot starts every 30 seconds, which stays
 * inside the approved 20-40 second global cadence, and only one lifecycle-backed main
 * worker can own it. Newly idle workers wait until the next full slot so no action starts
 * halfway through and becomes unreadably short.
 */
export function idleCueForModel(model, personId, now = Date.now()) {
  const mode = model?.effectiveMode || 'low';
  const slot = Math.floor(Math.max(0, Number(now) || 0) / P4_SLOT_MS);
  const slotStartedAt = slot * P4_SLOT_MS;
  const elapsed = Math.max(0, Number(now) || 0) - slotStartedAt;
  const candidates = TEAM_ROOMS.flatMap((provider) => (
    (model?.providers?.[provider]?.livePods || []).flatMap((pod) => {
      const ids = [];
      if (pod.activity === 'idle'
        && pod.idleFrom === 'turn_completed'
        && Number(pod.idleSinceAt) + TURN_SETTLE_MS <= slotStartedAt) ids.push(`${pod.id}:main`);
      if (pod.floorAssignment === 'base') {
        for (const worker of pod.restingAgents || []) {
          if (Number(worker.finishedAt || 0) + TURN_SETTLE_MS <= slotStartedAt) ids.push(String(worker.id));
        }
      }
      return ids;
    })
  )).sort();
  if (p4Schedule.slot !== slot) {
    p4Schedule = {
      slot,
      ownerId: candidates.length ? candidates[slot % candidates.length] : null,
      action: P4_ACTIONS[slot % P4_ACTIONS.length],
      cancelled: false
    };
  }
  // Important/DND is a hard visual suppression. If it touches a slot, retire that whole
  // slot instead of resuming a drink/read/watering trip halfway through when full mode
  // returns. The next slot starts from progress zero with a fresh owner.
  if (mode === 'important' || mode === 'dnd') {
    p4Schedule.cancelled = true;
    p4Schedule.ownerId = null;
    return null;
  }
  if (p4Schedule.cancelled || elapsed >= P4_ACTION_MS) return null;
  // If this slot's worker leaves or starts a new turn, finish the slot quietly. Never
  // hand a half-played drink/read/watering action to somebody else mid-animation.
  if (!p4Schedule.ownerId || !candidates.includes(p4Schedule.ownerId) || p4Schedule.ownerId !== personId) return null;
  return {
    action: p4Schedule.action,
    progress: elapsed / P4_ACTION_MS,
    startedAt: slotStartedAt
  };
}

export function isCueMainPerson(person, event) {
  const provider = String(event?.provider || '');
  const sessionId = String(event?.sessionId || '');
  if (!provider || !sessionId) return false;
  if (person?.supervisor && String(person?.sessionId || '').endsWith(`:${sessionId}`)) return true;
  return String(person?.id || '') === `pod:${provider}:${sessionId}:main`;
}

/** The J return leg ends at the exact desk assigned before the cue hid its main worker. */
export function deliveryHomeForCue(room, model, annexIndex, layout, event) {
  // Include an evidence-backed main who is temporarily away at Owner/discussion. J still
  // returns that same person to the desk assigned before the cue hides its base figure.
  const occupants = occupantsFromModel(room, model, annexIndex);
  const placement = assignSeats(layout, occupants).find((entry) => isCueMainPerson(entry.person, event));
  if (placement) return { gx: placement.gx, gy: placement.gy, facing: placement.facing };
  const fallback = layout?.seats?.find((seat) => !seat.role) || { gx: 2.1, gy: 5.1, facing: -1 };
  return { gx: fallback.gx, gy: fallback.gy, facing: fallback.facing || -1 };
}

/**
 * Keep every remaining worker at the seat assigned before Signature J hides its courier.
 * Assigning again after removing the courier lets a full floor slide somebody else into
 * the return desk, so the courier and that worker overlap on the final leg.
 */
export function deliveryPlacementsForCue(layout, occupants, event) {
  const assigned = assignSeats(layout, occupants);
  const courier = layout?.design === 'execution'
    ? assigned.find((entry) => !entry.person.hidden && !entry.person.supervisor && !entry.person.resting)
    : null;
  return assigned.filter((entry) => (
    !entry.person.hidden
    && !isCueMainPerson(entry.person, event)
    && (!courier || entry.person.id !== courier.person.id)
  ));
}

function deliveryCourierHomeForCue(layout, occupants) {
  if (layout?.design !== 'execution') return null;
  const courier = assignSeats(layout, occupants)
    .find((entry) => !entry.person.hidden && !entry.person.supervisor && !entry.person.resting);
  return courier ? { gx: courier.gx, gy: courier.gy, facing: courier.facing } : null;
}

function supervisorForEvent(model, event) {
  const provider = String(event?.provider || '');
  const sessionId = String(event?.sessionId || '');
  if (!TEAM_ROOMS.includes(provider) || !sessionId) return null;
  const session = sessionsForProvider(model?.providers?.[provider])
    .find((candidate) => String(candidate.id || '').endsWith(`:${sessionId}`) || String(candidate.id || '') === sessionId);
  if (!session || session.source !== 'live') return null;
  const location = session.floorAssignment === 'base' ? 'base' : 'execution';
  return occupantsForSession(provider, model, session, { location })
    .find((person) => person.supervisor || person.manager) || null;
}

export function deliveryReturnFacing(home, localProgress) {
  return Number(localProgress) < .92 ? -1 : (home?.facing || -1);
}

function workerIdlePose(seat, placement, options) {
  const { time, layout, idleCue } = options;
  if (!idleCue) {
    return { ...seat, pose: 'sit', swing: 0, lean: 0, facing: placement.facing, alpha: 1 };
  }
  const action = idleCue.action;
  const wave = Math.sin(idleCue.progress * Math.PI * 2);
  if (action === 'water') {
    const plant = layout.items.find((item) => item.kind === 'plant');
    if (!plant) return { ...seat, pose: 'sit', swing: 0, lean: -.55, facing: placement.facing, alpha: 1, idleAction: 'daze' };
    const target = { gx: plant.gx - .55, gy: plant.gy - .2 };
    const travel = travelPose(seat, target, idleCue.progress);
    return {
      ...travel,
      facing: travel.facing || placement.facing,
      alpha: 1,
      idleAction: travel.pose === 'stand' && idleCue.progress >= .38 && idleCue.progress < .6 ? 'water' : null,
      idleProgress: idleCue.progress
    };
  }
  if (action === 'drink') {
    return { ...seat, pose: 'drink', swing: wave, lean: .25, facing: placement.facing, alpha: 1, idleAction: 'drink', idleProgress: idleCue.progress };
  }
  if (action === 'read') {
    return { ...seat, pose: 'sit', swing: 0, lean: .25 + wave * .12, facing: placement.facing, alpha: 1, idleAction: 'read', idleProgress: idleCue.progress };
  }
  if (['blanket', 'pet', 'robot', 'elevator_wait', 'stickers', 'photo'].includes(action)) {
    const deskSeats = (layout.seats || []).filter((candidate) => candidate.desk
      && (Math.abs(candidate.gx - seat.gx) > .1 || Math.abs(candidate.gy - seat.gy) > .1));
    const coworker = deskSeats[0] || { gx: seat.gx + 1.4, gy: seat.gy - .5 };
    const annexCart = (layout.items || []).find((item) => item.kind === 'cart' && item.gx > 9)
      || (layout.items || []).find((item) => item.kind === 'cart');
    const targets = {
      blanket: { gx: coworker.gx + .7, gy: coworker.gy },
      robot: { gx: coworker.gx + .7, gy: coworker.gy },
      pet: { gx: 5.1, gy: 5.25 },
      elevator_wait: { gx: 9.45, gy: 2.0 },
      stickers: annexCart ? { gx: annexCart.gx + .7, gy: annexCart.gy + .8 } : { gx: 4.4, gy: 8.3 },
      photo: { gx: 5.25, gy: 5.7 }
    };
    const travel = travelPose(seat, targets[action], idleCue.progress);
    const performing = travel.pose === 'stand' && idleCue.progress >= .38 && idleCue.progress < .6;
    return {
      ...travel,
      facing: travel.facing || placement.facing,
      alpha: 1,
      idleAction: performing ? action : null,
      idleProgress: idleCue.progress
    };
  }
  return { ...seat, pose: 'sit', swing: 0, lean: -.7 + wave * .08, facing: placement.facing, alpha: 1, idleAction: 'daze', idleProgress: idleCue.progress };
}

export function poseFor(placement, options) {
  const { time, mode, layout } = options;
  const person = placement.person;
  const seat = { gx: placement.gx, gy: placement.gy };
  const still = mode === 'dnd' || mode === 'important';
  const activity = person.activity;

  if (person.provider === 'owner') {
    const ownerAction = still ? 'documents' : ownerIdleActionAt(time);
    return {
      ...seat,
      pose: ownerAction === 'documents' ? 'type' : 'sit',
      swing: 0,
      lean: ownerAction === 'rest' ? -.8 : ownerAction === 'coffee' ? .35 : 0,
      facing: placement.facing,
      alpha: 1,
      ownerAction
    };
  }

  if (person.resting) {
    const originPair = layout.staffSeats?.[person.restOriginIndex] || [seat.gx, seat.gy];
    const origin = { gx: originPair[0], gy: originPair[1] };
    const age = person.finishedAt ? Math.max(0, Number(options.now) - person.finishedAt) : 5_000;
    const progress = clamp(age / 4_000);
    if (!still && progress < 1) {
      if (progress < .14) return { ...origin, pose: 'stand', swing: 0, facing: placement.facing, alpha: 1 };
      const local = ease((progress - .14) / .86);
      const outbound = (seat.gx - seat.gy) - (origin.gx - origin.gy) >= 0 ? 1 : -1;
      return {
        gx: origin.gx + (seat.gx - origin.gx) * local,
        gy: origin.gy + (seat.gy - origin.gy) * local,
        pose: local < .9 ? 'walk' : 'sit',
        swing: Math.sin(progress * Math.PI * 12) * .55,
        facing: local < .9 ? outbound : placement.facing,
        alpha: 1
      };
    }
    return localRoutinePose(seat, placement, options, 'sit');
  }

  // Owner receives requests while seated; the requester is the visitor who raises or
  // knocks. The old branch made Owner raise a hand at their own desk.
  if (activity === 'waiting_owner' && person.provider !== 'owner') {
    return localRoutinePose(seat, placement, options, 'raise');
  }
  if (activity === 'failed') {
    const shake = still ? 0 : Math.sin(time / 90) * .5;
    return { ...seat, gx: seat.gx + shake * .04, pose: 'stand', swing: 0, facing: placement.facing, alpha: 1 };
  }
  if (activity === 'unknown' || activity === 'cancelled' || activity === 'snapshot') {
    return { ...seat, pose: 'stand', swing: 0, facing: placement.facing, alpha: .75 };
  }

  if (activity === 'idle' || placement.role === 'queue') {
    if (!still && options.idleCue) return workerIdlePose(seat, placement, options);
    return localRoutinePose(seat, placement, options, 'sit');
  }
  if (activity === 'discussing') {
    return localRoutinePose(seat, placement, options, 'stand');
  }
  const seated = placement.desk === true || ['seat', 'desk', 'owner', 'meet'].includes(placement.role);
  const cycle = mode === 'full' ? 2_400 : 4_200;
  const local = still ? 0 : ((time + (placement.order || 0) * 430) % cycle) / cycle;
  const workAction = person.workVisual || null;
  const workTarget = !still ? workTargetFor(layout, workAction) : null;
  if (workTarget) {
    const travel = travelPose(seat, workTarget, local);
    const performing = travel.pose === 'stand' && local >= .38 && local < .6;
    return { ...travel, facing: travel.facing || placement.facing, alpha: 1, workAction: performing ? workAction : null, workProgress: local };
  }
  if (!workAction) return localRoutinePose(seat, placement, options, seated ? 'type' : 'stand');
  return {
    ...seat,
    pose: workAction === 'external_wait'
      ? 'sit' : workAction === 'crash' ? 'stand' : seated ? 'type' : 'stand',
    swing: still ? 0 : Math.sin(local * Math.PI * 2) * .8,
    facing: placement.facing,
    alpha: 1,
    workAction,
    workProgress: local
  };
}

/** Physical destination for a structured work fact. Null means truthful generic desk work. */
export function workTargetFor(layout, action) {
  if (!action) return null;
  const cabinet = layout?.items?.find((item) => item.kind === 'cabinet');
  const lockers = layout?.items?.find((item) => item.kind === 'lockers');
  const cart = layout?.items?.find((item) => item.kind === 'cart');
  const board = layout?.items?.find((item) => item.kind === 'board');
  const manager = layout?.manager;
  if (action === 'research' && cabinet) return { gx: cabinet.gx, gy: cabinet.gy + .9 };
  if (action === 'review' && manager) return { gx: manager.gx + 1.05, gy: manager.gy - .25 };
  if (action === 'search') return { gx: board?.gx || 5.2, gy: (board?.gy || .4) + 1.1 };
  if (action === 'test') return { gx: 5.15, gy: 5.35 };
  if (action === 'git' || action === 'merge_conflict') return { gx: 5.15, gy: 5.35 };
  if (action === 'build' && cart) return { gx: cart.gx + .8, gy: cart.gy + .85 };
  if (action === 'document' && cart) return { gx: cart.gx + .75, gy: cart.gy + .75 };
  if (action === 'context' && (lockers || cabinet)) {
    const shelf = lockers || cabinet;
    return { gx: shelf.gx, gy: shelf.gy + .95 };
  }
  if (action === 'rate_limit') {
    const rest = layout?.restSeats?.[0];
    return rest ? { gx: rest[0], gy: rest[1] } : { gx: 4.7, gy: 8.4 };
  }
  if (action === 'whiteboard') return { gx: board?.gx || 5.2, gy: (board?.gy || .4) + .9 };
  return null;
}

function drawOwnerIdleProp(ctx, x, y, theme, action) {
  if (!action) return;
  ctx.recordAnimationCue?.('owner-idle', action, { x, y });
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.fillStyle = theme.text;
  ctx.lineWidth = .55;
  if (action === 'coffee') {
    ctx.beginPath();
    ctx.rect(x + 4.2, y - 8.2, 2.6, 2.7);
    ctx.arc(x + 7.1, y - 6.9, 1.1, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  } else if (action === 'documents') {
    ctx.beginPath();
    ctx.rect(x + 2.8, y - 8.6, 5.5, 3.8);
    ctx.moveTo(x + 3.8, y - 7.4);
    ctx.lineTo(x + 7.2, y - 7.4);
    ctx.moveTo(x + 3.8, y - 6.3);
    ctx.lineTo(x + 6.5, y - 6.3);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x + 5, y - 12, 1.1, 0, Math.PI * 2);
    ctx.arc(x + 8, y - 15, .7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Quiet, generic movement for an actor that is already present because of a live session.
 * These props deliberately have no task, tool, result, participant, or text semantics:
 * they are the local rhythm between verified lifecycle events, not inferred events.
 */
export function drawLiveRoutineProp(ctx, x, y, theme, action, progress = 0, facing = 1) {
  if (!action) return;
  ctx.recordAnimationCue?.('routine', action, { x, y, progress });
  const p = clamp(progress);
  const wave = Math.sin(p * Math.PI * 2);
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.fillStyle = theme.stroke;
  ctx.lineWidth = .5;
  ctx.translate(x, y);
  ctx.scale(facing < 0 ? -1 : 1, 1);
  ctx.translate(-x, -y);
  ctx.beginPath();
  if (action === 'keyboard') {
    // Four shifting key strokes make ordinary desk work visibly alive without saying
    // what is being typed or treating it as an observed coding tool call.
    ctx.rect(x + .8, y - 4.3, 6.8, 1.9);
    for (let index = 0; index < 4; index += 1) {
      const lift = index === Math.floor(p * 4) ? -.38 : 0;
      ctx.moveTo(x + 1.7 + index * 1.35, y - 3.9 + lift);
      ctx.lineTo(x + 1.7 + index * 1.35, y - 2.9 + lift);
    }
  } else if (action === 'notes' || action === 'waiting_notes' || action === 'read') {
    ctx.moveTo(x + .5, y - 5.5); ctx.lineTo(x + 5.4, y - 5.9); ctx.lineTo(x + 5.2, y - 2.7); ctx.lineTo(x + .4, y - 2.4); ctx.closePath();
    ctx.moveTo(x + 2.9, y - 5.7); ctx.lineTo(x + 2.7, y - 2.6);
    if (action !== 'read') {
      ctx.moveTo(x + 5.7, y - 6.2); ctx.lineTo(x + 7.5 + wave * .4, y - 3.1);
    }
  } else if (action === 'inspect' || action === 'check') {
    ctx.rect(x + .9, y - 11.5, 6.7, 4.8);
    ctx.arc(x + 8.8 + wave * .25, y - 7.5, 1.65, 0, Math.PI * 2);
    ctx.moveTo(x + 10, y - 6.3); ctx.lineTo(x + 11.8, y - 4.5);
  } else if (action === 'organize') {
    for (let index = 0; index < 3; index += 1) {
      ctx.rect(x + .5 + index * .65, y - 5.1 - index * .7, 5.2, 2.7);
    }
    ctx.moveTo(x + 6.9, y - 5.7); ctx.lineTo(x + 8.1, y - 3.1 + wave * .25);
  } else if (action === 'stretch') {
    // Two small arcs sit above the real actor's shoulders.  They read as a stretch,
    // not a new person or an Owner request.
    ctx.arc(x - .2, y - 10.6, 3.1, -2.55, -.55);
    ctx.arc(x + 5.8, y - 10.6, 3.1, -2.6, -.58);
  } else if (action === 'wait') {
    ctx.rect(x + 1.1, y - 6.1, 4.8, 3.1);
    ctx.moveTo(x + 2, y - 5.1); ctx.lineTo(x + 4.6, y - 5.1);
  } else if (action === 'listen') {
    ctx.arc(x + 4.5, y - 10.1, 2.15, -1.25, 1.2);
    ctx.arc(x + 4.5, y - 10.1, 3.05, -1.15, 1.1);
  } else if (action === 'gesture') {
    ctx.moveTo(x + 2.1, y - 8.2); ctx.quadraticCurveTo(x + 5.3, y - 12.1 + wave, x + 8.4, y - 8.0);
    ctx.moveTo(x + 5.2, y - 11.1 + wave); ctx.lineTo(x + 6.4, y - 13.1 + wave);
  } else if (action === 'drink') {
    const lift = .5 + Math.sin(p * Math.PI) * 1.15;
    ctx.rect(x + 2.6, y - 9.2 - lift, 2.2, 2.4);
    ctx.arc(x + 5.1, y - 8 - lift, .9, -Math.PI / 2, Math.PI / 2);
  } else if (action === 'pause') {
    // A small desk-side breathing line, never a thought bubble or hidden content.
    for (const offset of [0, 1.8, 3.6]) {
      ctx.moveTo(x + .7 + offset, y - 7.2 - Math.abs(wave) * .25);
      ctx.quadraticCurveTo(x + 1.3 + offset, y - 8.1, x + 1.9 + offset, y - 7.2 - Math.abs(wave) * .25);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export function drawWorkerIdleProp(ctx, x, y, theme, action, progress = 0, facing = 1) {
  if (!action) return;
  ctx.recordAnimationCue?.('worker-idle', action, { x, y, progress });
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.fillStyle = theme.text;
  ctx.lineWidth = .55;
  // Figure geometry mirrors around its seat. Props have to use the same local frame or
  // a left-facing worker reaches one way while the cup/document stays on the other side.
  ctx.translate(x, y);
  ctx.scale(facing < 0 ? -1 : 1, 1);
  ctx.translate(-x, -y);
  if (action === 'drink') {
    const lift = .5 + Math.sin(clamp(progress) * Math.PI) * 1.3;
    ctx.beginPath();
    ctx.rect(x + 2.6, y - 9.2 - lift, 2.2, 2.4);
    ctx.arc(x + 5.1, y - 8 - lift, .9, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  } else if (action === 'read') {
    ctx.beginPath();
    ctx.moveTo(x + .6, y - 5.2);
    ctx.lineTo(x + 5.5, y - 5.7);
    ctx.lineTo(x + 5.2, y - 2.8);
    ctx.lineTo(x + .5, y - 2.4);
    ctx.closePath();
    ctx.moveTo(x + 2.9, y - 5.45);
    ctx.lineTo(x + 2.7, y - 2.6);
    ctx.stroke();
  } else if (action === 'water') {
    ctx.beginPath();
    ctx.rect(x + 2.2, y - 6.5, 3.4, 2.7);
    ctx.moveTo(x + 5.6, y - 5.8);
    ctx.lineTo(x + 8.1, y - 7.1);
    ctx.stroke();
    for (const offset of [0, 1.5, 3]) {
      ctx.beginPath();
      ctx.arc(x + 8.7 + offset, y - 5 + offset * .6, .38, 0, Math.PI * 2);
      ctx.fill();
    }
    if (progress >= .48) {
      // The overwatered plant leaves a puddle, then the worker brings a mop.
      ctx.beginPath(); ctx.ellipse(x + 10.2, y - 1.2, 3.3, .9, 0, 0, Math.PI * 2);
      ctx.moveTo(x + 5.8, y - 10.5); ctx.lineTo(x + 10.2, y - 1.8);
      ctx.moveTo(x + 8.2, y - 1.4); ctx.lineTo(x + 12.3, y - 2.2); ctx.stroke();
    }
  } else if (action === 'daze') {
    for (const offset of [0, 2, 4]) {
      ctx.beginPath();
      ctx.arc(x + 3.8 + offset, y - 13 - offset * .3, .35, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (action === 'blanket') {
    // The active figure stands beside a sleeping coworker and lays the blanket over them.
    drawFigure(ctx, x + 8.5, y, theme, { pose: 'sit', lean: -.85, facing: -1, identity: null, scale: .82 });
    ctx.beginPath();
    ctx.moveTo(x + 4.1, y - 7.6); ctx.quadraticCurveTo(x + 8.3, y - 4.6, x + 12.3, y - 7.2);
    ctx.lineTo(x + 12.3, y - 2.2); ctx.lineTo(x + 4.1, y - 2.2); ctx.closePath(); ctx.stroke();
  } else if (action === 'pet') {
    // A wooden animal chases a rolling paperclip across the open floor.
    const run = Math.sin(clamp(progress) * Math.PI * 4) * 1.2;
    ctx.beginPath(); ctx.ellipse(x + 6 + run, y - 2.2, 2.2, 1.2, 0, 0, Math.PI * 2);
    ctx.moveTo(x + 8 + run, y - 2.7); ctx.lineTo(x + 9.5 + run, y - 4);
    ctx.moveTo(x + 10.8, y - 1.8); ctx.arc(x + 10.8, y - 1.8, .65, 0, Math.PI * 1.6);
    ctx.moveTo(x + 10.8, y - 1.8); ctx.lineTo(x + 12.2, y - 1.8); ctx.stroke();
  } else if (action === 'robot') {
    drawFigure(ctx, x + 11, y, theme, { pose: 'sit', facing: -1, identity: null, scale: .78 });
    ctx.beginPath(); ctx.rect(x + 3, y - 6.4, 4.5, 4); ctx.moveTo(x + 5.25, y - 6.4); ctx.lineTo(x + 5.25, y - 8);
    ctx.arc(x + 4.3, y - 4.5, .3, 0, Math.PI * 2); ctx.arc(x + 6.2, y - 4.5, .3, 0, Math.PI * 2);
    ctx.moveTo(x + 7.5, y - 3); ctx.bezierCurveTo(x + 9, y - 2, x + 9, y - 7, x + 12, y - 7);
    ctx.moveTo(x + 11.2, y - 8.2); ctx.lineTo(x + 12.8, y - 8.2); ctx.stroke();
  } else if (action === 'elevator_wait') {
    ctx.beginPath(); ctx.rect(x + 3, y - 11, 6.5, 8.5); ctx.moveTo(x + 6.25, y - 11); ctx.lineTo(x + 6.25, y - 2.5); ctx.stroke();
    // Three compressed silhouettes fill the car; the active worker waits outside.
    for (const offset of [4.1, 6.2, 8.2]) drawFigure(ctx, x + offset, y - 2.1, theme, { pose: 'stand', identity: null, scale: .42, alpha: .72 });
    ctx.beginPath(); ctx.arc(x + 11.2, y - 8.3, 1, 0, Math.PI * 2); ctx.moveTo(x + 11.2, y - 7.3); ctx.lineTo(x + 11.2, y - 3); ctx.stroke();
  } else if (action === 'stickers') {
    drawFigure(ctx, x + 10.5, y, theme, { pose: 'stand', facing: -1, identity: null, scale: .82 });
    const pass = 4.8 + Math.sin(clamp(progress) * Math.PI) * 1.8;
    ctx.beginPath(); ctx.rect(x + pass, y - 8.2, 2.6, 2.6); ctx.rect(x + 7.2, y - 5.6, 2.6, 2.6);
    ctx.arc(x + pass + 1.3, y - 6.9, .4, 0, Math.PI * 2); ctx.arc(x + 8.5, y - 4.3, .4, 0, Math.PI * 2); ctx.stroke();
  } else if (action === 'photo') {
    drawFigure(ctx, x + 7.5, y, theme, { pose: 'stand', facing: -1, identity: null, scale: .78 });
    drawFigure(ctx, x + 13.2, y, theme, { pose: 'raise', facing: -1, identity: null, scale: .78 });
    ctx.beginPath(); ctx.rect(x + 20, y - 10.2, 4.5, 3.1); ctx.arc(x + 22.25, y - 8.65, 1, 0, Math.PI * 2);
    ctx.moveTo(x + 22.25, y - 7.1); ctx.lineTo(x + 20.2, y - 1.8); ctx.moveTo(x + 22.25, y - 7.1); ctx.lineTo(x + 24.4, y - 1.8); ctx.stroke();
  }
  ctx.restore();
}

/** Structured-event work vignettes. No label is painted and no tool kind is guessed. */
export function drawWorkProp(ctx, x, y, theme, action, progress = 0, facing = 1) {
  if (!action) return;
  ctx.recordAnimationCue?.('work', action, { x, y, progress });
  const p = clamp(progress);
  const bob = Math.sin(p * Math.PI * 2);
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.fillStyle = theme.stroke;
  ctx.lineWidth = .48;
  ctx.translate(x, y);
  ctx.scale(facing < 0 ? -1 : 1, 1);
  ctx.translate(-x, -y);
  ctx.beginPath();
  if (action === 'coding') {
    // Keyboard, breathing monitor and a perforated paper tape physically feeding in.
    ctx.rect(x + 1.2, y - 4.3, 6.8, 2.1);
    for (let key = 0; key < 4; key += 1) ctx.moveTo(x + 2 + key * 1.4, y - 3.9), ctx.lineTo(x + 2 + key * 1.4, y - 2.8);
    ctx.rect(x + 2.2, y - 11.2, 7.2, 5.1 + bob * .12);
    ctx.moveTo(x - 5, y - 3); ctx.bezierCurveTo(x - 2, y - 5 + bob * .3, x, y - 1.5, x + 1.2, y - 3.2);
    for (let hole = -4; hole <= 0; hole += 2) ctx.arc(x + hole, y - 3, .22, 0, Math.PI * 2);
  } else if (action === 'research') {
    // Shelf with one book pulled out, plus a folding map and rotating globe.
    ctx.rect(x + 3, y - 14, 8.5, 11.5); ctx.moveTo(x + 3, y - 9); ctx.lineTo(x + 11.5, y - 9);
    for (let book = 0; book < 4; book += 1) ctx.rect(x + 3.7 + book * 1.35, y - 13.2, 1, 3.7);
    ctx.rect(x + 8.5 + bob * .5, y - 12.8, 1.2, 5.3);
    ctx.moveTo(x - 2, y - 4.5); ctx.lineTo(x + .5, y - 6.2); ctx.lineTo(x + 3, y - 4.4); ctx.lineTo(x + .5, y - 2.7); ctx.closePath();
    ctx.arc(x - 3.3, y - 10.3, 2.1, 0, Math.PI * 2); ctx.moveTo(x - 3.3, y - 8.2); ctx.lineTo(x - 3.3, y - 5.8);
  } else if (action === 'review') {
    // An open comparison dossier on the supervisor desk, inspected with a lens.
    ctx.rect(x + .8, y - 7.3, 6.5, 4.8);
    ctx.moveTo(x + 4.05, y - 7.3); ctx.lineTo(x + 4.05, y - 2.5);
    ctx.moveTo(x + 1.8, y - 5.8); ctx.lineTo(x + 5.8, y - 5.8);
    ctx.arc(x + 7.3, y - 7.5, 2.0, 0, Math.PI * 2);
    ctx.moveTo(x + 8.8, y - 6.1); ctx.lineTo(x + 10.5, y - 4.4);
  } else if (action === 'search') {
    // Telescope on a tripod and an index-card tray; never a hidden-thought bubble.
    ctx.moveTo(x + 1, y - 10); ctx.lineTo(x + 8.5, y - 12 + bob * .25); ctx.lineTo(x + 9.5, y - 10.7); ctx.lineTo(x + 2, y - 8.7); ctx.closePath();
    ctx.arc(x + 1.3, y - 9.35, 1.4, 0, Math.PI * 2);
    ctx.moveTo(x + 5.2, y - 8.6); ctx.lineTo(x + 2.7, y - 2.2); ctx.moveTo(x + 5.2, y - 8.6); ctx.lineTo(x + 8, y - 2.2);
    ctx.rect(x - 4.8, y - 6.1, 4.5, 3.4); ctx.moveTo(x - 4, y - 4.9); ctx.lineTo(x - 1.2, y - 4.9);
  } else if (action === 'test') {
    // Bordered test track, a moving toy car and a physical finish flag.
    ctx.moveTo(x - 3, y - 2.5); ctx.quadraticCurveTo(x + 2, y - 10, x + 11, y - 3);
    ctx.moveTo(x - 2, y - 1.3); ctx.quadraticCurveTo(x + 2.5, y - 7.7, x + 10.2, y - 1.8);
    const carX = x + 3.8 + bob * 1.3; ctx.rect(carX, y - 6.4, 3.2, 1.7); ctx.arc(carX + .7, y - 4.6, .45, 0, Math.PI * 2); ctx.arc(carX + 2.5, y - 4.6, .45, 0, Math.PI * 2);
    ctx.moveTo(x + 10.7, y - 2.2); ctx.lineTo(x + 10.7, y - 9); ctx.lineTo(x + 13.4, y - 7.8); ctx.lineTo(x + 10.7, y - 6.7);
  } else if (action === 'git') {
    // A waist-high merge table with a freestanding branch tree and movable tokens.
    ctx.rect(x - 3.5, y - 5.5, 13, 3); ctx.moveTo(x - 2.7, y - 2.5); ctx.lineTo(x - 2.7, y);
    ctx.moveTo(x + 8.7, y - 2.5); ctx.lineTo(x + 8.7, y);
    ctx.moveTo(x + 1, y - 5.5); ctx.lineTo(x + 1, y - 13); ctx.lineTo(x + 5, y - 15);
    ctx.moveTo(x + 1, y - 10); ctx.lineTo(x + 5, y - 8); ctx.lineTo(x + 7.2, y - 10);
    for (const [dx, dy] of [[1,-13],[5,-15],[5,-8],[7.2,-10]]) ctx.arc(x + dx, y + dy, .65, 0, Math.PI * 2);
  } else if (action === 'merge_conflict') {
    // Two visibly different hatch-pattern paper halves are aligned on the merge table.
    ctx.rect(x - 3.5, y - 5.2, 13, 3); ctx.moveTo(x - 2.7, y - 2.2); ctx.lineTo(x - 2.7, y);
    ctx.moveTo(x + 8.7, y - 2.2); ctx.lineTo(x + 8.7, y);
    const gap = 1.3 + Math.abs(bob) * .8;
    ctx.rect(x - gap - 4.3, y - 10, 4.3, 4.5); ctx.rect(x + gap, y - 10, 4.3, 4.5);
    for (let stripe = 0; stripe < 3; stripe += 1) {
      ctx.moveTo(x - gap - 3.8, y - 9.2 + stripe); ctx.lineTo(x - gap - .6, y - 9.2 + stripe);
      ctx.moveTo(x + gap + .7 + stripe, y - 9.6); ctx.lineTo(x + gap + .2 + stripe, y - 6.2);
    }
    ctx.moveTo(x - gap, y - 7.8); ctx.lineTo(x + gap, y - 7.8);
  } else if (action === 'build') {
    // Workshop bench: loose parts are assembled, checked by a gear, then boxed.
    ctx.rect(x - 3.5, y - 5.5, 13, 3.2); ctx.moveTo(x - 2.6, y - 2.3); ctx.lineTo(x - 2.6, y);
    ctx.moveTo(x + 8.5, y - 2.3); ctx.lineTo(x + 8.5, y);
    ctx.rect(x - 2, y - 10, 4.2, 3.7); ctx.moveTo(x - 2, y - 10); ctx.lineTo(x + .1, y - 12); ctx.lineTo(x + 2.2, y - 10);
    ctx.arc(x + 6.2, y - 8.1, 2 + Math.abs(bob) * .3, 0, Math.PI * 2);
    for (let spoke = 0; spoke < 4; spoke += 1) {
      const a = spoke * Math.PI / 2 + p; ctx.moveTo(x + 6.2, y - 8.1); ctx.lineTo(x + 6.2 + Math.cos(a) * 3, y - 8.1 + Math.sin(a) * 3);
    }
  } else if (action === 'document') {
    // A printer mouth feeds a wavy sheet while a separate output stack grows.
    ctx.rect(x - 2, y - 10.5, 10, 7); ctx.rect(x, y - 13.8, 6, 3.5);
    ctx.moveTo(x + 1, y - 5.2); ctx.bezierCurveTo(x + 3, y - 7 + bob * .3, x + 5, y - 4, x + 7, y - 5.6);
    for (let i = 0; i < 3; i += 1) ctx.rect(x + 9 + i * .55, y - 6 - i * .55, 6, 3.5);
  } else if (action === 'context') {
    // Loose sheets visibly fold into a thin ring binder beside the archive shelf.
    for (let i = 0; i < 3; i += 1) ctx.rect(x - 4 + i * (2 + bob * .15), y - 9 - i * .8, 4.5, 4);
    ctx.rect(x + 4, y - 10.5, 5.2, 7.2); ctx.moveTo(x + 5, y - 10); ctx.lineTo(x + 5, y - 3.8);
    ctx.arc(x + 5.7, y - 8.8, .4, 0, Math.PI * 2); ctx.arc(x + 5.7, y - 5.1, .4, 0, Math.PI * 2);
  } else if (action === 'night') {
    // A headlamp is attached to the actor; its cone lands on the live keyboard.
    ctx.arc(x, y - 13.2, 1.5, Math.PI, Math.PI * 2); ctx.arc(x + 1.4, y - 13.2, .6, 0, Math.PI * 2);
    ctx.moveTo(x + 2, y - 13.1); ctx.lineTo(x + 9, y - 6 + bob * .2); ctx.lineTo(x + 3.2, y - 5.1); ctx.closePath();
    ctx.rect(x + 1.2, y - 4.3, 7, 2.1); ctx.arc(x + 11, y - 14, 2, .55, Math.PI * 1.7);
  } else if (action === 'external_wait') {
    // Telephone receiver, cord and an adjacent wall clock.
    ctx.arc(x + 8, y - 10, 3, 0, Math.PI * 2); ctx.moveTo(x + 8, y - 10); ctx.lineTo(x + 8 + bob, y - 12);
    ctx.moveTo(x + 8, y - 10); ctx.lineTo(x + 10, y - 9);
    ctx.moveTo(x - 1, y - 7); ctx.quadraticCurveTo(x + 2, y - 10, x + 5, y - 7);
    ctx.moveTo(x - 1, y - 7); ctx.lineTo(x, y - 5.2); ctx.moveTo(x + 5, y - 7); ctx.lineTo(x + 4, y - 5.2);
    ctx.bezierCurveTo(x + 4, y - 3, x + 8, y - 4, x + 8, y - 7);
  } else if (action === 'rate_limit') {
    // Freestanding charging pedestal with a cable plugged into the waiting worker.
    ctx.rect(x + 5, y - 12, 5.8, 9); ctx.rect(x + 6.2, y - 10.2, 3.4, 4.5);
    ctx.moveTo(x + 10.8, y - 6); ctx.bezierCurveTo(x + 13, y - 4, x + 10, y - 1.5, x + 3, y - 5.8);
    ctx.moveTo(x + 2.2, y - 6.8); ctx.lineTo(x + 3.8, y - 6.8);
  } else if (action === 'whiteboard') {
    // Sticky cards are placed on the real wall board; travelPose supplies the step back.
    ctx.rect(x - 2.5, y - 14, 13, 8); ctx.rect(x - 1, y - 12.5, 2.3, 1.8); ctx.rect(x + 2.2, y - 10, 2.3, 1.8);
    ctx.rect(x + 5.6, y - 12.4, 2.3, 1.8); ctx.moveTo(x + .2, y - 7.2); ctx.lineTo(x + 6.5, y - 7.2);
  } else if (action === 'crash') {
    // Explicit crash only: flickering monitor, open toolbox, and a standing repair pose.
    ctx.rect(x + 1, y - 12, 8, 5.5); ctx.moveTo(x + 2, y - 10.5); ctx.lineTo(x + 8, y - 8 + bob * .7);
    ctx.rect(x + 9.8, y - 6.2, 7, 3.8); ctx.moveTo(x + 11.5, y - 6.2); ctx.quadraticCurveTo(x + 13.3, y - 9, x + 15, y - 6.2);
    for (const offset of [0, 2.2, 4.4]) {
      ctx.moveTo(x + 2 + offset, y - 14 - Math.abs(bob)); ctx.lineTo(x + 3 + offset, y - 16 - Math.abs(bob));
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawOwnerRequest(ctx, room, project, theme, cue, time) {
  const identity = IDENTITY[cue.event.provider] || null;
  const progress = clamp(cue.progress);
  const stage = ownerRequestStage(progress);
  ctx.recordAnimationCue?.('signature', 'owner-request', { room, progress: cue.progress, stage });
  if (room !== 'owner') {
    const [sx, sy] = project(5.3, 6.8);
    const [tx, ty] = project(PLATE.gridWidth - .35, 4.2);
    const local = ease(clamp(progress / .58));
    drawFigure(ctx, sx + (tx - sx) * local, sy + (ty - sy) * local, theme, {
      pose: 'walk', carry: true, swing: Math.sin(time / 115) * .55,
      facing: 1, identity, alpha: 1 - clamp((progress - .5) / .1)
    });
    return;
  }

  const [doorX, doorY] = project(7.4, PLATE.gridDepth - .7);
  const [queueX, queueY] = project(7.2, 6.2);
  // Knock at the doorway. Only after all three knocks does the requester walk from the
  // door to a waiting chair; the former interpolation made them knock mid-corridor.
  const queueWalk = stage === 'request_queue' ? ease(clamp((progress - .78) / .18)) : 0;
  const x = doorX + (queueX - doorX) * queueWalk;
  const y = doorY + (queueY - doorY) * queueWalk;
  drawFigure(ctx, x, y, theme, {
    pose: stage === 'request_queue' && queueWalk < 1 ? 'walk' : 'stand',
    carry: progress < .78,
    swing: Math.sin(time / 115) * .5,
    facing: -1,
    identity,
    alpha: clamp((progress - .42) / .08)
  });
  if (stage === 'three_knocks') {
    const local = clamp((progress - .58) / .2);
    const knock = Math.min(3, Math.floor(local * 3) + 1);
    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = .65;
    for (let index = 0; index < knock; index += 1) {
      ctx.beginPath();
      ctx.arc(x - 3.8 - index * 1.5, y - 10 - index * .7, 1 + index * .25, -1.1, 1.1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawAuthorityHandoff(ctx, room, project, theme, cue, time, layout) {
  ctx.recordAnimationCue?.('signature', 'authority', { room, progress: cue.progress });
  const sourceIdentity = IDENTITY[cue.event.provider] || null;
  const targetIdentity = IDENTITY[cue.event.targetProvider || cue.event.provider] || null;
  const progress = ease(clamp(cue.progress));
  const manager = layout?.manager || { gx: 2.35, gy: 8.1 };
  const worker = cueSeatPoints(layout)[0] || { gx: 5.9, gy: 5.9 };
  const source = room === 'owner' ? { gx: manager.gx + 1.0, gy: manager.gy - .25 } : manager;
  const target = room === 'owner' ? { gx: 5.1, gy: 6.1 } : worker;
  const [sourceX, sourceY] = project(source.gx, source.gy);
  const [targetX, targetY] = project(target.gx, target.gy);
  const cardX = sourceX + (targetX - sourceX) * progress;
  const cardY = sourceY + (targetY - sourceY) * progress - 8;
  // Owner remains at the permanent first-floor desk. On execution floors this is a
  // strictly local lead-to-recipient transfer, never a duplicate Owner apparition.
  if (room !== 'owner') drawFigure(ctx, sourceX, sourceY, theme, { pose: 'stand', facing: 1, identity: sourceIdentity, alpha: 1 });
  drawFigure(ctx, targetX, targetY, theme, { pose: 'stand', facing: -1, identity: targetIdentity, alpha: 1 });
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.fillStyle = theme.stroke;
  ctx.lineWidth = .8;
  ctx.strokeRect(cardX - 4.2, cardY - 2.8, 8.4, 5.6);
  ctx.beginPath();
  ctx.moveTo(cardX - 2.3, cardY);
  ctx.lineTo(cardX - .4, cardY + 1.8);
  ctx.lineTo(cardX + 2.8, cardY - 1.7);
  // A physical authorization key travels with the card; it is an icon, never a label.
  ctx.arc(cardX - 5.8, cardY, 1.5, 0, Math.PI * 2);
  ctx.moveTo(cardX - 4.3, cardY); ctx.lineTo(cardX - .8, cardY);
  ctx.moveTo(cardX - 1.8, cardY); ctx.lineTo(cardX - 1.8, cardY + 1.6);
  ctx.stroke();
  ctx.restore();
  void time;
}

// A same-session Owner reply is a real observed action, but is not automatically an
// authority grant.  Show the reply card travelling to the known live worker without
// introducing an unobserved recipient or a second Owner.
function drawOwnerResponse(ctx, room, project, theme, cue, time, layout) {
  ctx.recordAnimationCue?.('signature', 'owner-response', { room, progress: cue.progress });
  const progress = ease(clamp(cue.progress));
  const ownerDesk = cuePoint(project, layout?.manager, { gx: 2.35, gy: 8.1 });
  const workerSeat = cuePoint(project, cueSeatPoints(layout)[0], { gx: 5.6, gy: 5.7 });
  const source = room === 'owner' ? ownerDesk : cuePoint(project, layout?.walkway, { gx: 5.5, gy: 9.2 });
  const target = room === 'owner' ? cuePoint(project, layout?.walkway, { gx: 5.5, gy: 9.2 }) : workerSeat;
  const cardX = source[0] + (target[0] - source[0]) * progress;
  const cardY = source[1] + (target[1] - source[1]) * progress - 7;
  if (room !== 'owner') {
    drawFigure(ctx, target[0], target[1], theme, {
      pose: progress > .78 ? 'stand' : 'sit',
      facing: -1,
      identity: IDENTITY[cue.event.provider]
    });
  }
  drawFolder(ctx, cardX, cardY, theme, null, { stamp: true });
  void time;
}

/**
 * Signature J, Owner side: finished work is reported in person. The courier comes in from
 * the walkway, stands at the Owner's desk long enough to hand the delivery over, then
 * walks back out. Owner rule (2026-08-11): AI go to the Owner to report, not the reverse.
 */
function drawOwnerReport(ctx, project, theme, cue, time, layout, supervisorProvider = null) {
  ctx.recordAnimationCue?.('signature', 'owner-report', { progress: cue.progress });
  const identity = IDENTITY[supervisorProvider || cue.event.provider] || null;
  // Straight up the open front aisle: the waiting chairs sit at gx 7 and 8.8, so the
  // courier keeps to gx 6.3 and never walks through one.
  const [doorX, doorY] = project(6.3, PLATE.gridDepth - 1.2);
  const ownerSpot = layout?.manager || { gx: 2.8, gy: 6.35 };
  const [spotX, spotY] = project(ownerSpot.gx + 1.2, ownerSpot.gy - .45);
  // The Owner-side visitor only appears after the worker handed the result to the lead
  // and the lead reached the lift. Both floors therefore show one causal chain.
  const rawProgress = clamp(cue.progress);
  const progress = clamp((rawProgress - .72) / .28);
  const arriving = progress < .3;
  const leaving = progress > .7;
  const walk = arriving ? ease(progress / .3) : leaving ? 1 - ease((progress - .7) / .3) : 1;
  const x = doorX + (spotX - doorX) * walk;
  const y = doorY + (spotY - doorY) * walk;

  // The delivery lands on the Owner's desk the moment the report starts.
  if (!arriving) {
    const [boxX, boxY] = project(ownerSpot.gx, ownerSpot.gy - .72, 1.2);
    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = .55;
    ctx.beginPath();
    ctx.rect(boxX - 3, boxY - 3.4, 6, 3.4);
    ctx.stroke();
    ctx.restore();
  }
  drawFigure(ctx, x, y, theme, {
    pose: arriving || leaving ? 'walk' : 'stand',
    carry: arriving,
    swing: arriving || leaving ? Math.sin(time / 120) * .55 : 0,
    lean: arriving || leaving ? 0 : .6 + Math.sin(time / 260) * .35,
    facing: leaving ? 1 : -1,
    identity,
    alpha: clamp((rawProgress - .7) / .06) * (leaving ? Math.max(.15, 1 - ease((progress - .82) / .18)) : 1)
  });
}

/** Signature J, team side: the worker leaves the floor for the lift, delivery in hand. */
function drawDeliveryRun(ctx, project, theme, cue, time, layout, deliveryHome, courierHome, supervisorProvider = null) {
  const workerIdentity = IDENTITY[cue.event.provider] || null;
  const supervisorIdentity = IDENTITY[supervisorProvider || cue.event.provider] || null;
  const progress = clamp(cue.progress);
  const stage = completionStage(progress);
  ctx.recordAnimationCue?.('signature', 'delivery-stage', { stage, progress });
  const leadHome = deliveryHome || layout?.manager || { gx: 2.55, gy: 8.35, facing: -1 };
  const workerHome = courierHome || layout?.staffSeats?.[0]
    ? { gx: courierHome?.gx ?? layout.staffSeats[0][0], gy: courierHome?.gy ?? layout.staffSeats[0][1] }
    : leadHome;
  const [workerX, workerY] = project(workerHome.gx, workerHome.gy);
  const [leadX, leadY] = project(leadHome.gx, leadHome.gy);
  const [liftX, liftY] = project(PLATE.gridWidth - .4, 4.2);
  if (progress >= .9) {
    const local = ease((progress - .9) / .1);
    drawFigure(ctx, liftX + (leadX - liftX) * local, liftY + (leadY - liftY) * local, theme, {
      pose: local < .92 ? 'walk' : 'sit',
      carry: false,
      swing: Math.sin(time / 120) * .55,
      facing: deliveryReturnFacing(leadHome, local),
      identity: supervisorIdentity,
      alpha: clamp((progress - .9) / .025)
    });
    return;
  }
  let x = workerX;
  let y = workerY;
  let identity = workerIdentity;
  if (stage === 'worker_to_lead') {
    const local = ease(progress / .3);
    x += (leadX + 5 - workerX) * local;
    y += (leadY - workerY) * local;
  } else if (stage === 'lead_accepts') {
    x = leadX + 5; y = leadY;
    drawFigure(ctx, leadX, leadY, theme, { pose: 'stand', facing: 1, identity: supervisorIdentity, alpha: 1 });
  } else {
    const local = ease(clamp((progress - .48) / .24));
    x = leadX + (liftX - leadX) * local;
    y = leadY + (liftY - leadY) * local;
    identity = supervisorIdentity;
  }
  drawFigure(ctx, x, y, theme, {
    pose: stage === 'lead_accepts' ? 'stand' : 'walk',
    carry: true,
    swing: Math.sin(time / 120) * .55,
    facing: 1,
    identity,
    alpha: 1 - clamp((progress - .72) / .12)
  });
}

function drawFolder(ctx, x, y, theme, color = null, { stamp = false, ribbon = false, toolbox = false } = {}) {
  ctx.save();
  ctx.strokeStyle = color || theme.stroke;
  ctx.lineWidth = .65;
  ctx.beginPath();
  ctx.rect(x - 3.6, y - 2.5, 7.2, 5);
  if (toolbox) {
    ctx.moveTo(x - 1.7, y - 2.5);
    ctx.quadraticCurveTo(x, y - 5, x + 1.7, y - 2.5);
  }
  if (stamp) ctx.arc(x, y, 1.45, 0, Math.PI * 2);
  if (ribbon) {
    ctx.moveTo(x - 1, y + 2.5); ctx.lineTo(x - 2.2, y + 5.2);
    ctx.moveTo(x + 1, y + 2.5); ctx.lineTo(x + 2.2, y + 5.2);
  }
  ctx.stroke();
  ctx.restore();
}

function cuePoint(project, point, fallback) {
  const value = point || fallback;
  return project(value.gx, value.gy);
}

function cueSeatPoints(layout) {
  const raw = layout?.staffSeats?.length
    ? layout.staffSeats.map(([gx, gy]) => ({ gx, gy }))
    : (layout?.seats || []).filter((seat) => !seat.role || seat.role === 'meeting');
  return raw.slice(0, 6);
}

function drawArrival(ctx, project, theme, cue, time, layout) {
  const progress = ease(clamp(cue.progress));
  const door = cuePoint(project, layout?.walkway, { gx: 5.5, gy: 9.2 });
  const manager = cuePoint(project, layout?.manager, { gx: 2.35, gy: 8.1 });
  const target = [manager[0] + 7, manager[1]];
  drawFigure(ctx, manager[0], manager[1], theme, { pose: 'sit', facing: -1, identity: IDENTITY[cue.event.provider] });
  // The manager presses a physical desk bell before the lift doors open.
  ctx.save(); ctx.strokeStyle = theme.stroke; ctx.lineWidth = .55; ctx.beginPath();
  ctx.arc(manager[0] + 4.2, manager[1] - 6.4, 1.8, Math.PI, Math.PI * 2);
  ctx.moveTo(manager[0] + 1.8, manager[1] - 4.6); ctx.lineTo(manager[0] + 6.6, manager[1] - 4.6);
  ctx.moveTo(manager[0] + 4.2, manager[1] - 8.2); ctx.lineTo(manager[0] + 4.2, manager[1] - 9.2); ctx.stroke(); ctx.restore();
  if (progress < .18) {
    ctx.save();
    ctx.strokeStyle = theme.stroke; ctx.lineWidth = .55;
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath(); ctx.arc(manager[0] + 5 + i * 1.6, manager[1] - 9 - i, 1.2 + i * .2, -1.1, 1.1); ctx.stroke();
    }
    ctx.restore();
  }
  const local = ease(clamp((progress - .08) / .72));
  const x = door[0] + (target[0] - door[0]) * local;
  const y = door[1] + (target[1] - door[1]) * local;
  drawFigure(ctx, x, y, theme, { pose: local < .92 ? 'walk' : 'stand', carry: progress < .76, swing: Math.sin(time / 120) * .55, facing: -1, identity: IDENTITY[cue.event.provider] });
  if (progress >= .72) drawFolder(ctx, manager[0] + 4, manager[1] - 8, theme);
}

// A direct collaboration dispatch is a real command.  It animates the known live
// sender placing a packet into the dispatch route, but never creates a recipient.
function drawDelegationRequest(ctx, project, theme, cue, time, layout) {
  const progress = ease(clamp(cue.progress));
  const manager = cuePoint(project, layout?.manager, { gx: 2.35, gy: 8.1 });
  const door = cuePoint(project, layout?.walkway, { gx: 5.5, gy: 9.2 });
  const local = ease(clamp((progress - .08) / .8));
  const x = manager[0] + (door[0] - manager[0]) * local;
  const y = manager[1] + (door[1] - manager[1]) * local - Math.sin(local * Math.PI) * 7;
  ctx.recordAnimationCue?.('signature', 'delegation-request', { progress: cue.progress });
  const workerLocal = ease(clamp((progress - .02) / .78));
  drawFigure(ctx,
    manager[0] + (door[0] - manager[0]) * workerLocal * .34,
    manager[1] + (door[1] - manager[1]) * workerLocal * .34,
    theme,
    { pose: workerLocal < .86 ? 'walk' : 'stand', carry: true, swing: Math.sin(time / 120) * .45, facing: 1, identity: IDENTITY[cue.event.provider] }
  );
  drawFolder(ctx, x, y, theme, null, { toolbox: true });
  ctx.save();
  ctx.strokeStyle = theme.soft;
  ctx.lineWidth = .5;
  ctx.globalAlpha *= .42 + .35 * Math.sin(time / 160) ** 2;
  for (let index = 0; index < 2; index += 1) {
    ctx.beginPath();
    ctx.arc(x - 5 - index * 2.1, y + 1.6, 1 + index * .25, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// A sent collaboration message is a real communication action.  Its sender can make
// the C beat, while the receiver/meeting roster remains deliberately absent.
function drawCoordinationMessage(ctx, project, theme, cue, time, layout) {
  const progress = ease(clamp(cue.progress));
  const manager = cuePoint(project, layout?.manager, { gx: 2.35, gy: 8.1 });
  const targetSeat = cueSeatPoints(layout)[0] || { gx: 5.2, gy: 5.4 };
  const target = project(targetSeat.gx, targetSeat.gy);
  const local = ease(clamp((progress - .1) / .72));
  const x = manager[0] + (target[0] - manager[0]) * local;
  const y = manager[1] + (target[1] - manager[1]) * local - Math.sin(local * Math.PI) * 5;
  ctx.recordAnimationCue?.('signature', 'coordination-message', { progress: cue.progress });
  drawFigure(ctx, manager[0], manager[1], theme, {
    pose: progress < .7 ? 'stand' : 'sit', carry: progress < .62,
    lean: Math.sin(time / 180) * .15, facing: 1, identity: IDENTITY[cue.event.provider]
  });
  ctx.save();
  ctx.strokeStyle = theme.soft;
  ctx.lineWidth = .45;
  ctx.globalAlpha *= .48;
  ctx.beginPath();
  ctx.moveTo(manager[0], manager[1] - 4);
  ctx.quadraticCurveTo((manager[0] + target[0]) / 2, Math.min(manager[1], target[1]) - 13, target[0], target[1] - 4);
  ctx.stroke();
  ctx.restore();
  drawFolder(ctx, x, y, theme);
}

// patch_apply_end is a real revision action.  It earns the E beat, while still not
// claiming an external review request, pass, or delivery.
function drawPatchApplyEnded(ctx, project, theme, cue, time, layout) {
  const progress = ease(clamp(cue.progress));
  const manager = cuePoint(project, layout?.manager, { gx: 2.35, gy: 8.1 });
  const drop = ease(clamp((progress - .08) / .5));
  const x = manager[0] + 4.2;
  const y = manager[1] - 18 + 10 * drop;
  ctx.recordAnimationCue?.('signature', 'patch-apply-ended', { progress: cue.progress });
  drawFigure(ctx, manager[0] - 1.5, manager[1] + 1.8, theme, {
    pose: progress < .72 ? 'sit' : 'stand', carry: progress < .58,
    lean: Math.sin(time / 150) * .12, facing: 1, identity: IDENTITY[cue.event.provider]
  });
  drawFolder(ctx, x, y, theme, null, { toolbox: true });
  ctx.save();
  ctx.strokeStyle = theme.soft;
  ctx.lineWidth = .45;
  ctx.globalAlpha *= clamp((progress - .45) / .25);
  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    ctx.moveTo(x - 4.3 + index * 1.5, manager[1] - 4.2);
    ctx.lineTo(x - 3.6 + index * 1.5, manager[1] - 2.3);
    ctx.stroke();
  }
  ctx.restore();
  void time;
}

function drawLeadHandoff(ctx, project, theme, cue, time, layout) {
  const progress = ease(clamp(cue.progress));
  const manager = cuePoint(project, layout?.manager, { gx: 2.35, gy: 8.1 });
  const otherSeat = cueSeatPoints(layout)[0] || { gx: 4.4, gy: 6.2 };
  const other = project(otherSeat.gx, otherSeat.gy);
  const a = [manager[0] + (other[0] - manager[0]) * .38, manager[1] + (other[1] - manager[1]) * .38];
  const b = [manager[0] + (other[0] - manager[0]) * .68, manager[1] + (other[1] - manager[1]) * .68];
  drawFigure(ctx, a[0], a[1], theme, { pose: 'stand', facing: 1, lean: Math.sin(time / 260) * .2, identity: IDENTITY[cue.event.provider] });
  const hasObservedRecipient = Boolean(cue.event.targetProvider && cue.event.targetProvider !== 'other');
  if (hasObservedRecipient) {
    drawFigure(ctx, b[0], b[1], theme, { pose: 'stand', facing: -1, lean: -Math.sin(time / 260) * .2, identity: IDENTITY[cue.event.targetProvider] });
  }
  const pass = progress < .7 ? ease(progress / .7) : 1;
  drawFolder(ctx, a[0] + (b[0] - a[0]) * pass, a[1] + (b[1] - a[1]) * pass - 8, theme);
  const lightX = a[0] + (b[0] - a[0]) * pass;
  ctx.save(); ctx.strokeStyle = theme.soft; ctx.globalAlpha = .45 + .35 * Math.sin(time / 180) ** 2;
  ctx.beginPath(); ctx.arc(lightX, a[1] - 15, 2.2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}

function drawDiscussionTravel(ctx, project, theme, cue, time, layout, returning = false) {
  const recordedParticipants = Array.isArray(cue.event.participantProviders)
    ? orderedDiscussionProviders(cue.event.participantProviders, cue.event.chairProvider)
    : [];
  // The command issuer is a real, known participant when a direct
  // `discussion_started` command has no retained roster.  Do not add anyone else.
  const participants = recordedParticipants.length ? recordedParticipants : [cue.event.provider].filter((provider) => IDENTITY[provider]);
  const seats = (layout?.seats || []).filter((seat) => seat.role === 'meeting').slice(0, participants.length);
  if (!seats.length) return;
  const door = layout?.walkway || { gx: 5.55, gy: 9.15 };
  const overall = ease(clamp(cue.progress));
  for (const [index, seat] of seats.entries()) {
    ctx.recordAnimationCue?.('discussion-participant', participants[index], { returning, index });
    const stagger = clamp(overall * 1.45 - index * .12);
    const local = returning ? 1 - stagger : stagger;
    const xg = door.gx + (seat.gx - door.gx) * local;
    const yg = door.gy + (seat.gy - door.gy) * local;
    const [x, y] = project(xg, yg);
    drawFigure(ctx, x, y, theme, {
      pose: stagger < .92 ? 'walk' : 'sit', swing: Math.sin(time / 115 + index) * .5,
      facing: returning ? 1 : -1, identity: IDENTITY[participants[index]],
      carry: !returning && index === 0
    });
  }
  if (!returning && overall > .58) {
    const table = layout.items.find((item) => item.kind === 'meeting');
    if (table) drawDiscussionProp(ctx, project, theme, table, cue.event.visualKind || 'evidence', overall, time);
  }
}

function drawDiscussionProp(ctx, project, theme, table, kind, progress, time) {
  const [x, y] = project(table.gx, table.gy, .82);
  const pulse = Math.sin(time / 220) * .5;
  ctx.save(); ctx.strokeStyle = theme.stroke; ctx.lineWidth = .5; ctx.globalAlpha *= clamp((progress - .58) / .2);
  ctx.beginPath();
  if (kind === 'support' || kind === 'risk') {
    ctx.rect(x - 5, y - 4 + pulse, 4, 3); ctx.rect(x + 1, y - 3 - pulse, 4, 3);
  } else if (kind === 'idea') {
    ctx.arc(x, y - 5, 2.3, 0, Math.PI * 2); ctx.moveTo(x - 1.4, y - 2.2); ctx.lineTo(x + 1.4, y - 2.2);
  } else if (kind === 'no_consensus') {
    ctx.rect(x - 6, y - 4, 4.5, 4.5); ctx.rect(x + 1.5 + Math.abs(pulse) * 2, y - 4, 4.5, 4.5);
  } else if (kind === 'consensus' || kind === 'reconsider') {
    const gap = kind === 'reconsider' ? 2 + Math.abs(pulse) * 2 : 0;
    ctx.rect(x - 6 - gap, y - 4, 5.5, 5); ctx.rect(x + .5 + gap, y - 4, 5.5, 5);
    ctx.moveTo(x - .5 - gap, y - 1.5); ctx.lineTo(x + .5 + gap, y - 1.5);
  } else {
    ctx.rect(x - 4.5, y - 4, 9, 5.5); ctx.moveTo(x - 3, y - 2.3); ctx.lineTo(x + 3, y - 2.3);
  }
  ctx.stroke(); ctx.restore();
}

function drawReviewBeat(ctx, project, theme, cue, time, layout, approved) {
  const progress = ease(clamp(cue.progress));
  const worker = cueSeatPoints(layout)[0] || { gx: 5.4, gy: 4.8 };
  const manager = layout?.manager || { gx: 2.35, gy: 8.1 };
  const local = progress < .55 ? ease(progress / .55) : progress > .78 ? 1 - ease((progress - .78) / .22) : 1;
  const gx = worker.gx + (manager.gx - worker.gx) * local;
  const gy = worker.gy + (manager.gy - worker.gy) * local;
  const [x, y] = project(gx, gy);
  drawFigure(ctx, x, y, theme, { pose: local > .96 ? 'stand' : 'walk', carry: progress < .62, swing: Math.sin(time / 120) * .5, facing: local > .5 ? 1 : -1, identity: IDENTITY[cue.event.provider] });
  const [mx, my] = project(manager.gx, manager.gy);
  drawFigure(ctx, mx, my, theme, { pose: 'sit', facing: -1, identity: IDENTITY[cue.event.provider] });
  if (progress > .45) drawFolder(ctx, mx + 5, my - 8, theme, null, { stamp: true, ribbon: approved });
}

function drawErrorBeat(ctx, project, theme, cue, time, layout) {
  const worker = cueSeatPoints(layout)[0] || { gx: 5.4, gy: 4.8 };
  const manager = layout?.manager || { gx: 2.35, gy: 8.1 };
  const local = ease(clamp(cue.progress * 1.35));
  const [x, y] = project(worker.gx + (manager.gx - worker.gx) * local, worker.gy + (manager.gy - worker.gy) * local);
  drawFigure(ctx, x, y, theme, { pose: local < .9 ? 'walk' : 'stand', carry: true, swing: Math.sin(time / 100) * .55, facing: 1, identity: IDENTITY[cue.event.provider] });
  drawFolder(ctx, x + 3, y - 8, theme, null, { toolbox: true });
  const [px, py] = project(worker.gx, worker.gy - .5);
  ctx.save(); ctx.strokeStyle = theme.stroke; ctx.lineWidth = .55;
  const bugY = py - 5 - Math.abs(Math.sin(time / 120)) * 2;
  ctx.beginPath(); ctx.ellipse(px, bugY, 1.5, 1, 0, 0, Math.PI * 2);
  for (const offset of [-1, 0, 1]) {
    ctx.moveTo(px - .8, bugY + offset * .6); ctx.lineTo(px - 2.3, bugY + offset * .9);
    ctx.moveTo(px + .8, bugY + offset * .6); ctx.lineTo(px + 2.3, bugY + offset * .9);
  }
  if (cue.progress > .45) {
    ctx.arc(px, bugY + .8, 4, Math.PI, 0); ctx.moveTo(px - 4, bugY + .8); ctx.lineTo(px - 4, bugY + 4.8);
    ctx.lineTo(px + 4, bugY + 4.8); ctx.lineTo(px + 4, bugY + .8);
  }
  ctx.stroke(); ctx.restore();
}

function multiDeliveryManager(layout, occupants, event) {
  if (layout?.design !== 'first-floor') return layout?.manager || { gx: 2.35, gy: 8.1 };
  const projectLead = assignSeats(layout, occupants)
    .find((entry) => !entry.person.hidden && isCueMainPerson(entry.person, event));
  return projectLead
    ? { gx: projectLead.gx, gy: projectLead.gy }
    : (layout?.manager || { gx: 2.35, gy: 8.1 });
}

function drawMultiDelivery(ctx, project, theme, cue, time, layout, occupants = []) {
  const manager = multiDeliveryManager(layout, occupants, cue.event);
  ctx.recordAnimationCue?.('signature', 'multi-delivery', {
    roomDesign: layout?.design || null,
    manager: { ...manager },
    progress: cue.progress
  });
  const sessionId = String(cue.event.sessionId || '');
  const projectWorkers = assignSeats(layout, occupants)
    .filter((entry) => !entry.person.hidden
      && entry.person.provider !== 'owner'
      && !isCueMainPerson(entry.person, cue.event)
      && (!sessionId || String(entry.person.sessionId || '').endsWith(`:${sessionId}`)))
    .map((entry) => ({ gx: entry.gx, gy: entry.gy }));
  const seats = (projectWorkers.length ? projectWorkers : cueSeatPoints(layout)).slice(0, 3);
  for (const [index, seat] of seats.entries()) {
    const local = ease(clamp(cue.progress * 1.45 - index * .16));
    const queue = { gx: manager.gx + .7 + index * .42, gy: manager.gy - .12 + index * .34 };
    const collision = index < 2 && cue.progress >= .28 && cue.progress < .48;
    const recoil = collision ? Math.sin((cue.progress - .28) / .2 * Math.PI) * (index === 0 ? -.35 : .35) : 0;
    const [x, y] = project(seat.gx + (queue.gx - seat.gx) * local + recoil, seat.gy + (queue.gy - seat.gy) * local);
    drawFigure(ctx, x, y, theme, { pose: local < .92 ? 'walk' : 'stand', carry: true, swing: Math.sin(time / 105 + index) * .55, facing: 1, identity: IDENTITY[cue.event.provider] });
  }
  if (cue.progress >= .28 && cue.progress < .48 && seats.length >= 2) {
    const [cx, cy] = project(manager.gx + 1.15, manager.gy - .65);
    ctx.save(); ctx.strokeStyle = theme.stroke; ctx.lineWidth = .55; ctx.beginPath();
    for (let ray = 0; ray < 5; ray += 1) {
      const angle = ray * Math.PI * 2 / 5;
      ctx.moveTo(cx + Math.cos(angle) * 2, cy + Math.sin(angle) * 2);
      ctx.lineTo(cx + Math.cos(angle) * 4, cy + Math.sin(angle) * 4);
    }
    ctx.stroke(); ctx.restore();
  }
}

function drawCancelledBeat(ctx, project, theme, cue, time, layout) {
  const seat = cueSeatPoints(layout)[0] || { gx: 5.2, gy: 4.5 };
  const door = layout?.walkway || { gx: 5.55, gy: 9.15 };
  const progress = ease(clamp(cue.progress));
  const local = ease(clamp((progress - .28) / .72));
  const [x, y] = project(seat.gx + (door.gx - seat.gx) * local, seat.gy + (door.gy - seat.gy) * local);
  drawFigure(ctx, x, y, theme, { pose: local < .92 ? 'walk' : 'stand', carry: progress < .28, swing: Math.sin(time / 110) * .5, facing: 1, identity: IDENTITY[cue.event.provider], alpha: 1 - clamp((progress - .9) / .1) });
  const [mx, my] = cuePoint(project, layout?.manager, { gx: 2.35, gy: 8.1 });
  drawFigure(ctx, mx, my, theme, { pose: 'stand', carry: progress >= .28, facing: 1, identity: IDENTITY[cue.event.provider] });
  if (progress >= .2 && progress < .4) drawFolder(ctx, x + (mx - x) * ((progress - .2) / .2), y + (my - y) * ((progress - .2) / .2) - 8, theme);
}

function drawClosingProject(ctx, room, project, theme, cue, time, layout, occupants) {
  ctx.recordAnimationCue?.('closure', cue.kind, { room, progress: cue.progress });
  if (room === 'owner') {
    if (cue.kind === 'closing_report') {
      drawOwnerReport(ctx, project, theme, { ...cue, progress: .72 + clamp(cue.progress) * .28 }, time, layout, cue.event.provider);
      return;
    }
    // A first-floor project with no delivery evidence leaves quietly; Owner remains at
    // the permanent desk and receives no invented report or delivery box.
    const sessionId = String(cue.event.sessionId || '');
    const projectPeople = occupants.filter((person) => person.provider !== 'owner'
      && (!sessionId || String(person.sessionId || '').endsWith(`:${sessionId}`)));
    const placements = assignSeats(layout, projectPeople);
    const door = layout?.walkway || { gx: 5.55, gy: 9.15 };
    for (const [index, placement] of placements.entries()) {
      const local = ease(clamp(cue.progress * 1.35 - index * .08));
      const [x, y] = project(placement.gx + (door.gx - placement.gx) * local, placement.gy + (door.gy - placement.gy) * local);
      drawFigure(ctx, x, y, theme, { pose: local < .94 ? 'walk' : 'stand', carry: false, swing: Math.sin(time / 105 + index) * .55, facing: 1, identity: IDENTITY[placement.person.provider], alpha: 1 - clamp((cue.progress - .88) / .12) });
    }
    return;
  }
  const placements = assignSeats(layout, occupants).filter((entry) => entry.person.provider !== 'owner');
  const door = layout?.walkway || { gx: 5.55, gy: 9.15 };
  for (const [index, placement] of placements.entries()) {
    const local = ease(clamp(cue.progress * 1.35 - index * .07));
    const [x, y] = project(placement.gx + (door.gx - placement.gx) * local, placement.gy + (door.gy - placement.gy) * local);
    drawFigure(ctx, x, y, theme, { pose: local < .94 ? 'walk' : 'stand', carry: index === 0 || index % 2 === 1, swing: Math.sin(time / 105 + index) * .55, facing: 1, identity: IDENTITY[placement.person.provider || cue.event.provider], alpha: 1 - clamp((cue.progress - .88) / .12) });
  }
}

function drawSignatureCue(ctx, room, cue, theme, project, height, time, layout, deliveryHome, courierHome, supervisorProvider, occupants = []) {
  if (!cue) return;
  const progress = ease(cue.progress);
  const center = project(PLATE.gridWidth / 2, PLATE.gridDepth / 2 + 1.5);
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.lineCap = 'round';
  // Event codes used to be painted as explanatory letters. The animation is now purely
  // visual, so choreography keeps its shapes and motion without any canvas labels.
  const badge = () => {};

  if (cue.kind === 'arrival') {
    drawArrival(ctx, project, theme, cue, time, layout);
    badge(theme.working);
  } else if (cue.kind === 'delegation_request') {
    drawDelegationRequest(ctx, project, theme, cue, time, layout);
    badge(theme.working);
  } else if (cue.kind === 'coordination_message') {
    drawCoordinationMessage(ctx, project, theme, cue, time, layout);
    badge(theme.working);
  } else if (cue.kind === 'patch_apply_ended') {
    drawPatchApplyEnded(ctx, project, theme, cue, time, layout);
    badge(theme.working);
  } else if (cue.kind === 'owner_request') {
    drawOwnerRequest(ctx, room, project, theme, cue, time);
    badge(theme.waiting);
  } else if (cue.kind === 'owner_response') {
    drawOwnerResponse(ctx, room, project, theme, cue, time, layout);
    badge(theme.working);
  } else if (cue.kind === 'revision' || cue.kind === 'review' || cue.kind === 'approved') {
    drawReviewBeat(ctx, project, theme, cue, time, layout, cue.kind === 'approved');
    badge(cue.kind === 'approved' ? theme.working : theme.waiting);
  } else if (cue.kind === 'handoff') {
    drawLeadHandoff(ctx, project, theme, cue, time, layout);
    badge(theme.waiting);
  } else if (cue.kind === 'discussion') {
    drawDiscussionTravel(ctx, project, theme, cue, time, layout, false);
    badge(theme.working);
  } else if (cue.kind === 'discussion_return') {
    drawDiscussionTravel(ctx, project, theme, cue, time, layout, true);
  } else if (cue.kind === 'error') {
    drawErrorBeat(ctx, project, theme, cue, time, layout);
    badge(theme.error);
  } else if (cue.kind === 'authority') {
    drawAuthorityHandoff(ctx, room, project, theme, cue, time, layout);
    badge(theme.waiting);
  } else if (cue.kind === 'multi_delivery') {
    // I is an internal queue at this project's current supervisor/main-AI desk. On the
    // first floor that desk is the small project's seat, never the Owner desk.
    drawMultiDelivery(ctx, project, theme, cue, time, layout, occupants);
    badge(theme.working);
  } else if (cue.kind === 'final_delivery') {
    // A finished task is walked over to the Owner, not floated across the plate.
    if (room === 'owner') drawOwnerReport(ctx, project, theme, cue, time, layout, supervisorProvider);
    else drawDeliveryRun(ctx, project, theme, cue, time, layout, deliveryHome, courierHome, supervisorProvider);
    badge(theme.working);
  } else if (cue.kind === 'closing_report' || cue.kind === 'closing_departure') {
    drawClosingProject(ctx, room, project, theme, cue, time, layout, occupants);
  } else if (cue.kind === 'cancelled') {
    drawCancelledBeat(ctx, project, theme, cue, time, layout);
  }
  ctx.restore();
  void height;
}

function deliveredCountForFloor(room, model, annexIndex = 0) {
  if (room === 'owner') {
    return TEAM_ROOMS.reduce((sum, provider) => sum + (model?.providers?.[provider]?.livePods || [])
      .reduce((providerSum, pod) => providerSum + Math.max(0, Number(pod.deliveredCount) || 0), 0), 0);
  }
  if (!TEAM_ROOMS.includes(room)) return 0;
  const session = teamSessions(model, room)[annexIndex];
  if (session?.source !== 'live') return 0;
  const pod = (model?.providers?.[room]?.livePods || [])[session.index];
  return Math.max(0, Number(pod?.deliveredCount) || 0);
}

function drawPersistentWorkMarkers(ctx, room, model, annexIndex, project, theme) {
  const delivered = deliveredCountForFloor(room, model, annexIndex);
  if (delivered <= 0) return;
  const [x, y] = room === 'owner'
    ? project(5.45, 2.7, 1.22)
    : project(2.15, 4.38, 1.08);
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = .5;
  for (let index = 0; index < Math.min(3, delivered); index += 1) {
    ctx.strokeRect(x - 3 + index * .7, y - 3.2 - index * .65, 6, 3.2);
  }
  ctx.restore();
}

export class RoomRenderer {
  constructor({ canvas, room, annexIndex = 0, onFrame = null }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.room = room;
    this.annexIndex = annexIndex;
    this.onFrame = onFrame;
    this.model = null;
    this.running = false;
    this.timer = null;
    this.lastFrameAt = 0;
    this.scale = 1;
    this.theme = themeFor({});
    this.themeInput = { luminance: null, prefersDark: false, lock: 'auto', tone: true };
    this.phase = 'entering';
    this.phaseStartedAt = typeof performance === 'object' ? performance.now() : 0;
    this.projection = 'axon';
    this.sceneAssetSource = null;
    this.sceneAsset = null;
    this.lastReliablePoses = new Map();
    this.resize(canvas.width, canvas.height);
  }

  /** Backing-store size stays the caller's contract; logical units are derived from it. */
  resize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.scale = width / PLATE.logicalWidth;
    this.logicalWidth = PLATE.logicalWidth;
    this.logicalHeight = height / this.scale;
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.lineJoin = 'round';
  }

  setModel(model, drawImmediately = true) {
    this.model = model;
    if (drawImmediately) this.draw(typeof performance === 'object' ? performance.now() : 0);
  }

  /** Additive: drives the entering/leaving transition state machine. */
  setPhase(phase, at = (typeof performance === 'object' ? performance.now() : 0)) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.phaseStartedAt = at;
  }

  /** Additive: ink sketch on light desktops, white sketch on dark ones, with grayscale wash. */
  setTheme({ luminance = null, prefersDark = false, lock = 'auto', tone = true } = {}) {
    this.themeInput = { luminance, prefersDark, lock, tone };
    this.theme = themeFor(this.themeInput);
  }

  /** Additive: 'axon' is the 2:1 cutaway plate, 'plan' is the flat architectural plan. */
  setProjection(projection) {
    this.projection = projection === 'plan' ? 'plan' : 'axon';
  }

  /**
   * Load a transparent, people-free approved room plate.  The visual source never
   * contains a static actor, so a stale snapshot cannot look like a live worker.
   * The guarded Image lookup keeps the deterministic Node renderer tests DOM-free.
   */
  setSceneAsset(source) {
    if (source === this.sceneAssetSource) return;
    this.sceneAssetSource = source || null;
    this.sceneAsset = null;
    if (!this.sceneAssetSource || typeof Image !== 'function') return;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (this.sceneAssetSource !== source) return;
      this.sceneAsset = image;
      this.draw(typeof performance === 'object' ? performance.now() : 0);
    };
    image.onerror = () => {
      if (this.sceneAssetSource === source) this.sceneAsset = null;
    };
    image.src = source;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = (time) => {
      if (!this.running) return;
      const mode = this.model?.effectiveMode || 'low';
      const interval = Math.max(16, Number(this.model?.frameIntervalMs) || (mode === 'full' ? 33 : mode === 'low' ? 83 : mode === 'important' ? 125 : 500));
      if (time - this.lastFrameAt >= interval) {
        this.lastFrameAt = time;
        const frameStartedAt = performance.now();
        this.draw(time);
        this.onFrame?.(performance.now() - frameStartedAt);
      }
      this.timer = requestAnimationFrame(tick);
    };
    this.timer = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.timer) cancelAnimationFrame(this.timer);
    this.timer = null;
  }

  draw(time = performance.now()) {
    const ctx = this.ctx;
    const theme = this.theme;
    const mode = this.model?.effectiveMode || 'low';
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    ctx.strokeStyle = theme.stroke;
    ctx.fillStyle = theme.text;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    const phaseElapsed = time - this.phaseStartedAt;
    const phase = phaseAt(this.phase, phaseElapsed);
    if (this.phase === 'entering' && phase.done) this.phase = 'resident';
    const sceneTime = mode === 'dnd' || mode === 'important' ? 0 : time;

    const plan = this.projection === 'plan';
    const assetReady = Boolean(this.sceneAsset?.complete && (this.sceneAsset.naturalWidth || this.sceneAsset.width));
    // A requested scene remains transparent while its image decodes; we never flash the
    // superseded hand-drawn room behind the fixed approved composition.
    const sceneMode = !plan && Boolean(this.sceneAssetSource);
    const assetBox = sceneMode
      ? sceneImageBox(this.sceneAsset, this.logicalWidth, this.logicalHeight)
      : null;
    const project = sceneMode
      ? sceneProjector(this.room, assetBox)
      : plan
        ? planProjector()
        : projector({ centerX: PLATE.centerX, top: PLATE.top, unit: PLATE.unit });
    const now = Date.now();
    const cue = globalChoreography.current(now);
    const cueOnThisFloor = cueAppearsOnFloor(cue, { room: this.room, annexIndex: this.annexIndex }, this.model);
    // The floor already knows which session it belongs to, so no slicing by headcount:
    // one subagent team per plate, everyone else in the shared office.
    const allOccupants = occupantsFromModel(this.room, this.model, this.annexIndex);
    const occupants = allOccupants.filter((person) => !person.hidden);
    const layout = officeLayout(this.room, podCountFor(this.room, this.model, occupants), {
      occupants: allOccupants,
      model: this.model,
      annexIndex: this.annexIndex
    });
    const deliveryHome = cueOnThisFloor && cue?.kind === 'final_delivery'
      ? deliveryHomeForCue(this.room, this.model, this.annexIndex, layout, cue.event)
      : null;
    const deliveryCourierHome = cueOnThisFloor && cue?.kind === 'final_delivery'
      ? deliveryCourierHomeForCue(layout, allOccupants)
      : null;
    const deliverySupervisor = cueOnThisFloor && cue?.kind === 'final_delivery'
      ? supervisorForEvent(this.model, cue.event)
      : null;
    const hideDeliveryMain = cueOnThisFloor && cue?.kind === 'final_delivery';

    if (sceneMode) {
      if (assetReady && phase.plate > 0) {
        ctx.save();
        ctx.globalAlpha *= phase.plate;
        ctx.drawImage(this.sceneAsset, assetBox.x, assetBox.y, assetBox.width, assetBox.height);
        ctx.restore();
      }
    } else if (plan) drawPlanPlate(ctx, project, theme, phase.plate);
    else {
      drawPlate(ctx, project, theme, phase.plate, layout);
      if (this.phase === 'entering') drawConstructionScene(ctx, project, theme, phaseElapsed, mode);
    }
    if (plan && phase.plate >= 1) drawPlanStairs(ctx, project, theme, phase.furniture || 1);

    // Furniture and people share one painter's-algorithm pass: a figure seated behind a
    // desk is drawn before it, so people sit at their desks instead of standing on them.
    const scene = [];
    const seatedSpots = [];
    const workingSpots = [];

    if (phase.figures > 0) {
      const theatricalKinds = new Set(['arrival', 'delegation_request', 'coordination_message', 'patch_apply_ended', 'handoff', 'discussion', 'discussion_return', 'error', 'revision', 'review', 'approved', 'owner_request', 'owner_response', 'authority', 'multi_delivery', 'cancelled', 'closing_report', 'closing_departure']);
      const cueSession = String(cue?.event?.sessionId || '');
      const stagedOccupants = cueOnThisFloor && theatricalKinds.has(cue?.kind)
        ? occupants.filter((person) => {
          if (cue?.kind === 'closing_report' || cue?.kind === 'closing_departure') return false;
          if (cue?.kind === 'owner_request' && person.waitingVisitor) return false;
          // Meeting attendees are independent theatre figures. The project's real workers
          // remain at their desks, even when this first-floor project emitted the cue.
          if (cue?.kind === 'discussion' || cue?.kind === 'discussion_return') {
            return !person.meeting;
          }
          return !(cueSession && String(person.sessionId || '').endsWith(`:${cueSession}`));
        })
        : occupants;
      const basePlacements = hideDeliveryMain
        ? deliveryPlacementsForCue(layout, allOccupants, cue.event)
        : assignSeats(layout, stagedOccupants);
      const placements = basePlacements.map((placement, order) => ({ ...placement, order }));
      const wallNow = Date.now();
      const posed = placements.map((placement) => {
        let pose = poseFor(placement, {
          time: sceneTime,
          mode,
          layout,
          room: this.room,
          now: wallNow,
          idleCue: idleCueForModel(this.model, placement.person.id, wallNow)
        });
        if (placement.person.activity === 'unknown' && this.lastReliablePoses.has(placement.person.id)) {
          pose = { ...this.lastReliablePoses.get(placement.person.id), alpha: .75 };
        } else if (!['unknown', 'snapshot', 'cancelled', 'completed'].includes(placement.person.activity)) {
          this.lastReliablePoses.set(placement.person.id, { ...pose });
        }
        return { placement, pose };
      });
      // Figures are never shrunk. A floor is capped at six people plus the Owner, and the
      // seat plan keeps them apart at full size; shrinking was how the old plan bought
      // capacity it did not have, and it made the drawing worse to hide the overcrowding.
      const figureScale = layout.figureScale || 1;

      for (const [index, actor] of posed.entries()) {
        const person = actor.placement.person;
        const appear = clamp(phase.figures * posed.length - index * .35);
        if (appear <= 0) continue;
        // Convention: a seated figure replaces its chair; the figure plus a back arc is
        // the seat symbol. Standing people keep their chair so the seat still reads.
        if (['type', 'sit', 'drink'].includes(actor.pose.pose)) seatedSpots.push(actor.pose);
        if (actor.pose.pose === 'type' && ['working', 'running'].includes(person.activity)) workingSpots.push(actor.pose);
        scene.push({
          depth: actor.pose.gx + actor.pose.gy + .25,
          paint: () => {
            const [x, y] = project(actor.pose.gx, actor.pose.gy);
            if (person.snapshot) ctx.setLineDash([1.2, 1]);
            if (plan) {
              drawPlanFigure(ctx, x, y, theme, {
                identity: IDENTITY[person.provider] || IDENTITY[this.room] || null,
                alpha: (actor.pose.alpha ?? 1) * appear,
                facing: actor.pose.facing || 1
              });
              ctx.setLineDash([]);
              return;
            }
            drawFigure(ctx, x, y, theme, {
              pose: actor.pose.pose,
              swing: actor.pose.swing || 0,
              lean: actor.pose.lean || 0,
              facing: actor.pose.facing || 1,
              identity: IDENTITY[person.provider] || IDENTITY[this.room] || null,
              alpha: (actor.pose.alpha ?? 1) * appear,
              carry: Boolean(actor.pose.carry),
              scale: figureScale
            });
            if (person.resting) ctx.recordAnimationCue?.('rest', actor.pose.pose, { x, y, progress: actor.pose.workProgress || 0 });
            if (person.provider === 'owner') drawOwnerIdleProp(ctx, x, y, theme, actor.pose.ownerAction);
            else {
              drawWorkProp(ctx, x, y, theme, actor.pose.workAction, actor.pose.workProgress, actor.pose.facing);
              drawLiveRoutineProp(ctx, x, y, theme, actor.pose.routineAction, actor.pose.routineProgress, actor.pose.facing);
              drawWorkerIdleProp(ctx, x, y, theme, actor.pose.idleAction, actor.pose.idleProgress, actor.pose.facing);
            }
            ctx.setLineDash([]);
          }
        });
      }
    }

    if (phase.furniture > 0 && !sceneMode) {
      for (const [index, item] of layout.items.entries()) {
        const itemProgress = itemProgressFor(index, layout.items.length, phase.furniture);
        if (itemProgress <= 0) continue;
        const takenBySeatedFigure = item.kind === 'chair'
          && seatedSpots.some((spot) => Math.abs(spot.gx - item.gx) < .8 && Math.abs(spot.gy - item.gy) < .8);
        if (takenBySeatedFigure) continue;
        const activeDesk = item.kind === 'desk'
          && workingSpots.some((spot) => Math.abs(spot.gx - item.gx) < .7 && Math.abs(spot.gy - (item.gy + .62)) < .8);
        const renderItem = activeDesk
          ? { ...item, monitorSignal: .35 + Math.abs(Math.sin(sceneTime / 720)) * .65 }
          : item;
        scene.push({
          depth: itemDepth(renderItem),
          paint: () => {
            ctx.save();
            ctx.globalAlpha *= renderItem.alpha ?? 1;
            (plan ? drawPlanItem : drawOfficeItem)(ctx, project, theme, renderItem, itemProgress);
            ctx.restore();
          }
        });
      }
    }

    scene.sort((a, b) => a.depth - b.depth);
    for (const piece of scene) piece.paint();
    if (!plan && !sceneMode && this.phase === 'leaving') drawArchiveClosure(ctx, project, theme, phaseElapsed);
    if (phase.furniture > 0) drawPersistentWorkMarkers(ctx, this.room, this.model, this.annexIndex, project, theme);

    if (cueOnThisFloor) drawSignatureCue(
      ctx,
      this.room,
      cue,
      theme,
      project,
      this.logicalHeight,
      time,
      layout,
      deliveryHome,
      deliveryCourierHome,
      deliverySupervisor?.provider || null,
      allOccupants
    );

    void floorStatusActivity(this.room, this.model, this.annexIndex);
  }
}

export { TIMELINE as TRANSITION_TIMELINE };
