// Architectural line-art renderer for the compact desktop overlay.
// Geometry is original and code-drawn, with solid heads and restrained tonal furniture.
// Pure geometry/layout helpers are exported so tests can run them without a DOM.

export const PLATE = Object.freeze({
  gridWidth: 10,
  gridDepth: 10,
  unit: 6.55,
  storey: 3.2,
  thickness: 3,
  logicalWidth: 136,
  logicalHeight: 80,
  centerX: 68,
  top: 4
});

// Transition timeline in milliseconds. Owner-approved: draw 0.8s, slide 0.4s, entry 0.3s.
export const TIMELINE = Object.freeze({
  slide: 400,
  drawStart: 200,
  drawDuration: 800,
  furnitureStart: 600,
  furnitureDuration: 600,
  figureStart: 1_000,
  figureDuration: 300,
  total: 1_300,
  leaving: 600
});

// Grayscale tone set: translucent washes that lift the drawing off a busy desktop.
// Owner asked for these on 2026-08-11; `tone: false` falls back to pure outlines.
// Frosted-paper grayscale: the plate always reads as a light gray sheet, like the
// reference drawing, so the overlay stays legible on any wallpaper.
const INK_TONE = Object.freeze({
  plate: 'rgba(246, 244, 238, .82)',
  slab: 'rgba(52, 46, 38, .22)',
  faceTop: 'rgba(255, 255, 255, .92)',
  faceLeft: 'rgba(52, 46, 38, .12)',
  faceRight: 'rgba(52, 46, 38, .24)',
  figure: 'rgba(255, 255, 255, .95)'
});

const WHITE_TONE = Object.freeze({
  plate: 'rgba(228, 231, 236, .76)',
  slab: 'rgba(96, 104, 116, .55)',
  faceTop: 'rgba(255, 255, 255, .88)',
  faceLeft: 'rgba(70, 78, 90, .18)',
  faceRight: 'rgba(70, 78, 90, .34)',
  figure: 'rgba(255, 255, 255, .92)'
});

export const THEMES = Object.freeze({
  ink: Object.freeze({
    name: 'ink',
    stroke: '#6e655a',
    soft: '#9a907f',
    guide: '#a89c86',
    text: '#6e655a',
    working: '#3d7a5a',
    waiting: '#c4a35a',
    error: '#b54a4a',
    quiet: '#9aa0a6',
    tone: INK_TONE
  }),
  // Dark desktops get a more opaque sheet, but the linework stays graphite either way:
  // white strokes would vanish against the gray wash the Owner asked for.
  white: Object.freeze({
    name: 'white',
    stroke: '#4a5360',
    soft: '#78828f',
    guide: '#8c93a0',
    text: '#3f4753',
    working: '#2f7a58',
    waiting: '#a97c1f',
    error: '#a63f3f',
    quiet: '#7c848f',
    tone: WHITE_TONE
  })
});

// Identity marks stay deliberately away from official brand colours (IP contract).
// The four provider colours are held to one relative luminance band (.158-.174, a 1.10x
// spread) so no team's floor tick reads as more important than another's; the previous
// set spread 1.97x and made the ochre one shout.
export const IDENTITY = Object.freeze({
  owner: '#3e4a5c',
  codex: '#5174a0',
  claude: '#537e54',
  gemini: '#876e37',
  grok: '#915f80',
  lobby: '#7a6a52'
});

// Desk height in storey units. Tall enough that the legs and monitors read at 7% scale.
const DESK_HEIGHT = 1.15;

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

