import { cueAppearsOnFloor, globalChoreography } from './choreography.js';
import {
  FLOOR_WORKSTATIONS,
  sessionsForProvider,
  SHARED_FLOOR_KEY,
  sharedFloorSessions,
  teamSessions
} from './floor-layout.js';
import {
  assignSeats,
  clamp,
  drawCrane,
  drawElevator,
  drawFigure,
  drawGuides,
  drawNamePlate,
  drawOfficeItem,
  drawPlate,
  drawQuestionTag,
  drawStairs,
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

const PLATE_LABELS = Object.freeze({
  all: 'AI OFFICE',
  shared: '共用辦公層',
  owner: 'OWNER・決策',
  codex: 'CODEX・工事',
  claude: 'CLAUDE・審閱',
  gemini: 'GEMINI・諮詢',
  grok: 'GROK・探索',
  lobby: 'LOBBY・大廳'
});

const TEAM_ROOMS = ['codex', 'claude', 'gemini', 'grok'];

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
function occupantsForSession(room, model, session) {
  const occupants = [];
  if (session.source === 'live') {
    const pod = (model?.providers?.[room]?.livePods || [])[session.index];
    if (!pod) return [];
    const agents = pod.agents || [];
    const isManager = agents.length > 1;
    // Upstream does not always flag a main agent. When none is flagged the first agent is
    // the main worker, or a one-agent pod would be drawn as two people.
    const helpers = agents.some((agent) => agent?.isMain) ? agents.filter((agent) => !agent?.isMain) : agents.slice(1);
    // A pod whose main worker is away is drawn on the floor they walked to, not here.
    const mainAway = pod.activity === 'waiting_owner' || pod.activity === 'discussing';
    occupants.push({
      id: `${pod.id}:main`,
      label: pod.label,
      provider: room,
      activity: pod.activity === 'running' ? 'working' : pod.activity,
      manager: isManager,
      snapshot: false,
      actionStyle: isManager ? 4 : 2,
      idleFrom: pod.idleFrom || null,
      idleSinceAt: Number(pod.idleSinceAt) || null,
      deliveredCount: Math.max(0, Number(pod.deliveredCount) || 0),
      hidden: mainAway
    });
    for (const [index, agent] of helpers.entries()) {
      occupants.push({
        id: agent.id,
        label: agent.role || 'subagent',
        provider: room,
        // Pod certainty dominates child decoration. A disconnected pod cannot leave
        // helpers walking or typing from their last pre-disconnect activity.
        activity: ['unknown', 'idle', 'completed'].includes(pod.activity) ? pod.activity : (agent.activity || 'working'),
        manager: false,
        snapshot: false,
        actionStyle: [0, 1, 3, 2, 0][index % 5],
        idleFrom: pod.idleFrom || null,
        idleSinceAt: Number(pod.idleSinceAt) || null,
        deliveredCount: Math.max(0, Number(pod.deliveredCount) || 0)
      });
    }
    for (let index = 0; index < Math.max(0, pod.overflowAgentCount || 0); index += 1) {
      occupants.push({
        id: `${pod.id}:overflow:${index}`,
        label: '更多 subagent',
        provider: room,
        activity: pod.activity === 'running' ? 'working' : pod.activity,
        manager: false,
        snapshot: false,
        aggregated: true,
        actionStyle: [0, 1, 3, 2][index % 4],
        idleFrom: pod.idleFrom || null,
        idleSinceAt: Number(pod.idleSinceAt) || null,
        deliveredCount: Math.max(0, Number(pod.deliveredCount) || 0)
      });
    }
  } else return [];
  return occupants
    .slice(0, FLOOR_WORKSTATIONS)
    .map((person, order) => ({ ...person, podIndex: Math.floor(order / SEATS_PER_ISLAND) }));
}

/** Every session of one provider, used by the single-floor view and the headcount. */
function allOccupantsForProvider(room, model) {
  if (!TEAM_ROOMS.includes(room)) return [];
  return sessionsForProvider(model?.providers?.[room]).flatMap((session) => occupantsForSession(room, model, session));
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
    const occupants = [{ id: 'owner', label: 'Owner', provider: 'owner', activity: 'idle', manager: true, snapshot: false, actionStyle: 1, podIndex: 0 }];
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
        podIndex: 0
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
  return session ? occupantsForSession(room, model, session) : [];
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
const P4_ACTIONS = Object.freeze(['daze', 'drink', 'read', 'water']);
let p4Schedule = { slot: null, ownerId: null, action: null, cancelled: false };

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
    (model?.providers?.[provider]?.livePods || [])
      .filter((pod) => pod.activity === 'idle'
        && pod.idleFrom === 'turn_completed'
        && Number(pod.idleSinceAt) + TURN_SETTLE_MS <= slotStartedAt)
      .map((pod) => `${pod.id}:main`)
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
  return assignSeats(layout, occupants)
    .filter((entry) => !entry.person.hidden && !isCueMainPerson(entry.person, event));
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

  // Owner receives requests while seated; the requester is the visitor who raises or
  // knocks. The old branch made Owner raise a hand at their own desk.
  if (activity === 'waiting_owner' && person.provider !== 'owner') {
    return { ...seat, pose: 'raise', swing: 0, facing: placement.facing, tag: true, alpha: 1 };
  }
  if (activity === 'failed') {
    const shake = still ? 0 : Math.sin(time / 90) * .5;
    return { ...seat, gx: seat.gx + shake * .04, pose: 'stand', swing: 0, facing: placement.facing, alpha: 1 };
  }
  if (activity === 'unknown' || activity === 'cancelled' || activity === 'snapshot') {
    return { ...seat, pose: 'stand', swing: 0, facing: placement.facing, alpha: .75 };
  }

  if (activity === 'idle' || placement.role === 'queue') {
    return workerIdlePose(seat, placement, { ...options, idleCue: still ? null : options.idleCue });
  }
  if (activity === 'discussing') {
    return { ...seat, pose: 'stand', swing: still ? 0 : Math.sin(time / 520) * .4, facing: placement.facing, alpha: 1 };
  }
  const seated = placement.desk === true || ['seat', 'desk', 'owner', 'meet'].includes(placement.role);
  const cycle = mode === 'full' ? 2_400 : 4_200;
  const local = still ? 0 : ((time + (placement.order || 0) * 430) % cycle) / cycle;
  return {
    ...seat,
    pose: seated ? 'type' : 'stand',
    swing: still ? 0 : Math.sin(local * Math.PI * 2) * .8,
    facing: placement.facing,
    alpha: 1
  };
}

function drawOwnerIdleProp(ctx, x, y, theme, action) {
  if (!action) return;
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
    ctx.font = 'bold 5px system-ui, sans-serif';
    ctx.fillText('z', x + 5, y - 12);
    ctx.font = 'bold 4px system-ui, sans-serif';
    ctx.fillText('z', x + 8, y - 15);
  }
  ctx.restore();
}

