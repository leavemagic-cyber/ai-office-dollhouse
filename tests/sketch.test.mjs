import assert from 'node:assert/strict';
import { FLOOR_WORKSTATIONS } from '../resources/js/floor-layout.js';
import test from 'node:test';

import {
  assignSeats,
  drawFigure,
  drawPlanFigure,
  IDENTITY,
  officeLayout,
  phaseAt,
  PLATE,
  projector,
  themeFor,
  THEMES,
  TIMELINE
} from '../resources/js/sketch.js';

/**
 * Minimal canvas stand-in that records what the figure actually draws, in figure-local
 * units, so the geometry rules in artifacts/v4-sketch/CODEX_FIGURE_DESIGN_SPEC can be
 * asserted without a DOM.
 */
function recordingContext() {
  const strokes = [];
  const fills = [];
  const stack = [];
  let matrix = { sx: 1, sy: 1, tx: 0, ty: 0 };
  let path = [];
  const at = (x, y) => [matrix.tx + x * matrix.sx, matrix.ty + y * matrix.sy];
  return {
    strokes,
    fills,
    lineWidth: 1,
    globalAlpha: 1,
    strokeStyle: null,
    fillStyle: null,
    lineCap: null,
    lineJoin: null,
    save() {
      stack.push({ ...matrix, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, fillStyle: this.fillStyle });
    },
    restore() {
      const previous = stack.pop();
      if (!previous) return;
      matrix = { sx: previous.sx, sy: previous.sy, tx: previous.tx, ty: previous.ty };
      this.lineWidth = previous.lineWidth;
      this.globalAlpha = previous.globalAlpha;
      this.strokeStyle = previous.strokeStyle;
      this.fillStyle = previous.fillStyle;
    },
    translate(x, y) {
      matrix = { ...matrix, tx: matrix.tx + x * matrix.sx, ty: matrix.ty + y * matrix.sy };
    },
    scale(sx, sy) {
      matrix = { ...matrix, sx: matrix.sx * sx, sy: matrix.sy * sy };
    },
    beginPath() {
      path = [];
    },
    moveTo(x, y) {
      path.push(at(x, y));
    },
    lineTo(x, y) {
      path.push(at(x, y));
    },
    quadraticCurveTo(cx, cy, x, y) {
      path.push(at(cx, cy), at(x, y));
    },
    arc(x, y, radius) {
      path.push([...at(x, y), radius * Math.abs(matrix.sx)]);
    },
    ellipse(x, y, rx, ry) {
      path.push([...at(x, y), rx, ry]);
    },
    stroke() {
      strokes.push({ points: [...path], width: this.lineWidth, color: this.strokeStyle });
    },
    fill() {
      fills.push({ points: [...path], color: this.fillStyle });
    },
    setLineDash() {}
  };
}

const POSES = ['stand', 'sit', 'type', 'walk', 'raise'];

function figureStrokes(options = {}) {
  const ctx = recordingContext();
  drawFigure(ctx, 0, 0, THEMES.ink, { identity: IDENTITY.codex, ...options });
  return ctx;
}

