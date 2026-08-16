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
  SEATS_PER_ISLAND,
  themeFor,
  THEMES,
  TIMELINE
} from '../resources/js/sketch.js';

/**
 * Minimal canvas stand-in that records what the figure actually draws, in figure-local
 * units, so the geometry rules can be asserted without a DOM.
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

const POSES = ['stand', 'sit', 'type', 'drink', 'walk', 'raise'];

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

test('plate keeps the approved shallow office plus attached-room proportions', () => {
  assert.equal(PLATE.logicalWidth, 160);
  assert.equal(PLATE.logicalHeight, 100);
  assert.equal(PLATE.mainWidth, 10);
  const project = projector();
  const [topX, topY] = project(0, 0);
  const [rightX] = project(PLATE.gridWidth, 0);
  const [leftX] = project(0, PLATE.gridDepth);
  const [, bottomY] = project(PLATE.gridWidth, PLATE.gridDepth);
  // Near top-down perspective: the accepted office stays readable and widens slightly
  // toward the entrance instead of collapsing into the rejected diamond tile.
  assert.equal(Math.round(rightX - leftX), 134);
  assert.equal(Math.round(bottomY - topY), 72);
  assert.ok(leftX >= 0 && rightX <= PLATE.logicalWidth, 'plate must fit the canvas width');
  assert.ok(bottomY + PLATE.thickness < PLATE.logicalHeight, 'name plate row must stay clear');
});

test('every office floor keeps six individual desks in two three-seat banks', () => {
  const rows = (layout) => [...new Set(layout.items.filter((item) => item.kind === 'desk' && Number.isInteger(item.pod)).map((item) => item.pod))];
  const pods = (layout) => new Set(layout.items.filter((item) => item.kind === 'desk' && Number.isInteger(item.pod)).map((item) => item.pod));
  assert.equal(rows(officeLayout('codex', 1)).length, 2);
  const many = rows(officeLayout('codex', 3)).length;
  assert.equal(many, 2);
  assert.deepEqual([...pods(officeLayout('codex', 3))], [...Array(many).keys()]);
  for (let people = 1; people <= FLOOR_WORKSTATIONS; people += 1) {
    const requiredBanks = Math.ceil(people / SEATS_PER_ISLAND);
    const layout = officeLayout('codex', requiredBanks);
    const desks = layout.items.filter((item) => item.kind === 'desk' && Number.isInteger(item.pod));
    assert.ok(desks.length >= people, `${people} people need at least ${people} work desks`);
    assert.equal(desks.length, FLOOR_WORKSTATIONS);
  }
  // Every seat in a bank gets its own workstation desk and task chair.
  const triple = officeLayout('codex', 3);
  const bankSeatCount = triple.seats.filter((seat) => !seat.role).length;
  // One desk and one screen per person.
  assert.equal(triple.items.filter((item) => item.kind === 'desk' && Number.isInteger(item.pod)).length, bankSeatCount);
  assert.ok(triple.items.filter((item) => item.kind === 'chair' && item.task).length >= bankSeatCount);
  const centres = triple.items.filter((item) => item.kind === 'desk' && Number.isInteger(item.pod)).map((item) => `${item.gx}:${item.gy}`);
  assert.equal(new Set(centres).size, centres.length, 'no two desks share a spot');
});

test('every floor is laid out as an office, not scattered props', () => {
  for (const room of ['all', 'codex', 'claude', 'gemini', 'grok']) {
    const layout = officeLayout(room, 2);
    const kinds = layout.items.map((item) => item.kind);
    assert.ok(kinds.includes('board'), `${room} needs a whiteboard`);
    assert.ok(kinds.includes('cabinet') && kinds.includes('lockers'), `${room} needs storage`);
    // Every workstation carries its own partition, drawn as part of the desk.
    const workDesks = layout.items.filter((item) => item.kind === 'desk' && Number.isInteger(item.pod));
    assert.ok(workDesks.length > 0 && workDesks.every((item) => item.partition === true), `${room} needs a partition on every desk`);
    assert.ok(kinds.includes('meeting'), `${room} needs a huddle table`);
    assert.ok(kinds.includes('cart'), `${room} needs its print and recycle point`);
    // One desk per person, never a desk nobody can sit at.
    assert.equal(kinds.filter((kind) => kind === 'desk').length >= FLOOR_WORKSTATIONS, true, `${room} needs a desk per person`);
    // Fewer, larger objects: the compact plate cannot carry thirty-odd separate outlines.
    assert.ok(layout.items.length <= 30, `${room} draws ${layout.items.length} objects, too many for the plate`);
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
    assert.equal(layout.seats.filter((seat) => !seat.role).length, FLOOR_WORKSTATIONS, `${room} seats exactly the six people a floor shows`);
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
  const ownerDesk = owner.items.find((item) => item.kind === 'desk' && item.tray);
  const ownerSeat = owner.seats.find((seat) => seat.role === 'owner');
  const ownerChair = owner.items.find((item) => item.kind === 'chair' && item.back);
  assert.ok(ownerDesk, 'Owner room needs the inbox tray');
  assert.equal(ownerDesk.monitors, 1, 'Owner works at a visible computer');
  assert.deepEqual([ownerSeat.gx, ownerSeat.gy, ownerSeat.facing], [ownerChair.gx, ownerChair.gy, ownerChair.facing], 'Owner and the task chair share one desk position');
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
  const bankOne = layout.items.filter((item) => item.kind === 'desk' && item.pod === 1)[0];
  for (const entry of placed.slice(2)) {
    assert.ok(Math.abs(entry.gx - bankOne.gx) <= 2.8 && Math.abs(entry.gy - bankOne.gy) <= 1.2, 'pod members sit at their own bank');
  }
  const seats = placed.map((entry) => `${entry.gx}:${entry.gy}`);
  assert.equal(new Set(seats).size, seats.length, 'nobody shares a seat');
});

test('dynamic first floor draws only occupied workstations and keeps the meeting room permanent', () => {
  const owner = { id: 'owner', provider: 'owner', podIndex: -1 };
  const project = [
    { id: 'main', provider: 'codex', zone: 'base', podIndex: 0, manager: true },
    { id: 'helper', provider: 'claude', zone: 'base', podIndex: 0 }
  ];
  const idle = officeLayout('owner', 1, { occupants: [owner, ...project] });
  assert.equal(idle.design, 'first-floor');
  assert.equal(idle.items.filter((item) => item.kind === 'desk' && item.monitors).length, 3, 'Owner plus two actual workers need exactly three workstations');
  assert.equal(idle.seats.filter((seat) => seat.role === 'meeting').length, 4, 'meeting room always keeps four shared chairs');
  const ownerSeat = idle.seats.find((seat) => seat.role === 'owner');
  assert.ok(ownerSeat.gx < 4.35 && ownerSeat.gy > 5.5, 'Owner stays in the approved lower-left office, clear of the entrance');
  assert.ok(idle.items.some((item) => item.kind === 'meeting' && item.gx > 10), 'the permanent four-way room stays attached on the right');
  assert.equal(idle.items.filter((item) => item.kind === 'desk' && item.pod === 0).length, 2, 'a small project occupies only its own upper-left slot');
  assert.ok(idle.items.filter((item) => item.kind === 'meeting').every((item) => item.alpha < .5), 'idle meeting room is faint');

  const active = officeLayout('owner', 1, { occupants: [owner, ...project, { id: 'guest', meeting: true }] });
  assert.ok(active.items.filter((item) => item.kind === 'meeting').every((item) => item.alpha === 1), 'active meeting room returns to normal contrast');
  const empty = officeLayout('owner', 1, { occupants: [owner] });
  assert.equal(empty.items.filter((item) => item.kind === 'desk' && item.monitors).length, 1, 'unused small-project slots never leave empty work desks');
});

test('dynamic execution floor has one supervisor desk, six staff desks and three rest seats', () => {
  const supervisor = { id: 'lead', provider: 'grok', supervisor: true, manager: true };
  const workers = Array.from({ length: 6 }, (_, index) => ({ id: `w${index}`, provider: 'codex' }));
  const resting = Array.from({ length: 3 }, (_, index) => ({ id: `r${index}`, resting: true }));
  const full = officeLayout('codex', 1, { occupants: [supervisor, ...workers, ...resting] });
  assert.equal(full.design, 'execution');
  assert.equal(full.items.filter((item) => item.kind === 'desk' && item.monitors).length, 7);
  assert.equal(full.seats.filter((seat) => seat.role === 'manager').length, 1);
  assert.equal(full.seats.filter((seat) => seat.role === 'rest').length, 3);
  assert.ok(full.manager.gx < 4.9, 'supervisor stays left of the central doorway');
  assert.ok(full.manager.gy > full.s3Seat[1], 'supervisor is behind S3');

  const partial = officeLayout('codex', 1, { occupants: [supervisor, ...workers.slice(0, 2)] });
  assert.equal(partial.items.filter((item) => item.kind === 'desk' && item.monitors).length, 3, 'no vacant employee desk is drawn');
  const placed = assignSeats(full, [supervisor, ...workers, ...resting]);
  assert.equal(placed.find((entry) => entry.person.id === 'lead').role, 'manager');
  assert.ok(placed.filter((entry) => entry.person.resting).every((entry) => entry.role === 'rest'));
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

test('the figure stays grayscale except for one tiny chest identity dot', () => {
  for (const pose of POSES) {
    const ctx = figureStrokes({ pose });
    assert.equal(ctx.fills.length, 1, `${pose}: exactly one coloured dot`);
    assert.equal(ctx.fills[0].color, IDENTITY.codex, `${pose}: identity only colours the dot`);
    const [dotX, dotY, dotRadius] = ctx.fills[0].points[0];
    assert.ok(dotRadius < .7, `${pose}: chest dot must stay tiny`);
    assert.ok(dotY < -5 && dotY > -10, `${pose}: dot belongs on the chest`);
    assert.ok(Math.abs(dotX) < 1, `${pose}: chest dot stays near the spine`);
    assert.equal(ctx.strokes.some((stroke) => stroke.color === IDENTITY.codex), false, `${pose}: outlines stay grayscale`);
    const head = ctx.strokes.find((stroke) => stroke.points.length === 1 && stroke.points[0].length === 4 && stroke.points[0][2] >= 1.2);
    assert.ok(head, `${pose}: head is an outline, not a coloured fill`);

    // One line-width vocabulary per figure: a spine class, a limb class, a prop class.
    const body = ctx.strokes;
    const widths = new Set(body.map((stroke) => stroke.width));
    assert.ok(widths.size <= 3, `${pose}: ${widths.size} line widths inside one figure`);
    for (const width of widths) assert.ok(width > .4 && width <= 1, `${pose}: stray line width ${width}`);
  }

  // 13px class: head crown to floor, with the neck gap that keeps the head readable.
  const standing = figureStrokes({ pose: 'stand' });
  const head = standing.strokes.find((stroke) => stroke.points.length === 1 && stroke.points[0].length === 4 && stroke.points[0][2] >= 1.2);
  const crown = head.points[0][1] - head.points[0][2];
  assert.ok(crown > -13.7 && crown < -12.8, `figure crown at ${crown.toFixed(2)}`);
  const soles = Math.max(...standing.strokes.flatMap((stroke) => stroke.points.map(([, y]) => y)));
  assert.ok(soles >= 0, 'feet still meet the floor');

  // Plan mode also keeps its full outline gray and uses only a tiny identity dot.
  const plan = recordingContext();
  drawPlanFigure(plan, 0, 0, THEMES.ink, { identity: IDENTITY.grok });
  assert.equal(plan.fills.length, 1, 'plan figure has one tiny filled dot');
  assert.equal(plan.fills[0].color, IDENTITY.grok, 'plan identity colours only the dot');
  assert.ok(plan.fills[0].points[0][2] < 1, 'plan identity does not fill the whole head');
});

test('knees and elbows keep their spec angles, and no limb is a straight strut', () => {
  // Legs are the limbs that end on the floor; everything else at limb width is an arm.
  const kneeBands = { stand: [163, 177], walk: [163, 177], 'walk-back': [163, 177], sit: [92, 108], type: [92, 108], drink: [92, 108], raise: [163, 177], carry: [163, 177] };
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
    assert.equal(arms.length, ['sit', 'type', 'drink'].includes(pose) ? 1 : 2, `${pose}: wrong arm count`);
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
  const darkDesktop = themeFor({ luminance: .1 });
  assert.equal(darkDesktop.tone.plate, 'rgba(28, 32, 37, .2)', 'fallback plate remains translucent over a working desktop');
  assert.equal(darkDesktop.stroke, '#c7ccd0', 'fallback linework stays grayscale');
  for (const theme of Object.values(THEMES)) {
    for (const key of ['stroke', 'soft', 'guide', 'text', 'working', 'waiting', 'error', 'quiet']) {
      assert.match(theme[key], /^#[0-9a-f]{6}$/, `${theme.name}.${key} must be a hex colour`);
    }
  }
});