export function drawWorkerIdleProp(ctx, x, y, theme, action, progress = 0, facing = 1) {
  if (!action) return;
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
  } else if (action === 'daze') {
    for (const offset of [0, 2, 4]) {
      ctx.beginPath();
      ctx.arc(x + 3.8 + offset, y - 13 - offset * .3, .35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawOwnerRequest(ctx, room, project, theme, cue, time) {
  const identity = IDENTITY[cue.event.provider] || null;
  const progress = clamp(cue.progress);
  const stage = ownerRequestStage(progress);
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
    ctx.strokeStyle = theme.waiting;
    ctx.lineWidth = .65;
    for (let index = 0; index < knock; index += 1) {
      ctx.beginPath();
      ctx.arc(x - 3.8 - index * 1.5, y - 10 - index * .7, 1 + index * .25, -1.1, 1.1);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (stage === 'request_queue') drawQuestionTag(ctx, x, y - 14, theme);
}

function drawAuthorityHandoff(ctx, room, project, theme, cue, time) {
  const identity = IDENTITY[cue.event.provider] || null;
  const progress = ease(clamp(cue.progress));
  const [ownerX, ownerY] = project(4.9, 3.1);
  const [recipientX, recipientY] = project(room === 'owner' ? 6.8 : 5.9, room === 'owner' ? 5.4 : 5.9);
  const cardX = ownerX + (recipientX - ownerX) * progress;
  const cardY = ownerY + (recipientY - ownerY) * progress - 8;
  if (room !== 'owner') drawFigure(ctx, ownerX, ownerY, theme, { pose: 'stand', facing: 1, identity: IDENTITY.owner, alpha: 1 });
  drawFigure(ctx, recipientX, recipientY, theme, { pose: 'stand', facing: -1, identity, alpha: 1 });
  ctx.save();
  ctx.strokeStyle = theme.waiting;
  ctx.fillStyle = theme.waiting;
  ctx.lineWidth = .8;
  ctx.strokeRect(cardX - 4.2, cardY - 2.8, 8.4, 5.6);
  ctx.beginPath();
  ctx.moveTo(cardX - 2.3, cardY);
  ctx.lineTo(cardX - .4, cardY + 1.8);
  ctx.lineTo(cardX + 2.8, cardY - 1.7);
  ctx.stroke();
  if (progress > .72) {
    ctx.font = 'bold 4.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AUTH', recipientX, recipientY - 16 + Math.sin(time / 300) * .4);
  }
  ctx.restore();
}

/**
 * Signature J, Owner side: finished work is reported in person. The courier comes in from
 * the walkway, stands at the Owner's desk long enough to hand the delivery over, then
 * walks back out. Owner rule (2026-08-11): AI go to the Owner to report, not the reverse.
 */
function drawOwnerReport(ctx, project, theme, cue, time) {
  const identity = IDENTITY[cue.event.provider] || null;
  // Straight up the open front aisle: the waiting chairs sit at gx 7 and 8.8, so the
  // courier keeps to gx 6.3 and never walks through one.
  const [doorX, doorY] = project(6.3, PLATE.gridDepth - 1.2);
  const [spotX, spotY] = project(6.3, 5.2);
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
    const [boxX, boxY] = project(5.4, 2.6, 1.2);
    ctx.save();
    ctx.strokeStyle = theme.working;
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
function drawDeliveryRun(ctx, project, theme, cue, time, layout, deliveryHome) {
  const identity = IDENTITY[cue.event.provider] || null;
  const progress = clamp(cue.progress);
  const stage = completionStage(progress);
  const home = deliveryHome || layout?.seats?.find((seat) => !seat.role) || { gx: 2.1, gy: 5.1 };
  const [workerX, workerY] = project(home.gx, home.gy);
  const [leadX, leadY] = project(5.3, 6.7);
  const [liftX, liftY] = project(PLATE.gridWidth - .4, 4.2);
  if (progress >= .9) {
    const local = ease((progress - .9) / .1);
    drawFigure(ctx, liftX + (workerX - liftX) * local, liftY + (workerY - liftY) * local, theme, {
      pose: local < .92 ? 'walk' : 'sit',
      carry: false,
      swing: Math.sin(time / 120) * .55,
      facing: deliveryReturnFacing(home, local),
      identity,
      alpha: clamp((progress - .9) / .025)
    });
    return;
  }
  let x = workerX;
  let y = workerY;
  if (stage === 'worker_to_lead') {
    const local = ease(progress / .3);
    x += (leadX - workerX) * local;
    y += (leadY - workerY) * local;
  } else if (stage === 'lead_accepts') {
    x = leadX; y = leadY;
    drawFigure(ctx, leadX + 5, leadY - 1, theme, { pose: 'stand', facing: -1, identity, alpha: 1 });
  } else {
    const local = ease(clamp((progress - .48) / .24));
    x = leadX + (liftX - leadX) * local;
    y = leadY + (liftY - leadY) * local;
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

function drawSignatureCue(ctx, room, cue, theme, project, height, time, layout, deliveryHome) {
  if (!cue) return;
  const progress = ease(cue.progress);
  const center = project(PLATE.gridWidth / 2, PLATE.gridDepth / 2 + 1.5);
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.lineCap = 'round';
  const badge = (color) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = 'bold 6px "Microsoft JhengHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (cue.code) ctx.fillText(cue.code, 8, 10);
    ctx.restore();
  };

  if (cue.kind === 'arrival') {
    const [sx, sy] = project(PLATE.gridWidth - .5, PLATE.gridDepth - 2.5);
    const [tx, ty] = project(PLATE.gridWidth / 2, PLATE.gridDepth / 2);
    drawFigure(ctx, sx + (tx - sx) * progress, sy + (ty - sy) * progress, theme, {
      pose: 'walk', carry: true, swing: Math.sin(time / 120) * .5, alpha: 1 - progress * .15, facing: -1
    });
    badge(theme.working);
  } else if (cue.kind === 'owner_request') {
    drawOwnerRequest(ctx, room, project, theme, cue, time);
    badge(theme.waiting);
  } else if (cue.kind === 'revision' || cue.kind === 'approved') {
    const color = cue.kind === 'revision' ? theme.waiting : theme.working;
    const drop = Math.sin(progress * Math.PI) * 3;
    ctx.strokeStyle = color;
    ctx.save();
    ctx.globalAlpha = .9;
    ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.rect(center[0] - 5, center[1] - 12 - drop, 10, 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(center[0], center[1] - 8.5 - drop, 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    badge(color);
  } else if (cue.kind === 'handoff') {
    const split = Math.sin(progress * Math.PI) * 5;
    ctx.lineWidth = .7;
    for (const offset of [-split - 4, split + 4]) {
      ctx.beginPath();
      ctx.rect(center[0] + offset - 3, center[1] - 12, 6, 4.5);
      ctx.stroke();
    }
    badge(theme.waiting);
  } else if (cue.kind === 'discussion') {
    for (const [index, offset] of [-9, 9].entries()) {
      const bob = Math.sin(time / 300 + index) * 1.1;
      ctx.lineWidth = .65;
      ctx.beginPath();
      ctx.rect(center[0] + offset - 4, center[1] - 14 + bob, 8, 5.5);
      ctx.stroke();
    }
    badge(theme.working);
  } else if (cue.kind === 'error') {
    ctx.strokeStyle = theme.error;
    ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.arc(center[0], center[1] - 11, 3.4, 0, Math.PI * 2);
    ctx.moveTo(center[0], center[1] - 13.2);
    ctx.lineTo(center[0], center[1] - 10.4);
    ctx.stroke();
    badge(theme.error);
  } else if (cue.kind === 'authority') {
    drawAuthorityHandoff(ctx, room, project, theme, cue, time);
    badge(theme.waiting);
  } else if (cue.kind === 'multi_delivery' || cue.kind === 'final_delivery') {
    // A finished task is walked over to the Owner, not floated across the plate.
    if (room === 'owner') drawOwnerReport(ctx, project, theme, cue, time);
    else if (cue.kind === 'final_delivery') drawDeliveryRun(ctx, project, theme, cue, time, layout, deliveryHome);
    else {
      ctx.lineWidth = .7;
      for (let index = 0; index < 3; index += 1) {
        const x = center[0] - 12 + index * 9 + progress * 14;
        ctx.beginPath();
        ctx.rect(x - 3, center[1] - 11 - index, 6, 4.5);
        ctx.stroke();
      }
    }
    badge(theme.working);
  } else if (cue.kind === 'cancelled') {
    ctx.strokeStyle = theme.quiet;
    ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.moveTo(center[0] - 3, center[1] - 13);
    ctx.lineTo(center[0] + 3, center[1] - 8);
    ctx.moveTo(center[0] + 3, center[1] - 13);
    ctx.lineTo(center[0] - 3, center[1] - 8);
    ctx.stroke();
  }
  ctx.restore();
  void height;
}

function elevatorCarFor(cue, theme) {
  if (!cue) return null;
  if (!['arrival', 'owner_request', 'discussion', 'final_delivery'].includes(cue.kind)) return null;
  const up = cue.kind === 'owner_request' || cue.kind === 'final_delivery';
  const travel = cue.kind === 'owner_request'
    ? ease(clamp((cue.progress - .34) / .24))
    : cue.kind === 'final_delivery'
      ? ease(clamp((cue.progress - .72) / .12))
      : ease(clamp(cue.progress * 2));
  return {
    position: up ? 1 - travel : travel,
    occupied: true,
    color: cue.kind === 'owner_request' ? theme.waiting : theme.working
  };
}

/** "+N" in the corner when a floor holds more people than one plate can seat. */
function drawOverflowNote(ctx, theme, room, model, annexIndex, project) {
  let hidden = 0;
  if (room === SHARED_FLOOR_KEY) {
    hidden = Math.max(0, sharedFloorSessions(model).reduce((sum, session) => sum + session.population, 0) - FLOOR_WORKSTATIONS);
  } else if (TEAM_ROOMS.includes(room)) {
    const sessions = teamSessions(model, room);
    const session = sessions[annexIndex];
    if (!session) return;
    // Two separate overflows: people this plate cannot seat, and whole teams that never
    // got a floor. Clamp the first, or a small team cancels out the second.
    hidden = Math.max(0, session.population - FLOOR_WORKSTATIONS);
    if (annexIndex === sessions.length - 1) {
      const all = sessionsForProvider(model?.providers?.[room]);
      hidden += all.slice(sessions.length).reduce((sum, entry) => sum + entry.population, 0);
    }
  }
  if (hidden <= 0) return;
  const [x, y] = project(PLATE.gridWidth - 1.5, PLATE.gridDepth - 1);
  ctx.save();
  ctx.fillStyle = theme.soft;
  ctx.font = '6px "Microsoft JhengHei", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`+${hidden}`, x, y);
  ctx.restore();
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
  const session = TEAM_ROOMS.includes(room) ? teamSessions(model, room)[annexIndex] : null;
  if (session?.source === 'snapshot') {
    const [x, y] = project(5.2, 6.8, .72);
    ctx.save();
    ctx.strokeStyle = theme.quiet;
    ctx.fillStyle = theme.text;
    ctx.lineWidth = .55;
    ctx.setLineDash([1.2, 1]);
    ctx.strokeRect(x - 13, y - 7, 26, 10);
    ctx.setLineDash([]);
    ctx.font = '4px "Microsoft JhengHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RECENT SNAPSHOT', x, y - .5);
    ctx.restore();
  }

  const delivered = deliveredCountForFloor(room, model, annexIndex);
  if (delivered <= 0) return;
  const [x, y] = room === 'owner'
    ? project(5.45, 2.7, 1.22)
    : project(2.15, 4.38, 1.08);
  ctx.save();
  ctx.strokeStyle = theme.working;
  ctx.lineWidth = .5;
  for (let index = 0; index < Math.min(3, delivered); index += 1) {
    ctx.strokeRect(x - 3 + index * .7, y - 3.2 - index * .65, 6, 3.2);
  }
  if (delivered > 3) {
    ctx.fillStyle = theme.text;
    ctx.font = '4px system-ui, sans-serif';
    ctx.fillText(`+${delivered - 3}`, x + 4, y - 4);
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
    const baseTheme = this.theme;
    // Owner's permanent floor is the visual anchor. Its paper wash is deliberately
    // opaque enough that lower floors and a busy wallpaper cannot bleed through it.
    const theme = this.room === 'owner' && baseTheme.tone
      ? {
          ...baseTheme,
          tone: {
            ...baseTheme.tone,
            plate: baseTheme.name === 'ink' ? 'rgb(246, 244, 238)' : 'rgb(228, 231, 236)'
          }
        }
      : baseTheme;
    const mode = this.model?.effectiveMode || 'low';
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    ctx.strokeStyle = theme.stroke;
    ctx.fillStyle = theme.text;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    const phase = phaseAt(this.phase, time - this.phaseStartedAt);
    if (this.phase === 'entering' && phase.done) this.phase = 'resident';
    const sceneTime = mode === 'dnd' || mode === 'important' ? 0 : time;

    const plan = this.projection === 'plan';
    const project = plan
      ? planProjector()
      : projector({ centerX: PLATE.centerX, top: PLATE.top, unit: PLATE.unit });
    const now = Date.now();
    const cue = globalChoreography.current(now);
    const cueOnThisFloor = cueAppearsOnFloor(cue, { room: this.room, annexIndex: this.annexIndex }, this.model);
    // The floor already knows which session it belongs to, so no slicing by headcount:
    // one subagent team per plate, everyone else in the shared office.
    const allOccupants = occupantsFromModel(this.room, this.model, this.annexIndex);
    const occupants = allOccupants.filter((person) => !person.hidden);
    const layout = officeLayout(this.room, podCountFor(this.room, this.model, occupants));
    const deliveryHome = cueOnThisFloor && cue?.kind === 'final_delivery'
      ? deliveryHomeForCue(this.room, this.model, this.annexIndex, layout, cue.event)
      : null;
    const hideDeliveryMain = cueOnThisFloor && cue?.kind === 'final_delivery'
      && (TEAM_ROOMS.includes(this.room) || [SINGLE_FLOOR_KEY, SHARED_FLOOR_KEY].includes(this.room));

    if (!plan) {
      drawGuides(ctx, project, theme, this.logicalHeight, phase.plate);
      drawElevator(ctx, project, theme, this.logicalHeight, {
        car: cueOnThisFloor ? elevatorCarFor(cue, theme) : null,
        progress: phase.plate
      });
      if (phase.crane > 0) drawCrane(ctx, project, theme, phase.crane);
    }

    if (plan) drawPlanPlate(ctx, project, theme, phase.plate);
    else drawPlate(ctx, project, theme, phase.plate);
    if (plan && phase.plate >= 1) drawPlanStairs(ctx, project, theme, phase.furniture || 1);

    // Furniture and people share one painter's-algorithm pass: a figure seated behind a
    // desk is drawn before it, so people sit at their desks instead of standing on them.
    const scene = [];
    const seatedSpots = [];
    const workingSpots = [];

    if (phase.figures > 0) {
      const basePlacements = hideDeliveryMain
        ? deliveryPlacementsForCue(layout, allOccupants, cue.event)
        : assignSeats(layout, occupants);
      const placements = basePlacements.map((placement, order) => ({ ...placement, order }));
      const wallNow = Date.now();
      const posed = placements.map((placement) => {
        let pose = poseFor(placement, {
          time: sceneTime,
          mode,
          layout,
          room: this.room,
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
      const figureScale = 1;

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
                facing: actor.pose.facing || 1,
                tag: Boolean(actor.pose.tag)
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
            if (person.provider === 'owner') drawOwnerIdleProp(ctx, x, y, theme, actor.pose.ownerAction);
            else drawWorkerIdleProp(ctx, x, y, theme, actor.pose.idleAction, actor.pose.idleProgress, actor.pose.facing);
            ctx.setLineDash([]);
            if (actor.pose.tag) drawQuestionTag(ctx, x, y - 14, theme, appear);
            if (person.aggregated) {
              ctx.save();
              ctx.fillStyle = theme.soft;
              ctx.globalAlpha = appear * .8;
              ctx.font = '5px "Microsoft JhengHei", system-ui, sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('+', x + 4.5, y - 11);
              ctx.restore();
            }
          }
        });
      }
    }

    if (phase.furniture > 0) {
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
          paint: () => (plan ? drawPlanItem : drawOfficeItem)(ctx, project, theme, renderItem, itemProgress)
        });
      }
    }

    scene.sort((a, b) => a.depth - b.depth);
    for (const piece of scene) piece.paint();
    if (phase.figures > 0) drawOverflowNote(ctx, theme, this.room, this.model, this.annexIndex, project);
    if (phase.furniture > 0) drawPersistentWorkMarkers(ctx, this.room, this.model, this.annexIndex, project, theme);

    if (cueOnThisFloor) drawSignatureCue(ctx, this.room, cue, theme, project, this.logicalHeight, time, layout, deliveryHome);

    const activity = floorStatusActivity(this.room, this.model, this.annexIndex);
    const pulse = mode === 'dnd' || mode === 'important' || !['working', 'waiting_owner', 'failed'].includes(activity)
      ? 1
      : .45 + Math.abs(Math.sin(time / 620)) * .55;
    // A team floor is named after its project, not its provider: that is what the Owner
    // is actually watching (Owner, 2026-08-11). Long labels are cut, not wrapped.
    const session = TEAM_ROOMS.includes(this.room) ? teamSessions(this.model, this.room)[this.annexIndex] : null;
    const label = String(session?.label || '').trim();
    const plateLabel = label ? label.slice(0, 12) : (PLATE_LABELS[this.room] || this.room);
    drawNamePlate(ctx, theme, plateLabel, statusColor(theme, activity), this.logicalHeight - 4, {
      alpha: Math.max(phase.plate, phase.figures),
      pulse
    });
  }
}

export { TIMELINE as TRANSITION_TIMELINE };