/** Interior angle in degrees at the middle vertex of a three-point limb. */
function jointAngle([a, b, c]) {
  const first = [a[0] - b[0], a[1] - b[1]];
  const second = [c[0] - b[0], c[1] - b[1]];
  const cosine = (first[0] * second[0] + first[1] * second[1]) / (Math.hypot(...first) * Math.hypot(...second));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

test('plate keeps the frozen 7% overlay proportions', () => {
  assert.equal(PLATE.logicalWidth, 136);
  assert.equal(PLATE.logicalHeight, 80);
  const project = projector();
  const [topX, topY] = project(0, 0);
  const [rightX] = project(PLATE.gridWidth, 0);
  const [leftX] = project(0, PLATE.gridDepth);
  const [, bottomY] = project(PLATE.gridWidth, PLATE.gridDepth);
  // 2:1 dimetric: the plate is twice as wide as it is tall and sits inside the canvas.
  assert.equal(Math.round(rightX - leftX), 131);
  assert.equal(Math.round(bottomY - topY), 66);
  assert.ok(leftX >= 0 && rightX <= PLATE.logicalWidth, 'plate must fit the canvas width');
  assert.ok(bottomY + PLATE.thickness < PLATE.logicalHeight, 'name plate row must stay clear');
});

test('floors grow one desk bank per live SessionPod', () => {
  const screens = (layout) => layout.items.filter((item) => item.kind === 'island');
  const pods = (layout) => new Set(layout.items.filter((item) => item.kind === 'island' && Number.isInteger(item.pod)).map((item) => item.pod));
  assert.equal(screens(officeLayout('codex', 1)).length, 1);
  const many = screens(officeLayout('codex', 3)).length;
  assert.ok(many >= 2, 'more pods open more desk banks');
  assert.deepEqual([...pods(officeLayout('codex', 3))], [...Array(many).keys()]);
  // Every seat in a bank gets its own workstation desk and task chair.
  const triple = officeLayout('codex', 3);
  const bankSeatCount = triple.seats.filter((seat) => !seat.role).length;
  // One bench per island now, not one table per seat.
  assert.equal(triple.items.filter((item) => item.kind === 'island').length, many);
  assert.ok(triple.items.filter((item) => item.kind === 'chair' && item.task).length >= bankSeatCount);
  const centres = screens(triple).map((item) => `${item.gx}:${item.gy}`);
  assert.equal(new Set(centres).size, many, 'each bank sits in its own place');
});

test('every floor is laid out as an office, not scattered props', () => {
  for (const room of ['all', 'codex', 'claude', 'gemini', 'grok']) {
    const layout = officeLayout(room, 2);
    const kinds = layout.items.map((item) => item.kind);
    assert.ok(kinds.includes('board'), `${room} needs a whiteboard`);
    assert.ok(kinds.includes('cabinet') && kinds.includes('lockers'), `${room} needs storage`);
    assert.ok(kinds.includes('island'), `${room} needs bench desking`);
    assert.ok(kinds.includes('meeting'), `${room} needs a huddle table`);
    assert.ok(kinds.includes('cart'), `${room} needs its print and recycle point`);
    assert.ok(kinds.filter((kind) => kind === 'island').length >= 2, `${room} needs two desk banks`);
    // Fewer, larger objects: a 136x80 plate cannot carry thirty-odd separate outlines.
    assert.ok(layout.items.length <= 28, `${room} draws ${layout.items.length} objects, too many for the plate`);
    const walls = layout.items.filter((item) => item.kind === 'wall');
    assert.ok(walls.filter((wall) => Array.isArray(wall.door)).length >= 1, `${room} needs a doorway`);
    for (const item of layout.items) {
      if (item.kind === 'wall') continue;
      assert.ok(item.gx < PLATE.gridWidth - .5 && item.gy < PLATE.gridDepth - .5, `${room} must stay inside the plate`);
    }
  }

  // A tower does not repeat its entrance on every storey: the manager's room and the
  // reception counter exist once, and a work floor gets a focus booth instead.
  for (const room of ['codex', 'claude', 'gemini', 'grok']) {
    const layout = officeLayout(room, 3);
    assert.equal(layout.items.some((item) => item.kind === 'desk' && item.manager), false, `${room} must not copy the manager room`);
    assert.equal(layout.seats.some((seat) => seat.role === 'manager'), false, `${room} must not copy the manager seat`);
    assert.equal(layout.seats.some((seat) => seat.role === 'reception'), false, `${room} must not copy reception`);
    assert.ok(layout.seats.some((seat) => seat.role === 'focus'), `${room} needs a focus booth`);
    // Owner, 2026-08-12: six people to a floor, so two islands cover it with a spare desk
    // or two and the figures never get shrunk to fit.
    assert.equal(layout.seats.filter((seat) => seat.desk).length, 8, `${room} seats two islands of four`);
    assert.ok(layout.seats.filter((seat) => seat.desk).length >= FLOOR_WORKSTATIONS, 'a floor seats everyone it will show');
  }

  const hq = officeLayout('all', 3);
  assert.ok(hq.items.some((item) => item.kind === 'desk' && item.manager), 'the single-floor view keeps the Owner room');
  assert.ok(hq.seats.some((seat) => seat.role === 'manager'), 'the single-floor view keeps the Owner seat');
  assert.ok(hq.seats.some((seat) => seat.role === 'reception'), 'the single-floor view keeps reception');
  // Reception is a function, not a resident: nobody is seated there by default.
  const hosted = assignSeats(hq, [{ id: 'a', podIndex: 0, manager: false, activity: 'working' }]);
  assert.notEqual(hosted[0].role, 'reception', 'a worker never lands at the reception counter');
  assert.equal(assignSeats(hq, [{ id: 'h', podIndex: 0, hosting: true, activity: 'idle' }])[0].role, 'reception', 'a host does');

  const lobby = officeLayout('lobby', 1);
  assert.ok(lobby.items.some((item) => item.kind === 'meeting'), 'the entrance floor keeps the formal meeting room');
  assert.ok(lobby.seats.some((seat) => seat.role === 'reception'), 'the entrance floor keeps reception');

  const owner = officeLayout('owner', 1);
  assert.ok(owner.items.some((item) => item.kind === 'desk' && item.tray), 'Owner room needs the inbox tray');
  assert.ok(owner.items.filter((item) => item.kind === 'chair').length >= 3, 'Owner room needs the waiting chairs');
  assert.ok(owner.seats.filter((seat) => seat.role === 'queue').length >= 2, 'Owner room needs a request queue');
  assert.ok(officeLayout('claude', 1).items.some((item) => item.kind === 'stamps'), 'Claude floor needs the stamp station');
});

test('seat assignment keeps each pod at its own desk bank', () => {
  const layout = officeLayout('codex', 2);
  const occupants = [
    { id: 'a', podIndex: 0, manager: false, activity: 'working' },
    { id: 'b', podIndex: 0, manager: false, activity: 'working' },
    { id: 'c', podIndex: 1, manager: false, activity: 'working' },
    { id: 'd', podIndex: 1, manager: false, activity: 'working' }
  ];
  const placed = assignSeats(layout, occupants);
  assert.equal(placed.length, 4);
  const bankOne = layout.items.filter((item) => item.kind === 'island')[1];
  for (const entry of placed.slice(2)) {
    assert.ok(Math.abs(entry.gx - bankOne.gx) <= 1.2 && Math.abs(entry.gy - bankOne.gy) <= 1.2, 'pod members sit at their own bank');
  }
  const seats = placed.map((entry) => `${entry.gx}:${entry.gy}`);
  assert.equal(new Set(seats).size, seats.length, 'nobody shares a seat');
});

test('no two seats land on the same spot once projected to the screen', () => {
  const project = projector();
  for (const room of ['owner', 'lobby', 'codex', 'claude', 'gemini', 'grok']) {
    for (const pods of [1, 2, 3]) {
      const layout = officeLayout(room, pods);
      const points = layout.seats.map((seat) => ({ seat, point: project(seat.gx, seat.gy) }));
      for (let a = 0; a < points.length; a += 1) {
        for (let b = a + 1; b < points.length; b += 1) {
          const dx = Math.abs(points[a].point[0] - points[b].point[0]);
          const dy = Math.abs(points[a].point[1] - points[b].point[1]);
          // A 13px figure is about 5px wide: closer than this and two people merge.
          assert.ok(dx >= 6 || dy >= 5, `${room}/${pods}: seats overlap on screen (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)})`);
        }
      }
    }
  }
});

test('a small team never lines up head-to-toe in one screen column', () => {
  const project = projector();
  for (const room of ['owner', 'codex', 'claude']) {
    const layout = officeLayout(room, 2);
    const occupants = [
      { id: 'a', podIndex: 0, manager: false, activity: 'working' },
      { id: 'b', podIndex: 0, manager: false, activity: 'working' },
      { id: 'c', podIndex: 1, manager: false, activity: 'working' }
    ];
    const placed = assignSeats(layout, occupants).map((entry) => project(entry.gx, entry.gy));
    for (let a = 0; a < placed.length; a += 1) {
      for (let b = a + 1; b < placed.length; b += 1) {
        const dx = Math.abs(placed[a][0] - placed[b][0]);
        const dy = Math.abs(placed[a][1] - placed[b][1]);
        // A 13px figure stacked 12.4px behind another reads as one smudge; keep them apart.
        assert.ok(dx >= 6 || dy >= 14, `${room}: two of three figures stack (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)})`);
      }
    }
  }
});

test('seats stay on the plate, clear of the desks they belong to', () => {
  for (const room of ['all', 'owner', 'lobby', 'codex', 'claude', 'gemini', 'grok']) {
    const layout = officeLayout(room, 3);
    for (const seat of layout.seats) {
      assert.ok(seat.gx >= .4 && seat.gx <= PLATE.gridWidth - .4, `${room}: seat off the plate in x`);
      assert.ok(seat.gy >= .2 && seat.gy <= PLATE.gridDepth - .4, `${room}: seat off the plate in y`);
    }
    // Tables and counters count too: a chair inside the huddle table is as wrong as a
    // chair inside a desk, and that is exactly how reception and huddle first collided.
    for (const item of layout.items.filter((entry) => ['island', 'desk', 'cabinet', 'meeting', 'lockers', 'sofa'].includes(entry.kind))) {
      const halfWidth = (item.w || 1) / 2;
      const halfDepth = (item.d || 1) / 2;
      for (const seat of layout.seats) {
        const inside = Math.abs(seat.gx - item.gx) < halfWidth && Math.abs(seat.gy - item.gy) < halfDepth;
        assert.equal(inside, false, `${room}: a seat sits inside the ${item.kind}`);
      }
    }
  }
});

test('seat assignment never drops people when the roster overflows', () => {
  const layout = officeLayout('codex', 3);
  const occupants = Array.from({ length: 14 }, (_, index) => ({ id: `p${index}`, podIndex: index % 3, manager: false, activity: 'working' }));
  const placed = assignSeats(layout, occupants);
  assert.equal(placed.length, 14);
  for (const entry of placed) assert.ok(Number.isFinite(entry.gx) && Number.isFinite(entry.gy));
});

test('the figure keeps one drawing language: solid head, line skeleton, colour on the floor', () => {
  for (const pose of POSES) {
    const ctx = figureStrokes({ pose });
    // Exactly one filled mass, and it is the head above the shoulders. The closed grey
    // torso and the chest identity dot are what made the old figure ugly (spec §1/§2).
    assert.equal(ctx.fills.length, 1, `${pose}: only the head may be solid`);
    const [headX, headY, headRadius] = ctx.fills[0].points[0];
    assert.ok(headRadius >= 1.2 && headRadius <= 1.3, `${pose}: head diameter out of the 2.4-2.6 band`);
    assert.ok(headY < -8, `${pose}: the solid mass must be the head, not the chest`);
    assert.ok(Math.abs(headX) < 1, `${pose}: the head sits over the spine`);

    const identityStrokes = ctx.strokes.filter((stroke) => stroke.color === IDENTITY.codex);
    assert.equal(identityStrokes.length, 1, `${pose}: one identity mark only`);
    for (const [, y] of identityStrokes[0].points) {
      assert.ok(y >= 1, `${pose}: identity belongs on the floor, clear of the feet`);
    }

    // One line-width vocabulary per figure: a spine class, a limb class, a prop class.
    const body = ctx.strokes.filter((stroke) => stroke.color !== IDENTITY.codex);
    const widths = new Set(body.map((stroke) => stroke.width));
    assert.ok(widths.size <= 3, `${pose}: ${widths.size} line widths inside one figure`);
    for (const width of widths) assert.ok(width > .4 && width <= 1, `${pose}: stray line width ${width}`);
  }

  // 13px class: head crown to floor, with the neck gap that keeps the head readable.
  const standing = figureStrokes({ pose: 'stand' });
  const crown = standing.fills[0].points[0][1] - standing.fills[0].points[0][2];
  assert.ok(crown > -13.7 && crown < -12.8, `figure crown at ${crown.toFixed(2)}`);
  const soles = Math.max(...standing.strokes.filter((stroke) => stroke.color !== IDENTITY.codex).flatMap((stroke) => stroke.points.map(([, y]) => y)));
  const mark = standing.strokes.find((stroke) => stroke.color === IDENTITY.codex).points[0][1];
  assert.ok(mark - soles >= 1, 'the identity mark keeps clear of the sole line');

  // In plan the circle is the head from above, so identity tints the disc itself.
  const plan = recordingContext();
  drawPlanFigure(plan, 0, 0, THEMES.ink, { identity: IDENTITY.grok });
  assert.equal(plan.fills.length, 1, 'plan figure has one filled disc');
  assert.equal(plan.fills[0].color, IDENTITY.grok, 'plan identity tints the whole disc');
});

test('knees and elbows keep their spec angles, and no limb is a straight strut', () => {
  // Legs are the limbs that end on the floor; everything else at limb width is an arm.
  const kneeBands = { stand: [163, 177], walk: [163, 177], 'walk-back': [163, 177], sit: [92, 108], type: [92, 108], raise: [163, 177], carry: [163, 177] };
  for (const pose of [...POSES, 'walk-back', 'carry']) {
    const ctx = figureStrokes(
      pose === 'carry' ? { pose: 'walk', carry: true, swing: .3 }
        : pose === 'walk-back' ? { pose: 'walk', swing: -.55 }
          : { pose, swing: pose === 'walk' ? .55 : 0 }
    );
    const joints = ctx.strokes.filter((stroke) => stroke.points.length === 3 && stroke.width === .8);
    // The shoulder yoke is also a three-point limb-width polyline: its two ends sit at
    // the same height with the neck peaking between them, which no arm ever does.
    const yoke = ([start, middle, end]) => Math.abs(start[1] - end[1]) < 1e-9 && middle[1] < start[1];
    const legs = joints.filter((joint) => joint.points[2][1] > -.5);
    const arms = joints.filter((joint) => joint.points[2][1] <= -.5 && !yoke(joint.points));
    assert.equal(legs.length, 2, `${pose}: two legs must reach the floor`);
    // Seated figures are three-quarter views: the far arm is behind the torso.
    assert.equal(arms.length, ['sit', 'type'].includes(pose) ? 1 : 2, `${pose}: wrong arm count`);
    const [low, high] = kneeBands[pose];
    for (const leg of legs) {
      const knee = jointAngle(leg.points);
      assert.ok(knee >= low && knee <= high, `${pose}: knee at ${knee.toFixed(1)} degrees`);
    }
    for (const arm of arms) {
      const elbow = jointAngle(arm.points);
      // Resting arms 155-170, working arms 80-105: never a strut, never a set square.
      assert.ok(elbow > 80 && elbow < 172, `${pose}: elbow at ${elbow.toFixed(1)} degrees`);
    }
  }
});

test('facing flips the whole figure, so a seated worker never faces backwards', () => {
  const right = figureStrokes({ pose: 'type', facing: 1 });
  const left = figureStrokes({ pose: 'type', facing: -1 });
  assert.equal(right.strokes.length, left.strokes.length);
  for (const [index, stroke] of right.strokes.entries()) {
    for (const [point, [x, y]] of stroke.points.entries()) {
      assert.ok(Math.abs(left.strokes[index].points[point][0] + x) < 1e-9, `stroke ${index} point ${point} is not mirrored`);
      assert.ok(Math.abs(left.strokes[index].points[point][1] - y) < 1e-9, `stroke ${index} point ${point} moved vertically`);
    }
  }
});

test('transition timeline matches the approved 0.8 / 0.4 / 0.3 second beats', () => {
  assert.equal(TIMELINE.drawDuration, 800);
  assert.equal(TIMELINE.slide, 400);
  assert.equal(TIMELINE.figureDuration, 300);
  assert.ok(TIMELINE.total <= 1_500, 'a floor must finish arriving within 1.5s');

  const start = phaseAt('entering', 0);
  assert.equal(start.plate, 0);
  assert.equal(start.figures, 0);
  assert.ok(start.crane > 0, 'the hoist shows while the floor slides in');

  const mid = phaseAt('entering', 700);
  assert.ok(mid.plate > 0 && mid.plate < 1, 'the plate is still being drawn');
  assert.equal(mid.figures, 0, 'people only arrive after the room exists');

  const settled = phaseAt('entering', TIMELINE.total);
  assert.equal(settled.plate, 1);
  assert.equal(settled.figures, 1);
  assert.equal(settled.done, true);

  const resident = phaseAt('resident', 999_999);
  assert.deepEqual([resident.plate, resident.furniture, resident.figures], [1, 1, 1]);
});

test('leaving reverses the drawing and finishes inside its window', () => {
  const early = phaseAt('leaving', 60);
  assert.ok(early.plate < 1 && early.plate > 0);
  assert.ok(early.figures < early.plate, 'people leave before the room is erased');
  const gone = phaseAt('leaving', TIMELINE.leaving);
  assert.equal(gone.plate, 0);
  assert.equal(gone.done, true);
});

test('sketch theme follows wallpaper luminance, then the system scheme', () => {
  assert.equal(themeFor({ luminance: .82 }).name, 'ink');
  assert.equal(themeFor({ luminance: .12 }).name, 'white');
  assert.equal(themeFor({ luminance: null, prefersDark: true }).name, 'white');
  assert.equal(themeFor({ luminance: null, prefersDark: false }).name, 'ink');
  // A dark wallpaper wins even when the system reports a light scheme.
  assert.equal(themeFor({ luminance: .1, prefersDark: false }).name, 'white');
  assert.equal(themeFor({ luminance: .1, lock: 'ink' }).name, 'ink');
  for (const theme of Object.values(THEMES)) {
    for (const key of ['stroke', 'soft', 'guide', 'text', 'working', 'waiting', 'error', 'quiet']) {
      assert.match(theme[key], /^#[0-9a-f]{6}$/, `${theme.name}.${key} must be a hex colour`);
    }
  }
});