export function ease(value) {
  const t = clamp(value);
  return t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Picks the ink/white sketch theme. Wallpaper luminance wins; system theme is the fallback. */
export function themeFor({ luminance = null, prefersDark = false, lock = 'auto', tone = true } = {}) {
  const base = lock === 'ink' || lock === 'white'
    ? THEMES[lock]
    : Number.isFinite(luminance)
      ? (luminance < .45 ? THEMES.white : THEMES.ink)
      : (prefersDark ? THEMES.white : THEMES.ink);
  return tone ? base : { ...base, tone: null };
}

/** Entering/leaving progress for one plate, derived from elapsed milliseconds. */
export function phaseAt(phase, elapsed) {
  const age = Math.max(0, Number(elapsed) || 0);
  if (phase === 'leaving') {
    const gone = clamp(age / TIMELINE.leaving);
    return { plate: 1 - gone, furniture: 1 - clamp(age / (TIMELINE.leaving * .55)), figures: 1 - clamp(age / (TIMELINE.leaving * .35)), crane: 0, done: gone >= 1 };
  }
  if (phase !== 'entering') return { plate: 1, furniture: 1, figures: 1, crane: 0, done: true };
  const plate = clamp((age - TIMELINE.drawStart) / TIMELINE.drawDuration);
  const furniture = clamp((age - TIMELINE.furnitureStart) / TIMELINE.furnitureDuration);
  const figures = clamp((age - TIMELINE.figureStart) / TIMELINE.figureDuration);
  const crane = age < TIMELINE.slide + 200 ? 1 - clamp((age - TIMELINE.slide) / 200) : 0;
  return { plate, furniture, figures, crane, done: age >= TIMELINE.total };
}

/** 2:1 dimetric projection. gx/gy are floor grid units, gz is height in storey units. */
export function projector({ centerX = PLATE.centerX, top = PLATE.top, unit = PLATE.unit } = {}) {
  return (gx, gy, gz = 0) => [
    centerX + (gx - gy) * unit,
    top + (gx + gy) * unit / 2 - gz * PLATE.storey
  ];
}

/**
 * People stand on a 2-unit floor grid. In the 2:1 projection any two distinct grid points
 * are at least 12.4px apart horizontally or 6.2px vertically, so no two figures can ever
 * merge into one blob. Desks are drawn on the odd coordinates between the grid points.
 */
// Back-to-back desk banks behind an OA screen: the basic unit of an open-plan office.
// Seats are listed in fill order so a small team never lines up head-to-toe.
// Four-person islands in one aligned column, long axis parallel, ends onto the main
// corridor. Spacing keeps the chair-back aisle clear (Codex/GSA space-planning review).
/**
 * A row of three individual desks behind one low screen. Owner, 2026-08-12: an open-plan
 * office here is separate desks, not a shared bench. Seats sit 1.1 grid apart, which is
 * 7.2px apart on screen, so three figures in a row never merge.
 */
function bank(gx, gy) {
  return { gx, gy, seats: [[gx, gy], [gx - 1.35, gy], [gx + 1.35, gy]] };
}

// Islands are separated by their *projected* bounding boxes, not by grid distance: banks
// sharing one gx march down the same 45-degree line and merge into one mass however far
// apart their gy is. These centres sit in the plate's left and front bellies and were
// checked against every seat pair (zero violations of the 6px/5px screen rule).
// Owner, 2026-08-12: a floor holds at most six people, so two islands are enough and the
// figures never have to be shrunk to fit.
const ISLANDS = [bank(1.9, 5.0), bank(7.0, 3.95)];
const HQ_BANKS = ISLANDS;
const WORK_BANKS = ISLANDS;

/** One desk bank seats three: a fourth person opens the second bank. */
export const SEATS_PER_ISLAND = 3;

function bankSeats(bank, pod) {
  // A row faces its own screen, which sits just behind the desks.
  return bank.seats.map(([gx, gy]) => ({ gx, gy, pod, facing: -1, desk: true }));
}

/**
 * Every plate that is an office rather than a lobby. Two variants, because a tower does
 * not repeat its entrance on every storey:
 *
 * - `headquarters` (the single-floor view) is the whole company on one plate, so it keeps
 *   the Owner's room, reception and the huddle.
 * - `work` is one storey of the tower: islands, a huddle, a focus booth and the local
 *   support point. No manager room, no reception -- those live once, downstairs.
 */
function openPlanOffice(room, pods, headquarters) {
  const items = [];
  const seats = [];
  // The office is a six-desk room even when only one person is present. Empty desks are
  // part of the workplace, while the three-person grouping below only decides which row
  // an arriving worker uses first.
  const banks = headquarters ? HQ_BANKS : WORK_BANKS;

  // Support points hug the two back edges rather than the plate's back tip, which is a
  // point with no width: storage down the left edge, print and pantry along the top.
  items.push({ kind: 'lockers', gx: 1.2, gy: 2.7, w: 1.5, d: .7, h: 1.7, doors: 3 });
  items.push({ kind: 'cart', gx: 2.7, gy: .7 });
  items.push({ kind: 'cabinet', gx: 8.2, gy: .7, w: 1.6, d: .8, h: 1.2, shelves: 2 });

  if (headquarters) {
    // Owner's room: compact back corner with its own door onto the cross aisle.
    items.push({ kind: 'wall', x1: 2.8, y1: 0, x2: 2.8, y2: 2.6 });
    items.push({ kind: 'wall', x1: 0, y1: 2.6, x2: 2.8, y2: 2.6, door: [.6, .94] });
    items.push({ kind: 'desk', gx: 1.4, gy: 1.7, w: 1.8, d: .8, monitors: 1, manager: true });
    items.push({ kind: 'chair', gx: 1.4, gy: .8, back: true, facing: 1 });
    seats.push({ gx: 1.4, gy: .8, pod: 0, facing: 1, role: 'manager', desk: true });

    // Reception faces the entrance; it stays empty until somebody is actually hosting.
    items.push({ kind: 'desk', gx: 8.7, gy: 9.2, w: 2.2, d: .8, counter: true });
    seats.push({ gx: 8.7, gy: 8.6, pod: 0, facing: -1, role: 'reception', desk: true });
  } else {
    // Focus booth: the one enclosed room a work floor gets, for private calls and reviews.
    items.push({ kind: 'wall', x1: 8.2, y1: 1.1, x2: 10, y2: 1.1 });
    items.push({ kind: 'wall', x1: 8.2, y1: 1.1, x2: 8.2, y2: 2.6, door: [.6, .92] });
    items.push({ kind: 'chair', gx: 9.1, gy: 1.9, task: true, facing: -1 });
    seats.push({ gx: 9.1, gy: 1.9, pod: 0, facing: -1, role: 'focus' });
  }

  // Six people to a floor leaves room for the parts of an office that are not desks: a
  // lounge by the entrance, and nothing else: two reviewers independently warned that
  // extra props at this scale read as a furniture catalogue, not as a better office.
  // One anchor per zone, drawn big, with air around it. Both reviewers landed on the same
  // rule independently: at this scale a floor reads as a good office through legible zones
  // and circulation, never through the number of props. So the sofa grows, the rug loses
  // its inner border, and the floor keeps a single plant instead of one per corner.
  items.push({ kind: 'sofa', gx: 1.3, gy: 8.4, w: 2.2, d: .95, facing: 1 });
  items.push({ kind: 'plant', gx: 6.4, gy: 8.6 });
  // A doorway on the front edge turns the plate from a display stand into a place.
  items.push({ kind: 'wall', x1: 5.4, y1: 9.6, x2: 8.4, y2: 9.6, door: [.34, .72] });

  // Huddle corner: the informal stand-up spot every floor keeps, with its own board.
  const huddleY = 6.4;
  items.push({ kind: 'meeting', gx: 8.6, gy: huddleY, w: 1.8, d: 1.5 });
  items.push({ kind: 'board', gx: 9.0, gy: huddleY - 1.3, w: 1.5, h: 1.2 });
  items.push({ kind: 'chair', gx: 8.6, gy: huddleY - .9, task: true, facing: 1 });
  items.push({ kind: 'chair', gx: 8.6, gy: huddleY + .9, task: true, facing: -1 });
  seats.push({ gx: 8.6, gy: huddleY - .9, pod: 0, facing: 1, role: 'meet' });
  seats.push({ gx: 8.6, gy: huddleY + .9, pod: 0, facing: -1, role: 'meet' });

  for (const [index, desks] of banks.entries()) {
    // Individual desks, one per person, sharing a low screen along the back of the row.
    // Six desks cover the full floor capacity without scaling any figure.
    for (const seat of bankSeats(desks, index)) {
      items.push({ kind: 'desk', gx: seat.gx, gy: seat.gy - .62, w: 1.0, d: .58, monitors: 1, partition: true, pod: index });
      items.push({ kind: 'chair', gx: seat.gx, gy: seat.gy + .34, task: true, facing: -1 });
      seats.push(seat);
    }
  }
  if (room === 'claude') items.push({ kind: 'stamps', gx: 6.0, gy: 2.0 });
  else if (room === 'grok') items.push({ kind: 'crates', gx: 6.0, gy: 2.0 });
  return {
    items,
    seats,
    // Without a manager's room the floor still needs a destination for the walk cue: the
    // huddle is where a finished worker reports before heading to the Owner.
    manager: headquarters ? { gx: 1.3, gy: .8 } : { gx: 8.6, gy: huddleY - .85 },
    walkway: { gx: 6.6, gy: 9 }
  };
}

/**
 * Office layout for one plate: high furniture on the back walls, two desk banks in the
 * middle, and a clear front walkway to the stairs.
 */
export function officeLayout(room, podCount = 1) {
  const items = [];
  const seats = [];
  const pods = Math.max(1, Math.min(ISLANDS.length, Math.round(podCount) || 1));

  if (room === 'owner') {
    items.push({ kind: 'board', gx: 6.2, gy: .6, w: 2.6, h: 1.5 });
    items.push({ kind: 'cabinet', gx: 1.0, gy: 1.0, w: 1.1, d: 1.5, h: 1.5, shelves: 3 });
    items.push({ kind: 'desk', gx: 4.6, gy: 2.6, w: 3.2, d: 1.6, tray: true, monitors: 1 });
    // The permanent Owner works at the near edge of this desk. The chair shares the exact
    // seat coordinate, so the seated figure replaces it instead of leaving a second chair
    // behind the desk that reads as an unexplained extra occupant.
    items.push({ kind: 'chair', gx: 4.6, gy: 4.0, back: true, facing: -1 });
    items.push({ kind: 'plant', gx: 9.0, gy: 5.0 });
    items.push({ kind: 'chair', gx: 7.0, gy: 7.0 });
    items.push({ kind: 'chair', gx: 8.8, gy: 7.6 });
    seats.push({ gx: 4.6, gy: 4.0, pod: 0, facing: -1, role: 'owner', desk: true });
    seats.push({ gx: 8, gy: 4, pod: 0, facing: -1, role: 'queue' });
    seats.push({ gx: 6, gy: 8, pod: 0, facing: -1, role: 'queue' });
    seats.push({ gx: 8, gy: 6, pod: 0, facing: -1, role: 'queue' });
    seats.push({ gx: 2, gy: 4, pod: 0, facing: 1 });
    return { items, seats, manager: { gx: 4.6, gy: 4.0 }, walkway: { gx: 8, gy: 8 } };
  }

  if (room === 'lobby') {
    // Entrance floor: reception, visitor waiting and the formal meeting room. These exist
    // once in the building and are never copied onto a work floor.
    items.push({ kind: 'cabinet', gx: 1.0, gy: 1.0, w: 1.2, d: 1.4, h: 1.4, shelves: 4 });
    items.push({ kind: 'desk', gx: 4, gy: 3, w: 3.2, d: 1.4, counter: true });
    items.push({ kind: 'chair', gx: 7.0, gy: 5.0 });
    items.push({ kind: 'chair', gx: 8.8, gy: 5.6 });
    items.push({ kind: 'plant', gx: 9.0, gy: 1.0 });
    items.push({ kind: 'mat', gx: 7, gy: 9, w: 1.8, d: 1.0 });
    items.push({ kind: 'meeting', gx: 2.4, gy: 7.4, w: 2.4, d: 2.0 });
    items.push({ kind: 'wall', x1: 0, y1: 5.6, x2: 4.4, y2: 5.6, door: [.72, .96] });
    items.push({ kind: 'wall', x1: 4.4, y1: 5.6, x2: 4.4, y2: 10 });
    // The reception counter has a seat but no resident: a host only appears when there is
    // an Owner, a visitor or something waiting for approval.
    seats.push({ gx: 4, gy: 2, pod: 0, facing: 1, role: 'reception' });
    for (const [index, spot] of [[6, 4], [8, 4], [6, 6], [2, 6]].entries()) {
      seats.push({ gx: spot[0], gy: spot[1], pod: 0, facing: -1, role: index ? 'visitor' : 'meet' });
    }
    seats.push({ gx: .8, gy: 7.0, pod: 0, facing: 1, role: 'meet' });
    seats.push({ gx: 4.0, gy: 7.8, pod: 0, facing: -1, role: 'meet' });
    return { items, seats, manager: { gx: 4, gy: 2 }, walkway: { gx: 8, gy: 8 } };
  }

  // The single-floor view is the whole company on one plate; every other office plate is
  // one storey of the tower.
  return openPlanOffice(room, pods, room === 'all');
}

/** Assigns occupants to seats, keeping every SessionPod at its own island. */
export function assignSeats(layout, occupants) {
  const pool = layout.seats.map((seat, index) => ({ seat, index, taken: false }));
  const roleSeat = (role) => pool.find((entry) => !entry.taken && entry.seat.role === role);
  return occupants.map((person, order) => {
    const podIndex = Number.isFinite(person.podIndex) ? person.podIndex : 0;
    let slot = null;
    if (person.manager) slot = roleSeat('manager') || roleSeat('owner');
    // Reception is a function, not a job: the counter stays empty until somebody is
    // actually hosting an Owner, a visitor or an approval.
    if (!slot && person.hosting) slot = roleSeat('reception');
    if (!slot && person.activity === 'waiting_owner') slot = roleSeat('queue');
    if (!slot) slot = pool.find((entry) => !entry.taken && entry.seat.pod === podIndex && !entry.seat.role);
    if (!slot) slot = pool.find((entry) => !entry.taken && !entry.seat.role);
    if (!slot) slot = pool.find((entry) => !entry.taken);
    if (!slot) {
      const spill = layout.walkway;
      return { person, gx: spill.gx - (order % 3) * .8, gy: spill.gy - Math.floor(order / 3) * .8, facing: -1, role: 'spill' };
    }
    slot.taken = true;
    return { person, gx: slot.seat.gx, gy: slot.seat.gy, facing: slot.seat.facing || 1, role: slot.seat.role || 'seat', desk: slot.seat.desk === true };
  });
}

// ---------------------------------------------------------------------------
// Stroke helpers. Every visual is a stroked polyline so the "drawn by hand"
// transition can render any shape at partial completion.
// ---------------------------------------------------------------------------

function strokePoly(ctx, points, { close = false, width = .7, alpha = 1, color = null, progress = 1 } = {}) {
  if (points.length < 2 || progress <= 0) return;
  const list = close ? [...points, points[0]] : points;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = width;
  if (color) ctx.strokeStyle = color;
  if (progress >= 1) {
    ctx.beginPath();
    ctx.moveTo(list[0][0], list[0][1]);
    for (let index = 1; index < list.length; index += 1) ctx.lineTo(list[index][0], list[index][1]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const lengths = [];
  let total = 0;
  for (let index = 1; index < list.length; index += 1) {
    const span = Math.hypot(list[index][0] - list[index - 1][0], list[index][1] - list[index - 1][1]);
    lengths.push(span);
    total += span;
  }
  let budget = total * clamp(progress);
  ctx.beginPath();
  ctx.moveTo(list[0][0], list[0][1]);
  for (let index = 1; index < list.length && budget > 0; index += 1) {
    const span = lengths[index - 1];
    if (span <= budget) {
      ctx.lineTo(list[index][0], list[index][1]);
      budget -= span;
    } else {
      const ratio = budget / span;
      ctx.lineTo(
        list[index - 1][0] + (list[index][0] - list[index - 1][0]) * ratio,
        list[index - 1][1] + (list[index][1] - list[index - 1][1]) * ratio
      );
      budget = 0;
    }
  }
  ctx.stroke();
  ctx.restore();
}

function strokeLine(ctx, from, to, options = {}) {
  strokePoly(ctx, [from, to], options);
}

function strokeEllipse(ctx, x, y, rx, ry, options = {}) {
  const { width = .55, alpha = 1, color = null } = options;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = width;
  if (color) ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function dot(ctx, x, y, radius, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Axonometric box drawn as visible edges only (top face plus the two lit side edges). */
function boxEdges(project, gx, gy, w, d, h) {
  const hw = w / 2;
  const hd = d / 2;
  const top = [
    project(gx - hw, gy - hd, h),
    project(gx + hw, gy - hd, h),
    project(gx + hw, gy + hd, h),
    project(gx - hw, gy + hd, h)
  ];
  const base = [
    project(gx - hw, gy + hd, 0),
    project(gx + hw, gy + hd, 0),
    project(gx + hw, gy - hd, 0)
  ];
  return { top, base, corners: [top[3], top[2], top[1]] };
}

function fillPoly(ctx, points, color, alpha = 1) {
  if (!color || alpha <= 0 || points.length < 3) return;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0], points[index][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBox(ctx, project, gx, gy, w, d, h, options = {}) {
  const { progress = 1, width = .6, solid = true, tone = null } = options;
  const box = boxEdges(project, gx, gy, w, d, h);
  if (tone && progress > .5) {
    // Grayscale shading: lit top, soft left face, darker right face.
    const wash = clamp((progress - .5) / .5);
    if (solid) {
      fillPoly(ctx, [box.top[3], box.top[2], box.base[1], box.base[0]], tone.faceLeft, wash);
      fillPoly(ctx, [box.top[2], box.top[1], box.base[2], box.base[1]], tone.faceRight, wash);
    }
    fillPoly(ctx, box.top, tone.faceTop, wash);
  }
  strokePoly(ctx, box.top, { close: true, width, progress });
  if (progress < .55) return box;
  const legProgress = clamp((progress - .55) / .45);
  for (const [index, corner] of box.corners.entries()) {
    strokeLine(ctx, corner, box.base[index], { width: width * .82, progress: legProgress });
  }
  // Cabinets and crates are solid volumes; desks are just a top on legs.
  if (solid) strokePoly(ctx, box.base, { width: width * .82, progress: legProgress, alpha: .9 });
  return box;
}

// ---------------------------------------------------------------------------
// Plate, shell and vertical language.
// ---------------------------------------------------------------------------

export function drawPlate(ctx, project, theme, progress = 1) {
  const { gridWidth: gw, gridDepth: gd, thickness } = PLATE;
  const corners = [project(0, 0), project(gw, 0), project(gw, gd), project(0, gd)];
  const lowered = corners.map(([x, y]) => [x, y + thickness]);

  if (theme.tone && progress > .45) {
    const wash = clamp((progress - .45) / .55);
    fillPoly(ctx, [corners[1], corners[2], lowered[2], lowered[1]], theme.tone.slab, wash);
    fillPoly(ctx, [corners[2], corners[3], lowered[3], lowered[2]], theme.tone.slab, wash);
    fillPoly(ctx, corners, theme.tone.plate, wash);
  }

  ctx.strokeStyle = theme.stroke;
  strokePoly(ctx, corners, { close: true, width: .9, progress });

  if (progress > .5) {
    const edgeProgress = clamp((progress - .5) / .5);
    // Slab thickness: the two front edges get a second line plus corner ticks.
    strokePoly(ctx, [lowered[1], lowered[2], lowered[3]], { width: .7, progress: edgeProgress });
    for (const index of [1, 2, 3]) {
      strokeLine(ctx, corners[index], lowered[index], { width: .7, progress: edgeProgress });
    }
  }

  if (progress > .65) {
    const gridProgress = clamp((progress - .65) / .35);
    ctx.save();
    ctx.globalAlpha = .14 * gridProgress;
    for (let step = 2; step < gw; step += 2) strokeLine(ctx, project(step, 0), project(step, gd), { width: .4 });
    for (let step = 2; step < gd; step += 2) strokeLine(ctx, project(0, step), project(gw, step), { width: .4 });
    ctx.restore();
  }
}

export function drawGuides(ctx, project, theme, height, progress = 1) {
  const { gridWidth: gw, gridDepth: gd } = PLATE;
  ctx.save();
  ctx.strokeStyle = theme.guide;
  ctx.globalAlpha = .55 * clamp(progress);
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = .7;
  for (const [gx, gy] of [[0, 0], [gw, 0], [gw, gd], [0, gd]]) {
    const [x, y] = project(gx, gy);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    void y;
  }
  ctx.restore();
}

/** A short flight on the front-left of the plate: the on-plate entry point (spec 2, 垂直語彙). */
export function drawStairs(ctx, project, progress = 1) {
  // Drawn the way a floor plan draws a stair: a flat run of treads with a direction arrow.
  const gx = 1.0;
  const width = 1.5;
  const near = 7.2;
  const treads = 6;
  const run = .38;
  const far = near + treads * run;
  strokePoly(ctx, [
    project(gx, near),
    project(gx + width, near),
    project(gx + width, far),
    project(gx, far)
  ], { close: true, width: .55, progress });
  const lines = clamp((progress - .35) / .65);
  for (let step = 1; step < treads; step += 1) {
    const gy = near + step * run;
    strokeLine(ctx, project(gx, gy), project(gx + width, gy), { width: .4, alpha: .85, progress: clamp(lines * treads - step + 1) });
  }
  const arrow = clamp((progress - .7) / .3);
  if (arrow <= 0) return;
  const mid = gx + width / 2;
  strokeLine(ctx, project(mid, far - .3), project(mid, near + .3), { width: .45, progress: arrow });
  const [tipX, tipY] = project(mid, near + .3);
  const [leftX, leftY] = project(mid - .35, near + .8);
  const [rightX, rightY] = project(mid + .35, near + .8);
  strokePoly(ctx, [[leftX, leftY], [tipX, tipY], [rightX, rightY]], { width: .45, progress: arrow });
}

/** Elevator rail on the right-rear guide plus the shared wireframe cue car. */
export function drawElevator(ctx, project, theme, height, { car = null, progress = 1 } = {}) {
  const [railX] = project(PLATE.gridWidth, 0);
  ctx.save();
  ctx.strokeStyle = theme.soft;
  ctx.globalAlpha = .5 * clamp(progress);
  ctx.lineWidth = .5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(railX + 5, 0);
  ctx.lineTo(railX + 5, height);
  ctx.stroke();
  ctx.restore();
  if (!car) return;
  const carY = clamp(car.position) * (height - 16) + 4;
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.globalAlpha = clamp(progress);
  strokePoly(ctx, [[railX + 1, carY], [railX + 9, carY], [railX + 9, carY + 11], [railX + 1, carY + 11]], { close: true, width: .6 });
  strokeLine(ctx, [railX + 5, carY], [railX + 5, carY - 4], { width: .45, alpha: .7 });
  if (car.occupied) dot(ctx, railX + 5, carY + 3, .7, car.color || theme.working);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Furniture: every piece is a wireframe so it can be "drawn" stroke by stroke.
// ---------------------------------------------------------------------------

/** Pieces appear in sequence so the room assembles itself instead of popping in. */
export function itemProgressFor(index, count, progress) {
  return clamp(progress * Math.max(1, count) * 1.35 - index * .55);
}

/** Painter's-algorithm depth. Furniture and people share one order so nobody stands on a desk. */
export function itemDepth(item) {
  // Walls are drawn from their own span; everything else from its centre.
  if (item.kind === 'wall') return (item.x1 + item.x2 + item.y1 + item.y2) / 2 - 1.2;
  const bias = item.kind === 'board' || item.kind === 'cabinet' ? -.4 : 0;
  return item.gx + item.gy + bias;
}

export function drawOfficeItem(ctx, project, theme, item, progress = 1) {
  if (progress <= 0) return;
  ctx.strokeStyle = theme.stroke;
  switch (item.kind) {
    case 'island': {
      drawBox(ctx, project, item.gx, item.gy, item.w, item.d, DESK_HEIGHT, { progress, width: .7, solid: false, tone: theme.tone });
      const spine = clamp((progress - .45) / .55);
      strokeLine(ctx, project(item.gx - item.w / 2, item.gy, DESK_HEIGHT), project(item.gx + item.w / 2, item.gy, DESK_HEIGHT), { width: .45, alpha: .8, progress: spine });
      for (let index = 0; index < (item.monitors || 0); index += 1) {
        const offset = (item.monitors || 1) === 1 ? 0 : -.5 + index;
        drawMonitor(ctx, project, item.gx + offset, item.gy + ((item.monitors || 1) === 1 ? 0 : index ? .3 : -.3), spine, item.monitorSignal || 0);
      }
      for (let index = 0; index < (item.papers || 0); index += 1) {
        drawPaper(ctx, project, item.gx - .45 + index * .9, item.gy + (index ? .25 : -.25), spine);
      }
      break;
    }
    case 'desk': {
      const height = item.counter ? 1.35 : DESK_HEIGHT;
      const halfWidth = item.w / 2;
      const halfDepth = item.d / 2;
      const top = [
        project(item.gx - halfWidth, item.gy - halfDepth, height),
        project(item.gx + halfWidth, item.gy - halfDepth, height),
        project(item.gx + halfWidth, item.gy + halfDepth, height),
        project(item.gx - halfWidth, item.gy + halfDepth, height)
      ];
      const lip = height - .12;
      const lipped = [
        project(item.gx + halfWidth, item.gy - halfDepth, lip),
        project(item.gx + halfWidth, item.gy + halfDepth, lip),
        project(item.gx - halfWidth, item.gy + halfDepth, lip)
      ];
      if (theme.tone) {
        const wash = clamp((progress - .2) / .8);
        fillPoly(ctx, [top[1], top[2], lipped[1], lipped[0]], theme.tone.faceRight, wash);
        fillPoly(ctx, [top[2], top[3], lipped[2], lipped[1]], theme.tone.faceLeft, wash);
        fillPoly(ctx, top, theme.tone.faceTop, wash);
      }
      // Convention at this scale: one worktop quad, one thin edge line, three visible legs.
      // Cable trays, drawers and modesty panels are dropped - they only add noise.
      strokePoly(ctx, top, { close: true, width: .65, progress });
      const edge = clamp((progress - .35) / .65);
      strokePoly(ctx, [top[1], lipped[0], lipped[1], lipped[2], top[3]], { width: .45, alpha: .9, progress: edge });
      const legs = clamp((progress - .5) / .5);
      for (const [dx, dy] of [[-halfWidth, halfDepth], [halfWidth, halfDepth], [halfWidth, -halfDepth]]) {
        strokeLine(ctx, project(item.gx + dx, item.gy + dy, lip), project(item.gx + dx, item.gy + dy, 0), { width: .5, progress: legs });
      }
      const extras = clamp((progress - .5) / .5);
      // Owner, 2026-08-12: every desk gets its own partition, not one screen shared by a
      // row. Drawing it as part of the desk keeps the workstation a single object: desk,
      // panel, monitor and chair read as one unit instead of four scattered outlines.
      if (item.partition) {
        // A desktop screen, not a wall: tall enough to read as a partition, low enough
        // that a seated figure still stands clear of it. Outline only -- a filled panel
        // behind every desk turned the work zone into one bright slab and swallowed the
        // figures, which is exactly what it is meant to separate.
        const panelGy = item.gy - halfDepth - .04;
        const panel = [
          project(item.gx - halfWidth, panelGy, height - .08),
          project(item.gx + halfWidth, panelGy, height - .08),
          project(item.gx + halfWidth, panelGy, 1.42),
          project(item.gx - halfWidth, panelGy, 1.42)
        ];
        strokePoly(ctx, panel, { close: true, width: .45, progress: clamp((progress - .25) / .75) });
      }
      // A workstation without a screen does not read as a workstation. `monitors` was
      // being passed by every desk bank and silently ignored here, which is why the whole
      // floor looked like a room full of empty tables.
      for (let index = 0; index < (item.monitors || 0); index += 1) {
        const spread = (item.monitors || 1) === 1 ? 0 : -.45 + index * .9;
        drawMonitor(ctx, project, item.gx + spread, item.gy - halfDepth + .12, extras, item.monitorSignal || 0);
      }
      if (item.tray) drawPaper(ctx, project, item.gx + halfWidth - .6, item.gy - .3, extras, true);
      if (item.manager) drawPaper(ctx, project, item.gx - .4, item.gy - .2, extras);
      break;
    }
    case 'cabinet': {
      drawBox(ctx, project, item.gx, item.gy, item.w, item.d, item.h, { progress, width: .65, tone: theme.tone });
      // Convention: the box plus two horizontal lines reads as a drawer unit. Handles,
      // locks and plinths are below the legible size and are dropped.
      const detail = clamp((progress - .55) / .45);
      const front = item.gy + item.d / 2;
      const halfWidth = item.w / 2;
      for (let index = 1; index <= Math.min(2, item.shelves || 0); index += 1) {
        const level = item.h * (index / 3);
        strokeLine(ctx, project(item.gx - halfWidth, front, level), project(item.gx + halfWidth, front, level), { width: .4, alpha: .85, progress: detail });
      }
      break;
    }
    case 'board': {
      const bottom = .9;
      const top = bottom + item.h;
      const left = project(item.gx - item.w / 2, item.gy, bottom);
      const right = project(item.gx + item.w / 2, item.gy, bottom);
      const leftTop = project(item.gx - item.w / 2, item.gy, top);
      const rightTop = project(item.gx + item.w / 2, item.gy, top);
      if (theme.tone) fillPoly(ctx, [left, right, rightTop, leftTop], theme.tone.faceTop, clamp((progress - .4) / .6));
      strokePoly(ctx, [left, right, rightTop, leftTop], { close: true, width: .6, progress });
      // Convention: a blank board face on two legs. Writing, tray and frame are dropped;
      // the two floor legs are what stop it reading as a wall panel or a screen.
      const posts = clamp((progress - .5) / .5);
      strokeLine(ctx, project(item.gx - item.w / 2 + .3, item.gy, bottom), project(item.gx - item.w / 2 + .3, item.gy, 0), { width: .45, alpha: .9, progress: posts });
      strokeLine(ctx, project(item.gx + item.w / 2 - .3, item.gy, bottom), project(item.gx + item.w / 2 - .3, item.gy, 0), { width: .45, alpha: .9, progress: posts });
      break;
    }
    case 'chair': {
      // A real task chair: seat pad, angled backrest, gas post and a five-star base.
      const facing = item.facing === -1 ? -1 : 1;
      const seatLevel = item.task ? .58 : .62;
      const half = .38;
      const backGy = item.gy - facing * half;
      const seat = [
        project(item.gx - half, item.gy - half, seatLevel),
        project(item.gx + half, item.gy - half, seatLevel),
        project(item.gx + half, item.gy + half, seatLevel),
        project(item.gx - half, item.gy + half, seatLevel)
      ];
      if (theme.tone) fillPoly(ctx, seat, theme.tone.faceTop, clamp((progress - .3) / .7));
      strokePoly(ctx, seat, { close: true, width: .5, progress });
      strokePoly(ctx, [
        project(item.gx - half, item.gy + half, seatLevel),
        project(item.gx - half, item.gy + half, seatLevel - .1),
        project(item.gx + half, item.gy + half, seatLevel - .1),
        project(item.gx + half, item.gy + half, seatLevel)
      ], { width: .4, alpha: .8, progress: clamp((progress - .3) / .7) });

      const back = clamp((progress - .45) / .55);
      const backTop = item.back ? 1.95 : item.task ? 1.5 : 1.12;
      // Backrest leans away from the desk, like a chair actually does.
      const lean = facing * .18;
      strokePoly(ctx, [
        project(item.gx - half + .04, backGy, seatLevel + .05),
        project(item.gx + half - .04, backGy, seatLevel + .05),
        project(item.gx + half - .04, backGy - lean, backTop),
        project(item.gx - half + .04, backGy - lean, backTop)
      ], { close: true, width: .5, progress: back });

      // Three chairs, three silhouettes. The old shared three-spoke base crossed under the
      // seat and read as a scribbled X at overlay scale, and only the backrest height told
      // the variants apart -- which at 13px is no difference at all.
      const base = clamp((progress - .6) / .4);
      if (item.task) {
        // Task chair: gas post and a wheeled base drawn as one screen-horizontal bar,
        // because (t, -t) in grid space is exactly horizontal on screen.
        strokeLine(ctx, project(item.gx, item.gy, seatLevel - .08), project(item.gx, item.gy, .14), { width: .5, progress: base });
        strokeLine(ctx, project(item.gx - .34, item.gy + .34, .14), project(item.gx + .34, item.gy - .34, .14), { width: .42, alpha: .9, progress: base });
        for (const side of [-1, 1]) {
          const [wx, wy] = project(item.gx + side * .34, item.gy - side * .34, .14);
          dot(ctx, wx, wy + 1, .38, theme.stroke, base * .9);
        }
      } else {
        // Visitor and stacking chairs stand on four straight legs, no post, no castors.
        for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
          strokeLine(ctx, project(item.gx + dx, item.gy + dy, seatLevel - .06), project(item.gx + dx, item.gy + dy, 0), { width: .42, alpha: .9, progress: base });
        }
      }
      break;
    }
    case 'stamps': {
      // Review station: a low unit with two stacked trays. Colour belongs to the identity
      // bar under a figure's feet and nowhere else, so the old status dots are gone.
      drawBox(ctx, project, item.gx, item.gy, 1.4, .9, .7, { progress, width: .6 });
      const trays = clamp((progress - .6) / .4);
      if (trays > 0) {
        drawPaper(ctx, project, item.gx - .28, item.gy - .08, trays, true);
        drawPaper(ctx, project, item.gx + .34, item.gy + .06, trays);
      }
      break;
    }
    case 'cart': {
      // Print and recycle point: a body tall enough to read as a machine rather than a
      // crate, with the output tray sticking out of its front.
      drawBox(ctx, project, item.gx, item.gy, 1.2, .8, 1.15, { progress, width: .55, tone: theme.tone });
      const detail = clamp((progress - .55) / .45);
      if (detail > 0) {
        drawPaper(ctx, project, item.gx, item.gy + .12, detail, true);
        const front = item.gy + .4;
        strokeLine(ctx, project(item.gx - .5, front, .78), project(item.gx + .5, front, .78), { width: .42, alpha: .85, progress: detail });
        for (const dx of [-.45, .45]) {
          const [wx, wy] = project(item.gx + dx, front, 0);
          strokeEllipse(ctx, wx, wy - .5, .42, .24, { width: .38, alpha: detail });
        }
      }
      break;
    }
    case 'wall': {
      // Partition wall: a full-height panel with a door opening left as a gap.
      const height = 2.3;
      const spans = item.door
        ? [[0, item.door[0]], [item.door[1], 1]]
        : [[0, 1]];
      for (const [from, to] of spans) {
        const ax = item.x1 + (item.x2 - item.x1) * from;
        const ay = item.y1 + (item.y2 - item.y1) * from;
        const bx = item.x1 + (item.x2 - item.x1) * to;
        const by = item.y1 + (item.y2 - item.y1) * to;
        const face = [project(ax, ay, 0), project(bx, by, 0), project(bx, by, height), project(ax, ay, height)];
        if (theme.tone) fillPoly(ctx, face, theme.tone.faceLeft, clamp((progress - .2) / .8));
        strokePoly(ctx, face, { close: true, width: .6, progress });
      }
      if (item.door) {
        // Door head line across the opening keeps the gap reading as a doorway.
        const dx = item.x1 + (item.x2 - item.x1) * item.door[0];
        const dy = item.y1 + (item.y2 - item.y1) * item.door[0];
        const ex = item.x1 + (item.x2 - item.x1) * item.door[1];
        const ey = item.y1 + (item.y2 - item.y1) * item.door[1];
        strokeLine(ctx, project(dx, dy, height), project(ex, ey, height), { width: .45, alpha: .8, progress: clamp((progress - .5) / .5) });
      }
      break;
    }
    case 'screen': {
      // OA screen between back-to-back desks: a low panel on slim feet.
      const height = item.h || 1.15;
      const panel = [
        project(item.gx - item.w / 2, item.gy, .18),
        project(item.gx + item.w / 2, item.gy, .18),
        project(item.gx + item.w / 2, item.gy, height),
        project(item.gx - item.w / 2, item.gy, height)
      ];
      // Convention: one upright face on the centre line between two desk rows. Its
      // position is what identifies it, so frames, fabric and feet are dropped.
      if (theme.tone) fillPoly(ctx, panel, theme.tone.faceLeft, clamp((progress - .3) / .7));
      strokePoly(ctx, panel, { close: true, width: .55, progress });
      break;
    }
    case 'sofa': {
      // Lounge seating: a low seat block with a back slab. Two masses, no cushions -- the
      // silhouette is what says sofa at this size.
      const facing = item.facing === -1 ? -1 : 1;
      drawBox(ctx, project, item.gx, item.gy, item.w, item.d, .52, { progress, width: .55, tone: theme.tone });
      const backGy = item.gy - facing * (item.d / 2 - .12);
      const back = clamp((progress - .45) / .55);
      const panel = [
        project(item.gx - item.w / 2, backGy, .52),
        project(item.gx + item.w / 2, backGy, .52),
        project(item.gx + item.w / 2, backGy, 1.05),
        project(item.gx - item.w / 2, backGy, 1.05)
      ];
      if (theme.tone) fillPoly(ctx, panel, theme.tone.faceLeft, back);
      strokePoly(ctx, panel, { close: true, width: .5, progress: back });
      for (const side of [-1, 1]) {
        const armX = item.gx + side * (item.w / 2 - .1);
        strokeLine(ctx, project(armX, item.gy + item.d / 2 * facing, .52), project(armX, backGy, .78), { width: .42, alpha: .85, progress: back });
      }
      break;
    }
    case 'meeting': {
      const height = item.low ? .58 : DESK_HEIGHT;
      const centre = project(item.gx, item.gy, height);
      const base = project(item.gx, item.gy, 0);
      if (theme.tone) {
        ctx.save();
        ctx.globalAlpha *= clamp((progress - .2) / .8);
        ctx.fillStyle = theme.tone.faceTop;
        ctx.beginPath();
        ctx.ellipse(centre[0], centre[1], item.w * PLATE.unit / 2, item.d * PLATE.unit / 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      const rx = item.w * PLATE.unit / 2;
      const ry = item.d * PLATE.unit / 4;
      strokeEllipse(ctx, centre[0], centre[1], rx, ry, { width: .65, alpha: clamp(progress * 1.4) });
      // A tabletop needs an edge or it reads as a tray lying on the floor: the front half
      // of a second ellipse, dropped by the top's thickness, is the whole trick.
      const edge = clamp((progress - .35) / .65);
      if (edge > 0) {
        ctx.save();
        ctx.globalAlpha *= edge;
        ctx.lineWidth = .5;
        ctx.beginPath();
        ctx.ellipse(centre[0], centre[1] + .55, rx, ry, 0, 0, Math.PI);
        ctx.stroke();
        ctx.restore();
      }
      strokeLine(ctx, [centre[0], centre[1] + .55], [base[0], base[1] - 1], { width: .5, progress: clamp((progress - .5) / .5) });
      strokeEllipse(ctx, base[0], base[1] - 1, rx / 2.6, ry / 2.6, { width: .45, alpha: clamp((progress - .6) / .4) });
      break;
    }
    case 'cubicle': {
      // Low OA screens on the two back sides of the pod: enough to read as a workstation
      // partition without hiding the people working inside it.
      const height = .95;
      const halfWidth = item.w / 2;
      const halfDepth = item.d / 2;
      const back = [
        project(item.gx - halfWidth, item.gy - halfDepth, 0),
        project(item.gx + halfWidth, item.gy - halfDepth, 0),
        project(item.gx + halfWidth, item.gy - halfDepth, height),
        project(item.gx - halfWidth, item.gy - halfDepth, height)
      ];
      const side = [
        project(item.gx - halfWidth, item.gy - halfDepth, 0),
        project(item.gx - halfWidth, item.gy + halfDepth, 0),
        project(item.gx - halfWidth, item.gy + halfDepth, height),
        project(item.gx - halfWidth, item.gy - halfDepth, height)
      ];
      if (theme.tone) {
        const wash = clamp((progress - .3) / .7);
        fillPoly(ctx, back, theme.tone.faceLeft, wash);
        fillPoly(ctx, side, theme.tone.faceRight, wash);
      }
      strokePoly(ctx, back, { close: true, width: .55, progress });
      strokePoly(ctx, side, { close: true, width: .5, progress: clamp(progress * 1.4 - .3), alpha: .9 });
      break;
    }
    case 'lockers': {
      drawBox(ctx, project, item.gx, item.gy, item.w, item.d, item.h, { progress, width: .6, tone: theme.tone });
      const doors = clamp((progress - .55) / .45);
      const front = item.gy + item.d / 2;
      const count = item.doors || 3;
      const halfWidth = item.w / 2;
      // Convention: repeated vertical door joints are what make it a locker run.
      // Hinges, handles and kick plates are dropped at this size.
      for (let index = 1; index < count; index += 1) {
        const gx = item.gx - halfWidth + (item.w * index) / count;
        strokeLine(ctx, project(gx, front, 0), project(gx, front, item.h), { width: .4, alpha: .85, progress: doors });
      }
      break;
    }
    case 'crates': {
      drawBox(ctx, project, item.gx, item.gy, 1.1, .9, .7, { progress, width: .55 });
      drawBox(ctx, project, item.gx - .35, item.gy - .55, .9, .7, 1.4, { progress: clamp((progress - .35) / .65), width: .5 });
      break;
    }
    case 'plant': {
      // Small potted plant: tapered pot on the floor, three short leaves off its rim.
      const rim = .42;
      const pot = [
        project(item.gx - .3, item.gy - .3, rim),
        project(item.gx + .3, item.gy - .3, rim),
        project(item.gx + .22, item.gy + .22, 0),
        project(item.gx - .22, item.gy + .22, 0)
      ];
      strokePoly(ctx, pot, { close: true, width: .5, progress });
      const leaves = clamp((progress - .5) / .5);
      if (leaves <= 0) break;
      const [stemX, stemY] = project(item.gx, item.gy, rim);
      // Leaves are curved, not straight: three strokes off one stem read as foliage, while
      // the straight version read as a scribbled asterisk at overlay scale.
      strokeLine(ctx, [stemX, stemY], [stemX, stemY - 1.6], { width: .45, progress: leaves });
      ctx.save();
      ctx.globalAlpha *= leaves;
      ctx.lineWidth = .42;
      ctx.lineCap = 'round';
      for (const [dx, dy, cx, cy] of [[-1.7, -2.6, -1.7, -1.1], [1.6, -2.9, 1.5, -1.4], [-.2, -3.6, -1.1, -2.6]]) {
        ctx.beginPath();
        ctx.moveTo(stemX, stemY - 1.2);
        ctx.quadraticCurveTo(stemX + cx, stemY + cy - 1.2, stemX + dx, stemY + dy);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'mat': {
      const points = [
        project(item.gx - item.w / 2, item.gy - item.d / 2),
        project(item.gx + item.w / 2, item.gy - item.d / 2),
        project(item.gx + item.w / 2, item.gy + item.d / 2),
        project(item.gx - item.w / 2, item.gy + item.d / 2)
      ];
      strokePoly(ctx, points, { close: true, width: .45, alpha: .7, progress });
      // A single outline on the floor is just a rectangle; the inset border is what makes
      // it read as an entrance mat. A rug under furniture skips it: the extra line only
      // collides with sofa legs and reads as noise.
      if (item.rug) break;
      const inset = clamp((progress - .5) / .5);
      strokePoly(ctx, [
        project(item.gx - item.w / 2 + .18, item.gy - item.d / 2 + .12),
        project(item.gx + item.w / 2 - .18, item.gy - item.d / 2 + .12),
        project(item.gx + item.w / 2 - .18, item.gy + item.d / 2 - .12),
        project(item.gx - item.w / 2 + .18, item.gy + item.d / 2 - .12)
      ], { close: true, width: .35, alpha: .55, progress: inset });
      break;
    }
    default:
      break;
  }
}

function drawMonitor(ctx, project, gx, gy, progress, signal = 0) {
  if (progress <= 0) return;
  const footTop = DESK_HEIGHT + .04;
  const bottom = DESK_HEIGHT + .34;
  const top = bottom + .95;
  const panel = [
    project(gx - .46, gy, bottom),
    project(gx + .46, gy, bottom),
    project(gx + .46, gy, top),
    project(gx - .46, gy, top)
  ];
  // Convention: one 16:9 face, one neck, one foot. No bezel, buttons or cables.
  strokePoly(ctx, panel, { close: true, width: .5, progress });
  const stand = clamp((progress - .5) / .5);
  strokeLine(ctx, project(gx, gy, bottom), project(gx, gy, footTop), { width: .45, progress: stand });
  strokeLine(ctx, project(gx - .28, gy, footTop), project(gx + .28, gy, footTop), { width: .42, progress: stand });
  if (signal > 0) {
    const level = bottom + .22 + clamp(signal) * .38;
    strokeLine(ctx, project(gx - .28, gy, level), project(gx + .18, gy, level), {
      width: .38,
      alpha: .45 + clamp(signal) * .45,
      progress: clamp((progress - .55) / .45)
    });
  }
}

function drawPaper(ctx, project, gx, gy, progress, tray = false) {
  if (progress <= 0) return;
  const level = DESK_HEIGHT + .02;
  const points = [
    project(gx - .32, gy - .24, level),
    project(gx + .32, gy - .24, level),
    project(gx + .32, gy + .24, level),
    project(gx - .32, gy + .24, level)
  ];
  strokePoly(ctx, points, { close: true, width: .42, progress });
  if (tray) strokePoly(ctx, points.map(([x, y]) => [x, y - 1]), { close: true, width: .38, alpha: .7, progress });
}

// ---------------------------------------------------------------------------
// Figure A: the architect-scale line figure, 13px tall.
// One drawing language only:
// a solid head over a round-capped single-line skeleton. The old closed grey torso
// and the chest identity dot are gone -- three competing syntaxes in a 13px body is
// what made the figure ugly. Identity now sits on the floor under the feet (spec §3),
// where it never distorts the anatomy and reads the same in every pose.
// ---------------------------------------------------------------------------

const FIGURE = Object.freeze({
  // 13.3px total = 2.5 head + .95 neck gap + 3.6 shoulder-to-hip + 6.25 hip-to-floor.
  // The spec's 13.0 assumed the head sitting straight on the shoulders; a graphite
  // disc that close to the yoke merges into one blob, so the neck gap earns its .3px.
  headRadius: 1.25,
  neckGap: .95,
  torso: 3.6,
  hipY: -6.25,
  seatY: -3.8,
  shoulderHalf: 1.8,
  shoulderDrop: .25,
  hipHalf: .62,
  leg: 6.25,
  upperArm: 2.05,
  foreArm: 2.05,
  // Spine, limbs and props: three widths, never mixed inside one part. The figure
  // stays about 1.25x heavier than the .6-.7px furniture line so people read first.
  spineWidth: .95,
  limbWidth: .8,
  propWidth: .5,
  // Foreshortened: 26 degrees of true stride reads as splits in a 2:1 dimetric view.
  strideDegrees: 20
});

const RADIANS = Math.PI / 180;

/**
 * Two-bone limb solved from the hand, not from joint angles: a pose is authored where
 * it has to read -- hands on the keyboard, under the box, clear of the crown -- and the
 * elbow follows. `bow` picks the side the elbow breaks towards. Out-of-reach targets
 * pull the hand in rather than stretching the arm.
 */
function reach(sx, sy, tx, ty, upper, fore, bow = 1) {
  const raw = Math.hypot(tx - sx, ty - sy) || .01;
  const span = Math.min(raw, upper + fore - .03);
  const ux = (tx - sx) / raw;
  const uy = (ty - sy) / raw;
  const along = (upper * upper - fore * fore + span * span) / (2 * span);
  const off = Math.sqrt(Math.max(0, upper * upper - along * along)) * bow;
  return [
    [sx, sy],
    [sx + ux * along - uy * off, sy + uy * along + ux * off],
    [sx + ux * span, sy + uy * span]
  ];
}

export function drawFigure(ctx, x, baseline, theme, options = {}) {
  const {
    pose = 'stand',
    swing = 0,
    lean = 0,
    identity = null,
    alpha = 1,
    facing = 1,
    carry = false,
    scale = 1
  } = options;
  if (alpha <= 0) return;
  const sit = pose === 'sit' || pose === 'type' || pose === 'drink';
  const walk = pose === 'walk';
  // The renderer sends +-.55 for a walk cycle; map that onto the stride angle.
  const stride = walk ? clamp(swing / .55, -1, 1) * FIGURE.strideDegrees : 0;

  ctx.save();
  ctx.translate(x, baseline);
  ctx.scale(scale * (facing < 0 ? -1 : 1), scale);
  ctx.globalAlpha *= clamp(alpha);
  ctx.strokeStyle = theme.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Identity lives on the floor, not on the body: a tick under the feet keeps every
  // provider at the same visual weight and survives every pose unchanged (spec §3).
  // Round caps add .7 to the drawn length, so the centre line is 2.3 for a 3.0 mark.
  if (identity) strokeLine(ctx, [-1.15, 1.35], [1.15, 1.35], { width: .7, color: identity, alpha: .85 });

  // Legs swing about the hip, so a full stride lowers the whole body: no floating,
  // no rubber legs. Sitting drops the hip to seat height instead.
  const hipY = sit ? FIGURE.seatY : FIGURE.hipY + FIGURE.leg * (1 - Math.cos(stride * RADIANS));
  const neckY = hipY - FIGURE.torso;
  const neckX = lean * .35;
  const tipY = neckY + FIGURE.shoulderDrop;

  const walkLeg = (degrees, hipX) => {
    const angle = degrees * RADIANS;
    return [
      [hipX, hipY],
      [hipX + FIGURE.leg / 2 * Math.sin(angle) + .22, hipY + FIGURE.leg / 2 * Math.cos(angle)],
      [hipX + FIGURE.leg * Math.sin(angle), 0]
    ];
  };

  // Knees sit slightly ahead of the hip-to-foot line: about 173 degrees standing, 95
  // seated, which is what stops the legs reading as two struts or two pipes. The two
  // seated shins are kept 1.2px apart, or they merge into one horizontal bar.
  const legs = sit
    ? [[[-FIGURE.hipHalf, hipY], [2.15, hipY + .25], [2, -.15]], [[FIGURE.hipHalf, hipY], [3.4, hipY + .48], [3.2, 0]]]
    : walk
      ? [walkLeg(-stride, -.45), walkLeg(stride, .45)]
      : [[[-FIGURE.hipHalf, hipY], [-.7, -3.2], [-1.15, 0]], [[FIGURE.hipHalf, hipY], [1.22, -3.25], [1.45, 0]]];

  // Arms hang off the shoulder tips, so they have to follow the lean with the yoke.
  const far = neckX - FIGURE.shoulderHalf;
  const near = neckX + FIGURE.shoulderHalf;
  let arms;
  let prop = null;
  if (carry) {
    // The box is the action cue, so both hands sit under it at 95-100 degree elbows,
    // close enough to the chest that the arms actually wrap it.
    arms = [reach(far, tipY + .1, .35, tipY + 2.4, FIGURE.upperArm, FIGURE.foreArm, 1), reach(near, tipY, 3.5, tipY + 2.5, FIGURE.upperArm, FIGURE.foreArm, 1)];
    prop = [[.35, tipY + .55], [3.75, tipY + .55], [3.75, tipY + 2.6], [.35, tipY + 2.6]];
  } else if (pose === 'raise') {
    // Asking the Owner: one arm only, upper arm 70 degrees up, forearm vertical, hand
    // clearing the crown. Angles are explicit here because the reach is at the limit.
    const elbow = [near + FIGURE.upperArm * Math.cos(70 * RADIANS), tipY - FIGURE.upperArm * Math.sin(70 * RADIANS)];
    arms = [
      reach(far, tipY, -1.5, -5.6, FIGURE.upperArm, FIGURE.foreArm, 1),
      [[near, tipY], elbow, [elbow[0] - .12, elbow[1] - FIGURE.foreArm - .2]]
    ];
  } else if (pose === 'drink') {
    // A cup is drawn by the renderer at the hand. The raised near arm supplies a distinct
    // silhouette while the far arm stays hidden by the same three-quarter seated rule.
    arms = [null, reach(near, tipY, 4.25, neckY - 1.4, FIGURE.upperArm, FIGURE.foreArm, 1)];
  } else if (sit) {
    // Seated is drawn three-quarter, so the far arm is behind the torso and simply not
    // drawn. Every version that did draw it either crossed the spine into a closed
    // triangle or collided with the backrest; at 13px the omission reads as depth.
    const jitter = pose === 'type' ? swing * .18 : 0;
    arms = pose === 'type'
      ? [null, reach(near, tipY, 3.6, -4.8 - jitter, FIGURE.upperArm, FIGURE.foreArm, 1)]
      : [null, reach(near, tipY, 3, -4.55, FIGURE.upperArm, FIGURE.foreArm, 1)];
  } else if (walk) {
    // The legs carry the walk; the arms only counter-swing a little. In a flattened
    // pictogram the arms already start a shoulder-width apart, so a full-size swing
    // reads as arms held out sideways rather than as forward and back.
    const swingX = -stride * .017;
    arms = [
      reach(far, tipY, -1.5 - swingX, -5.6, FIGURE.upperArm, FIGURE.foreArm, 1),
      reach(near, tipY, 1.5 + swingX, -5.58, FIGURE.upperArm, FIGURE.foreArm, -1)
    ];
  } else {
    // At rest the hands gather towards the hips but keep daylight either side of the
    // spine, and the two arms differ slightly: a mirror-perfect stance reads dead.
    // The hand height is what sets the elbow: this lands it at 156-158 degrees.
    arms = [
      reach(far, tipY, -1.5 + swing * .5, -5.6 + Math.abs(swing) * .45, FIGURE.upperArm, FIGURE.foreArm, 1),
      reach(near, tipY, 1.5 + swing * .6, -5.58 + Math.abs(swing) * .5, FIGURE.upperArm, FIGURE.foreArm, -1)
    ];
  }

  // A seated figure carries its own seat symbol, which is why the renderer drops the
  // chair underneath it: a seat pan below the thighs and a back that keeps a clear
  // pixel off the spine, so it never reads as a second backbone.
  if (sit) {
    ctx.save();
    ctx.globalAlpha *= .75;
    ctx.lineWidth = FIGURE.propWidth;
    ctx.beginPath();
    ctx.moveTo(1.6, hipY + .85);
    ctx.lineTo(-2.5, hipY + .85);
    ctx.quadraticCurveTo(-2.95, neckY + 1.5, -2.7, neckY + .05);
    ctx.stroke();
    ctx.restore();
  }

  // Painter's order: far limbs, spine, near limbs, carried prop, then the solid head.
  strokePoly(ctx, legs[0], { width: FIGURE.limbWidth });
  if (arms[0]) strokePoly(ctx, arms[0], { width: FIGURE.limbWidth });
  strokeLine(ctx, [neckX, neckY], [0, hipY], { width: FIGURE.spineWidth });
  strokePoly(ctx, [[-FIGURE.shoulderHalf + neckX, tipY], [neckX, neckY], [FIGURE.shoulderHalf + neckX, tipY]], { width: FIGURE.limbWidth });
  strokeLine(ctx, [-FIGURE.hipHalf, hipY], [FIGURE.hipHalf, hipY], { width: FIGURE.limbWidth });
  strokePoly(ctx, legs[1], { width: FIGURE.limbWidth });
  if (prop) strokePoly(ctx, prop, { close: true, width: FIGURE.propWidth });
  strokePoly(ctx, arms[1], { width: FIGURE.limbWidth });

  // The head is the only solid mass in the figure, which is what gives a 13px line
  // skeleton a readable silhouette at overlay scale.
  ctx.save();
  ctx.fillStyle = theme.stroke;
  ctx.beginPath();
  ctx.arc(neckX + lean * .25, neckY - FIGURE.neckGap - FIGURE.headRadius, FIGURE.headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** Small paper label with the "?" mark used by the Owner request cue. */
/**
 * The request tag hangs to the figure's upper right, never straight up: directly above a
 * figure is where the person on the seat behind them is standing.
 */
export function drawQuestionTag(ctx, x, y, theme, alpha = 1) {
  const left = x + 3.4;
  const top = y - 7.4;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.strokeStyle = theme.waiting;
  strokePoly(ctx, [
    [left, top],
    [left + 8, top],
    [left + 8, top + 7.4],
    [left + 2.6, top + 7.4],
    [left + .4, top + 9.6],
    [left + .9, top + 7.4],
    [left, top + 7.4]
  ], { close: true, width: .65 });
  ctx.fillStyle = theme.waiting;
  ctx.font = 'bold 5.6px "Microsoft JhengHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('?', left + 4, top + 5.6);
  ctx.restore();
}

export function drawNamePlate(ctx, theme, text, statusColor, y, { alpha = 1, pulse = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.fillStyle = theme.text;
  ctx.font = '7px "Microsoft JhengHei", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 3, y);
  const width = ctx.measureText(text).width;
  if (statusColor) dot(ctx, 3 + width + 4.5, y - 2.4, 2, statusColor, pulse);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Flat plan mode: a straight top-down architectural floor plan of the same layout.
// Same grid, same furniture data, different drawing convention.
// ---------------------------------------------------------------------------

export const PLAN = Object.freeze({
  cellWidth: 11.6,
  cellHeight: 6.1,
  left: 9,
  top: 8,
  wall: 2.2
});

export function planProjector() {
  return (gx, gy) => [PLAN.left + gx * PLAN.cellWidth, PLAN.top + gy * PLAN.cellHeight];
}

function planRect(project, gx, gy, w, d) {
  const [x0, y0] = project(gx - w / 2, gy - d / 2);
  const [x1, y1] = project(gx + w / 2, gy + d / 2);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export function drawPlanPlate(ctx, project, theme, progress = 1) {
  const outer = [project(0, 0), project(PLATE.gridWidth, 0), project(PLATE.gridWidth, PLATE.gridDepth), project(0, PLATE.gridDepth)];
  const inner = [
    [outer[0][0] + PLAN.wall, outer[0][1] + PLAN.wall],
    [outer[1][0] - PLAN.wall, outer[1][1] + PLAN.wall],
    [outer[2][0] - PLAN.wall, outer[2][1] - PLAN.wall],
    [outer[3][0] + PLAN.wall, outer[3][1] - PLAN.wall]
  ];
  if (theme.tone && progress > .4) {
    const wash = clamp((progress - .4) / .6);
    fillPoly(ctx, outer, theme.tone.plate, wash);
    fillPoly(ctx, [outer[0], outer[1], inner[1], inner[0]], theme.tone.slab, wash);
    fillPoly(ctx, [outer[1], outer[2], inner[2], inner[1]], theme.tone.slab, wash);
    fillPoly(ctx, [outer[2], outer[3], inner[3], inner[2]], theme.tone.slab, wash);
    fillPoly(ctx, [outer[3], outer[0], inner[0], inner[3]], theme.tone.slab, wash);
  }
  ctx.strokeStyle = theme.stroke;
  strokePoly(ctx, outer, { close: true, width: .9, progress });
  strokePoly(ctx, inner, { close: true, width: .6, progress: clamp(progress * 1.3 - .3) });
  if (progress > .6) {
    const grid = clamp((progress - .6) / .4);
    ctx.save();
    ctx.globalAlpha = .16 * grid;
    for (let step = 2; step < PLATE.gridWidth; step += 2) strokeLine(ctx, project(step, 0), project(step, PLATE.gridDepth), { width: .4 });
    for (let step = 2; step < PLATE.gridDepth; step += 2) strokeLine(ctx, project(0, step), project(PLATE.gridWidth, step), { width: .4 });
    ctx.restore();
    // Door opening on the front wall, drawn the way a plan shows a swing door.
    const [doorX, doorY] = project(7.4, PLATE.gridDepth);
    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.globalAlpha = grid;
    ctx.lineWidth = .55;
    ctx.beginPath();
    ctx.moveTo(doorX, doorY - PLAN.wall);
    ctx.lineTo(doorX + 9, doorY - PLAN.wall);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(doorX, doorY - PLAN.wall, 9, -Math.PI / 2, 0);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawPlanItem(ctx, project, theme, item, progress = 1) {
  if (progress <= 0) return;
  ctx.strokeStyle = theme.stroke;
  const hatch = (points, gapPixels = 2.4) => {
    if (!theme.tone) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0], points[index][1]);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = .5;
    ctx.strokeStyle = theme.soft;
    ctx.lineWidth = .35;
    const minX = Math.min(...points.map((point) => point[0]));
    const maxX = Math.max(...points.map((point) => point[0]));
    const minY = Math.min(...points.map((point) => point[1]));
    const maxY = Math.max(...points.map((point) => point[1]));
    for (let x = minX - (maxY - minY); x < maxX; x += gapPixels) {
      ctx.beginPath();
      ctx.moveTo(x, maxY);
      ctx.lineTo(x + (maxY - minY), minY);
      ctx.stroke();
    }
    ctx.restore();
  };

  switch (item.kind) {
    case 'island':
    case 'desk': {
      const box = planRect(project, item.gx, item.gy, item.w, item.d);
      if (theme.tone) fillPoly(ctx, box, theme.tone.faceTop, clamp(progress * 1.4));
      strokePoly(ctx, box, { close: true, width: .6, progress });
      // Monitor edge marks so a desk reads as a workstation in plan.
      const marks = clamp((progress - .5) / .5);
      for (let index = 0; index < (item.monitors || (item.manager ? 1 : 0)); index += 1) {
        const gx = item.gx - .45 + index * .9;
        strokeLine(ctx, project(gx - .3, item.gy - item.d / 2 + .06), project(gx + .3, item.gy - item.d / 2 + .06), { width: .8, progress: marks });
      }
      break;
    }
    case 'cubicle': {
      const half = { w: item.w / 2, d: item.d / 2 };
      strokeLine(ctx, project(item.gx - half.w, item.gy - half.d), project(item.gx + half.w, item.gy - half.d), { width: 1.4, progress, alpha: .85 });
      strokeLine(ctx, project(item.gx - half.w, item.gy - half.d), project(item.gx - half.w, item.gy + half.d * .6), { width: 1.4, progress: clamp(progress * 1.5 - .4), alpha: .85 });
      break;
    }
    case 'cabinet':
    case 'lockers': {
      const box = planRect(project, item.gx, item.gy, item.w, item.d);
      if (theme.tone) fillPoly(ctx, box, theme.tone.faceTop, clamp(progress * 1.4));
      hatch(box);
      strokePoly(ctx, box, { close: true, width: .6, progress });
      break;
    }
    case 'board': {
      strokeLine(ctx, project(item.gx - item.w / 2, item.gy), project(item.gx + item.w / 2, item.gy), { width: 1.6, progress });
      break;
    }
    case 'chair': {
      const [cx, cy] = project(item.gx, item.gy);
      ctx.save();
      ctx.globalAlpha *= clamp(progress);
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = .5;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + .6, 3.1, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'stamps':
    case 'cart':
    case 'crates': {
      const box = planRect(project, item.gx, item.gy, 1.0, 1.0);
      if (theme.tone) fillPoly(ctx, box, theme.tone.faceTop, clamp(progress * 1.4));
      strokePoly(ctx, box, { close: true, width: .5, progress });
      break;
    }
    case 'plant': {
      const [cx, cy] = project(item.gx, item.gy);
      ctx.save();
      ctx.globalAlpha *= clamp(progress);
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = .45;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
      ctx.stroke();
      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * 1, cy + Math.sin(angle) * 1);
        ctx.lineTo(cx + Math.cos(angle) * 2.5, cy + Math.sin(angle) * 2.5);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'mat': {
      const box = planRect(project, item.gx, item.gy, item.w, item.d);
      strokePoly(ctx, box, { close: true, width: .45, alpha: .7, progress });
      break;
    }
    case 'sofa': {
      // Plan convention: the seat outline with the back drawn as a heavier edge.
      const box = planRect(project, item.gx, item.gy, item.w, item.d);
      if (theme.tone) fillPoly(ctx, box, theme.tone.faceTop, clamp(progress * 1.4));
      strokePoly(ctx, box, { close: true, width: .55, progress });
      const facing = item.facing === -1 ? -1 : 1;
      const backGy = item.gy - facing * item.d / 2;
      strokeLine(ctx, project(item.gx - item.w / 2, backGy), project(item.gx + item.w / 2, backGy), { width: .75, alpha: .9, progress: clamp((progress - .4) / .6) });
      break;
    }
    case 'meeting': {
      // Round tables are circles in plan, at their real diameter.
      const [cx, cy] = project(item.gx, item.gy);
      const radius = Math.max(1.6, (item.w || 1.8) * PLAN.cellWidth / 2);
      if (theme.tone) {
        ctx.save();
        ctx.globalAlpha *= clamp(progress * 1.4);
        ctx.fillStyle = theme.tone.faceTop;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      strokeEllipse(ctx, cx, cy, radius, radius, { width: .55, alpha: clamp(progress * 1.4) });
      break;
    }
    case 'wall': {
      // Walls are the plan's structure: two spans with the doorway left open.
      const spans = item.door ? [[0, item.door[0]], [item.door[1], 1]] : [[0, 1]];
      for (const [from, to] of spans) {
        const ax = item.x1 + (item.x2 - item.x1) * from;
        const ay = item.y1 + (item.y2 - item.y1) * from;
        const bx = item.x1 + (item.x2 - item.x1) * to;
        const by = item.y1 + (item.y2 - item.y1) * to;
        strokeLine(ctx, project(ax, ay), project(bx, by), { width: .8, progress });
      }
      break;
    }
    default:
      break;
  }
}

/** Stair symbol in plan: a run of treads with the direction arrow, drawn to scale. */
export function drawPlanStairs(ctx, project, theme, progress = 1) {
  const box = planRect(project, 1.9, 8.4, 1.6, 2.4);
  if (theme.tone) fillPoly(ctx, box, theme.tone.faceTop, clamp(progress * 1.4));
  strokePoly(ctx, box, { close: true, width: .55, progress });
  const treads = clamp((progress - .3) / .7);
  for (let index = 1; index < 6; index += 1) {
    const gy = 8.4 - 1.2 + (2.4 * index) / 6;
    strokeLine(ctx, project(1.1, gy), project(2.7, gy), { width: .4, alpha: .85, progress: clamp(treads * 6 - index + 1) });
  }
  const arrow = clamp((progress - .7) / .3);
  if (arrow <= 0) return;
  strokeLine(ctx, project(1.9, 9.4), project(1.9, 7.4), { width: .5, progress: arrow });
  const [tipX, tipY] = project(1.9, 7.4);
  strokePoly(ctx, [[tipX - 2, tipY + 3], [tipX, tipY], [tipX + 2, tipY + 3]], { width: .5, progress: arrow });
}

/** People in plan are the standard circle-with-shoulders symbol, not little bodies. */
export function drawPlanFigure(ctx, x, y, theme, { identity = null, alpha = 1, facing = 1, tag = false } = {}) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  // In plan the circle is the head seen from above, so identity tints the whole disc
  // instead of sitting as a dot inside it: same rule as the axonometric figure, which
  // keeps no badge inside a body.
  if (identity || theme.tone) {
    ctx.save();
    ctx.globalAlpha *= identity ? .55 : 1;
    ctx.fillStyle = identity || theme.tone.figure;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = .6;
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.stroke();
  // Shoulder arc shows which way the person is facing.
  ctx.beginPath();
  ctx.arc(x, y + facing * 1.1, 3.4, facing > 0 ? Math.PI * .2 : Math.PI * 1.2, facing > 0 ? Math.PI * .8 : Math.PI * 1.8);
  ctx.lineWidth = .5;
  ctx.stroke();
  ctx.restore();
  if (tag) drawQuestionTag(ctx, x + 1, y - 2, theme, alpha);
}

/** Hoist crane used while a new floor slides into place. */
export function drawCrane(ctx, project, theme, strength) {
  if (strength <= 0) return;
  const [hookX] = project(PLATE.gridWidth / 2, PLATE.gridDepth / 2);
  const [, plateTop] = project(0, 0);
  ctx.save();
  ctx.globalAlpha *= clamp(strength);
  ctx.strokeStyle = theme.soft;
  strokePoly(ctx, [[hookX - 34, 1], [hookX - 34, plateTop - 6], [hookX - 30, plateTop - 4]], { width: .7 });
  strokeLine(ctx, [hookX - 34, 2], [hookX + 4, 2], { width: .7 });
  strokeLine(ctx, [hookX, 2], [hookX, plateTop - 7], { width: .5 });
  strokePoly(ctx, [[hookX - 2.5, plateTop - 7], [hookX + 2.5, plateTop - 7], [hookX, plateTop - 3.5]], { close: true, width: .5 });
  ctx.restore();
}
