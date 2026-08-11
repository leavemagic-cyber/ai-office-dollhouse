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
// The Owner plus one floor's worth of workers: six people and the permanent resident.
export const SINGLE_FLOOR_CAPACITY = 7;

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
  // The Owner is the one permanent occupant: always at the desk, because finished work
  // is reported to them. Everyone else appears only while their session is real.
  const occupants = [{
    id: 'owner',
    label: 'Owner',
    provider: 'owner',
    activity: (model?.owner?.inboxCount || 0) > 0 ? 'waiting_owner' : 'idle',
    manager: true,
    snapshot: false,
    actionStyle: 1,
    podIndex: 0
  }];
  for (const room of TEAM_ROOMS) {
    for (const person of allOccupantsForProvider(room, model)) {
      if (person.hidden) continue;
      occupants.push({ ...person, provider: room });
    }
  }
  // Islands fill one at a time, so the Owner and the first three arrivals share island 0.
  return occupants.slice(0, SINGLE_FLOOR_CAPACITY).map((person, order) => ({ ...person, podIndex: Math.floor(order / SEATS_PER_ISLAND) }));
}

/**
 * How many people the building holds right now, used to pick single vs stacked floors.
 * Counted from the raw session populations, never from the drawn occupants: those are
 * already clipped to what one plate can seat, so counting them would report a full
 * building as small enough for the single-floor view and silently drop the rest.
 */
export function totalOccupants(model) {
  // The Owner always occupies a seat, so they count towards the floor's capacity.
  return TEAM_ROOMS.reduce((sum, room) => sum
    + sessionsForProvider(model?.providers?.[room]).reduce((people, session) => people + session.population, 0), 0) + 1;
}

/**
 * One session's people, in seating order: the main worker first, then its subagents, then
 * the summarised overflow. `podIndex` is the work island they belong to, so a session fills
 * one island completely before the next one opens (Codex seating spec §5).
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
      hidden: mainAway
    });
    for (const [index, agent] of helpers.entries()) {
      occupants.push({
        id: agent.id,
        label: agent.role || 'subagent',
        provider: room,
        activity: agent.activity || 'working',
        manager: false,
        snapshot: false,
        actionStyle: [0, 1, 3, 2, 0][index % 5]
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
        actionStyle: [0, 1, 3, 2][index % 4]
      });
    }
  } else {
    const work = (model?.providers?.[room]?.snapshotWork || []).filter((item) => item.recent)[session.index];
    if (!work) return [];
    occupants.push({ id: work.id, label: work.label, provider: room, activity: 'working', manager: work.openChildren > 0, snapshot: true, actionStyle: work.openChildren > 0 ? 4 : 2 });
    for (const [index, agent] of (work.agents || []).entries()) {
      occupants.push({ id: `${work.id}:${agent.label}`, label: agent.label, provider: room, activity: 'working', manager: false, snapshot: true, actionStyle: [0, 1, 3, 2, 0][index % 5] });
    }
  }
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

function occupantsFromModel(room, model, annexIndex = 0) {
  if (room === SINGLE_FLOOR_KEY) return singleFloorOccupants(model);
  if (room === SHARED_FLOOR_KEY) return sharedFloorOccupants(model);
  if (room === 'owner') {
    const occupants = [{ id: 'owner', label: 'Owner', activity: 'idle', manager: true, snapshot: false, actionStyle: 1, podIndex: 0 }];
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
 * Bounded travel, per SPEC 10.4: full mode moves at most two figures at once, other modes
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

function poseFor(placement, options) {
  const { time, mode, mobileRank, mobileCount, layout, room } = options;
  const person = placement.person;
  const seat = { gx: placement.gx, gy: placement.gy };
  const still = mode === 'dnd' || mode === 'important';
  const activity = person.activity;

  if (activity === 'waiting_owner') {
    return { ...seat, pose: 'raise', swing: 0, facing: placement.facing, tag: true, alpha: 1 };
  }
  if (activity === 'failed') {
    const shake = still ? 0 : Math.sin(time / 90) * .5;
    return { ...seat, gx: seat.gx + shake * .04, pose: 'stand', swing: 0, facing: placement.facing, alpha: 1 };
  }
  if (activity === 'unknown' || activity === 'cancelled') {
    return { ...seat, pose: 'stand', swing: 0, facing: placement.facing, alpha: .75 };
  }

  const cycle = mode === 'full' ? 2_400 : 4_200;
  const local = still ? 0 : ((time + (placement.order || 0) * 430) % cycle) / cycle;

  // Bounded walking: managers patrol, couriers deliver, everyone else works in place.
  if (!still && mobileRank >= 0 && mobileCount > 0) {
    const movers = mode === 'full' ? Math.min(2, mobileCount) : 1;
    const trip = mode === 'full' ? 7_200 : 12_500;
    const groups = Math.max(1, Math.ceil(mobileCount / movers));
    const group = Math.floor(time / trip) % groups;
    const first = group * movers;
    if (mobileRank >= first && mobileRank < first + movers) {
      const target = person.manager
        ? { gx: layout.manager.gx, gy: Math.max(1.4, layout.manager.gy - 3.4) }
        : room === 'claude'
          ? { gx: 8.0, gy: 5.4 }
          : { gx: layout.manager.gx, gy: layout.manager.gy };
      const travel = travelPose(seat, target, (time % trip) / trip);
      // travelPose owns the facing while someone is on the move; only the stages that
      // leave it undefined fall back to the direction the seat looks.
      return { ...travel, facing: travel.facing || placement.facing, alpha: 1 };
    }
  }

  if (activity === 'idle' || placement.role === 'queue') {
    const breathe = still ? 0 : Math.sin(time / 900) * .25;
    return { ...seat, pose: 'stand', swing: 0, lean: breathe, facing: placement.facing, alpha: 1 };
  }
  if (activity === 'discussing') {
    return { ...seat, pose: 'stand', swing: still ? 0 : Math.sin(time / 520) * .4, facing: placement.facing, alpha: 1 };
  }
  const seated = placement.desk === true || ['seat', 'desk', 'owner', 'meet'].includes(placement.role);
  return {
    ...seat,
    pose: seated ? 'type' : 'stand',
    swing: still ? 0 : Math.sin(local * Math.PI * 2) * .8,
    facing: placement.facing,
    alpha: 1
  };
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
  const progress = clamp(cue.progress);
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
    alpha: leaving ? Math.max(.15, 1 - ease((progress - .82) / .18)) : 1
  });
}

/** Signature J, team side: the worker leaves the floor for the lift, delivery in hand. */
function drawDeliveryRun(ctx, project, theme, cue, time) {
  const identity = IDENTITY[cue.event.provider] || null;
  const progress = ease(clamp(cue.progress / .85));
  // Starts in the corridor between the islands and the huddle, not inside a desk.
  const [sx, sy] = project(6.4, 7.4);
  const [tx, ty] = project(PLATE.gridWidth - .4, 4.2);
  drawFigure(ctx, sx + (tx - sx) * progress, sy + (ty - sy) * progress, theme, {
    pose: 'walk',
    carry: true,
    swing: Math.sin(time / 120) * .55,
    facing: 1,
    identity,
    alpha: 1 - clamp((progress - .82) / .18) * .85
  });
}

function drawSignatureCue(ctx, room, cue, theme, project, height, time) {
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
    drawQuestionTag(ctx, center[0], center[1] - 12 + Math.sin(time / 320) * 1.2, theme);
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
    ctx.lineWidth = .7;
    ctx.strokeStyle = theme.waiting;
    ctx.beginPath();
    ctx.arc(center[0] - 4 + progress * 8, center[1] - 11, 1.8, 0, Math.PI * 2);
    ctx.moveTo(center[0] - 2.2 + progress * 8, center[1] - 11);
    ctx.lineTo(center[0] + 3.4 + progress * 8, center[1] - 11);
    ctx.stroke();
    badge(theme.waiting);
  } else if (cue.kind === 'multi_delivery' || cue.kind === 'final_delivery') {
    // A finished task is walked over to the Owner, not floated across the plate.
    if (room === 'owner') drawOwnerReport(ctx, project, theme, cue, time);
    else if (cue.kind === 'final_delivery') drawDeliveryRun(ctx, project, theme, cue, time);
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
  const travel = ease(clamp(cue.progress * 2));
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
      const all = sessionsForProvider(model?.providers?.[room]).filter((entry) => entry.team);
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
    const theme = this.theme;
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
    // The floor already knows which session it belongs to, so no slicing by headcount:
    // one subagent team per plate, everyone else in the shared office.
    const occupants = occupantsFromModel(this.room, this.model, this.annexIndex).filter((person) => !person.hidden);
    const layout = officeLayout(this.room, podCountFor(this.room, this.model, occupants));

    const now = Date.now();
    const cue = globalChoreography.current(now);
    const cueOnThisFloor = cueAppearsOnFloor(cue, { room: this.room, annexIndex: this.annexIndex }, this.model);
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

    if (phase.figures > 0) {
      const placements = assignSeats(layout, occupants).map((placement, order) => ({ ...placement, order }));
      const mobileIndices = placements
        .map((placement, index) => ({ placement, index }))
        .filter(({ placement }) => [2, 3, 4].includes(placement.person.actionStyle) && placement.role !== 'owner')
        .map(({ index }) => index);
      const posed = placements.map((placement, index) => ({
        placement,
        pose: poseFor(placement, {
          time: sceneTime,
          mode,
          mobileRank: mobileIndices.indexOf(index),
          mobileCount: mobileIndices.length,
          layout,
          room: this.room
        })
      }));
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
        if (actor.pose.pose === 'type' || actor.pose.pose === 'sit') seatedSpots.push(actor.pose);
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
        scene.push({
          depth: itemDepth(item),
          paint: () => (plan ? drawPlanItem : drawOfficeItem)(ctx, project, theme, item, itemProgress)
        });
      }
    }

    scene.sort((a, b) => a.depth - b.depth);
    for (const piece of scene) piece.paint();
    if (phase.figures > 0) drawOverflowNote(ctx, theme, this.room, this.model, this.annexIndex, project);

    if (cueOnThisFloor) drawSignatureCue(ctx, this.room, cue, theme, project, this.logicalHeight, time);

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
