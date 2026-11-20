// Physics tests (steps 3 to 5). Run with:  node tests/physics.test.js
// These test src/physics.js only. No WebGL is involved.

import { test, assert, assertClose, assertAllFinite, report } from './harness.js';
import {
  createLeaf, setLeafValues, stepLeaf, leafRadius, spawnLeaves, createWind, windName,
} from '../src/physics.js';
import {
  WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_DT, LEAF_START,
  LEAF_COUNT, MAX_LEAVES, LEAF_SEED, LEAF_SCALE_MIN, LEAF_SCALE_MAX,
  FRICTION, WIND_MAX_SPEED, WIND_START,
} from '../src/config.js';

const TOL = 1e-9;
const HALF_W = WORLD_WIDTH / 2;    // 800
const HALF_H = WORLD_HEIGHT / 2;   // 450
// Radius of the circle around a scale-1 leaf: half its diagonal, about 23.32 units.
const R1 = 0.5 * Math.sqrt(LEAF_WIDTH * LEAF_WIDTH + LEAF_HEIGHT * LEAF_HEIGHT);

function leafAt(values) {
  return createLeaf({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, scale: 1, ...values });
}

// ---------- Config values from the specs ----------

test('MAX_DT is 1/30 second', () => {
  assertClose(MAX_DT, 1 / 30, TOL, 'MAX_DT');
});

test('start values are (-600, -300), velocity (200, 120), scale 1, angle 0', () => {
  const s = LEAF_START;
  assert(s.x === -600 && s.y === -300, `position (${s.x}, ${s.y})`);
  assert(s.vx === 200 && s.vy === 120, `velocity (${s.vx}, ${s.vy})`);
  assert(s.scale === 1 && s.angle === 0, `scale ${s.scale}, angle ${s.angle}`);
});

// ---------- createLeaf and setLeafValues ----------

test('createLeaf with no values uses the start values', () => {
  const leaf = createLeaf();
  for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'scale']) {
    assert(leaf[key] === LEAF_START[key], `${key}: expected ${LEAF_START[key]}, got ${leaf[key]}`);
  }
});

test('createLeaf returns a new object each time', () => {
  const a = createLeaf();
  const b = createLeaf();
  a.x = 123;
  assert(b.x === LEAF_START.x, 'changing one leaf changed another');
  assert(LEAF_START.x === -600, 'changing a leaf changed LEAF_START');
});

test('createLeaf takes overrides', () => {
  const leaf = createLeaf({ x: 5, vy: -7 });
  assert(leaf.x === 5 && leaf.vy === -7, `got x ${leaf.x}, vy ${leaf.vy}`);
  assert(leaf.y === LEAF_START.y, 'values not given keep their start value');
});

test('setLeafValues ignores NaN, Infinity, strings, and missing input', () => {
  const leaf = leafAt({ x: 1, y: 2, vx: 3, vy: 4 });
  setLeafValues(leaf, { x: NaN, y: Infinity, vx: '9', vy: null, scale: -Infinity });
  assert(leaf.x === 1 && leaf.y === 2 && leaf.vx === 3 && leaf.vy === 4 && leaf.scale === 1,
    `leaf changed: ${JSON.stringify(leaf)}`);
  setLeafValues(leaf, undefined);   // must not throw
  setLeafValues(leaf, null);
  assert(leaf.x === 1, 'leaf changed after empty input');
});

// ---------- leafRadius ----------

test('leafRadius at scale 1 is half the leaf diagonal (about 23.32)', () => {
  assertClose(leafRadius(1), R1, TOL, 'radius');
});

test('leafRadius grows with scale, ignores the sign, and is 0 for scale 0', () => {
  assertClose(leafRadius(2), 2 * R1, TOL, 'scale 2');
  assertClose(leafRadius(-2), 2 * R1, TOL, 'scale -2');
  assertClose(leafRadius(0), 0, TOL, 'scale 0');
});

test('leafRadius of a non-finite scale is 0, not NaN', () => {
  assert(leafRadius(NaN) === 0 && leafRadius(Infinity) === 0, 'not 0');
});

// ---------- Motion ----------

test('one step moves by velocity * dt', () => {
  const leaf = leafAt({ x: 10, y: -20, vx: 200, vy: 120 });
  stepLeaf(leaf, 1 / 60);
  assertClose(leaf.x, 10 + 200 / 60, TOL, 'x');
  assertClose(leaf.y, -20 + 120 / 60, TOL, 'y');
});

test('negative velocity moves left and down', () => {
  const leaf = leafAt({ vx: -300, vy: -90 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.x, -10, TOL, 'x');
  assertClose(leaf.y, -3, TOL, 'y');
});

test('zero velocity does not move', () => {
  const leaf = leafAt({ x: 50, y: 60 });
  stepLeaf(leaf, 1 / 60);
  assert(leaf.x === 50 && leaf.y === 60, `moved to (${leaf.x}, ${leaf.y})`);
});

test('velocity stays the same in open space (constant velocity)', () => {
  const leaf = leafAt({ vx: 200, vy: 120 });
  for (let i = 0; i < 10; i++) stepLeaf(leaf, 1 / 60);
  assert(leaf.vx === 200 && leaf.vy === 120, `velocity became (${leaf.vx}, ${leaf.vy})`);
});

test('angle and scale are not changed by a step', () => {
  const leaf = leafAt({ vx: 100, angle: 0.7, scale: 1.5 });
  stepLeaf(leaf, 1 / 60);
  assert(leaf.angle === 0.7 && leaf.scale === 1.5, `angle ${leaf.angle}, scale ${leaf.scale}`);
});

test('dt = 0 changes nothing', () => {
  const leaf = leafAt({ x: 1, y: 2, vx: 300, vy: 300 });
  stepLeaf(leaf, 0);
  assert(leaf.x === 1 && leaf.y === 2 && leaf.vx === 300 && leaf.vy === 300, 'leaf changed');
});

test('negative, NaN, and Infinity dt change nothing', () => {
  for (const dt of [-1 / 60, NaN, Infinity, -Infinity, undefined]) {
    const leaf = leafAt({ x: 1, y: 2, vx: 300, vy: 300 });
    stepLeaf(leaf, dt);
    assert(leaf.x === 1 && leaf.y === 2, `dt ${dt}: moved to (${leaf.x}, ${leaf.y})`);
  }
});

test('a dt above 1/30 is clamped to 1/30', () => {
  const leaf = leafAt({ vx: 300 });
  stepLeaf(leaf, 1);   // one whole second asked for
  assertClose(leaf.x, 300 / 30, TOL, 'x');
});

// ---------- Frame-rate independence (the step's "done when") ----------

test('one second at 30, 60, and 144 steps per second ends at the same place', () => {
  const ends = [30, 60, 144].map((fps) => {
    const leaf = createLeaf();
    for (let i = 0; i < fps; i++) stepLeaf(leaf, 1 / fps);
    return [leaf.x, leaf.y];
  });
  for (const [x, y] of ends) {
    assertClose(x, -600 + 200, 1e-9, 'x');
    assertClose(y, -300 + 120, 1e-9, 'y');
  }
});

// ---------- Stop at the world edge ----------

test('stops at the right wall: x clamped, vx zeroed, vy kept', () => {
  const leaf = leafAt({ x: 775, y: 0, vx: 200, vy: 50 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.x, HALF_W - R1, TOL, 'x');
  assert(leaf.vx === 0, `vx ${leaf.vx}`);
  assert(leaf.vy === 50, `vy ${leaf.vy}`);
});

test('stops at the left wall', () => {
  const leaf = leafAt({ x: -775, y: 0, vx: -200, vy: 50 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.x, -(HALF_W - R1), TOL, 'x');
  assert(leaf.vx === 0 && leaf.vy === 50, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('stops at the top wall', () => {
  const leaf = leafAt({ x: 0, y: 425, vx: 40, vy: 200 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.y, HALF_H - R1, TOL, 'y');
  assert(leaf.vy === 0 && leaf.vx === 40, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('stops at the bottom wall', () => {
  const leaf = leafAt({ x: 0, y: -425, vx: 40, vy: -200 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.y, -(HALF_H - R1), TOL, 'y');
  assert(leaf.vy === 0 && leaf.vx === 40, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('slides along a wall and stops in the corner', () => {
  const leaf = createLeaf();   // start values: heads up and to the right
  for (let i = 0; i < 60 * 20; i++) stepLeaf(leaf, 1 / 60);   // 20 seconds
  assertClose(leaf.x, HALF_W - R1, 1e-6, 'x');
  assertClose(leaf.y, HALF_H - R1, 1e-6, 'y');
  assert(leaf.vx === 0 && leaf.vy === 0, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('the start values reach the top wall after about 6 seconds', () => {
  // y goes from -300 to 450 - 23.32 = 426.68 at 120 units/s: 726.68 / 120 = 6.06 s.
  const leaf = createLeaf();
  for (let i = 0; i < 60 * 6; i++) stepLeaf(leaf, 1 / 60);
  assert(leaf.vy === 120, 'stopped before 6 s');
  for (let i = 0; i < 6; i++) stepLeaf(leaf, 1 / 60);
  assert(leaf.vy === 0, 'not stopped at 6.1 s');
  assert(leaf.vx === 200, 'still sliding to the right');
});

test('a leaf touching a wall can move away from it', () => {
  const leaf = leafAt({ x: HALF_W - R1, vx: -100 });
  stepLeaf(leaf, 1 / 60);
  assert(leaf.vx === -100, `vx ${leaf.vx}`);
  assertClose(leaf.x, HALF_W - R1 - 100 / 60, TOL, 'x');
});

test('a leaf placed outside the world is pulled back in', () => {
  const leaf = leafAt({ x: 5000, y: -5000 });
  stepLeaf(leaf, 1 / 60);
  assertClose(leaf.x, HALF_W - R1, TOL, 'x');
  assertClose(leaf.y, -(HALF_H - R1), TOL, 'y');
});

test('a huge velocity cannot escape the world', () => {
  const leaf = leafAt({ vx: 1e9, vy: -1e9 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.x, HALF_W - R1, TOL, 'x');
  assertClose(leaf.y, -(HALF_H - R1), TOL, 'y');
});

test('scale changes the margin from the wall', () => {
  const leaf = leafAt({ x: 790, scale: 2, vx: 100 });
  stepLeaf(leaf, 1 / 60);
  assertClose(leaf.x, HALF_W - 2 * R1, TOL, 'x');
});

test('scale 0 lets the center reach the wall exactly', () => {
  const leaf = leafAt({ x: 799, scale: 0, vx: 600 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.x, HALF_W, TOL, 'x');
});

test('negative scale uses the same margin as positive scale', () => {
  const leaf = leafAt({ x: 790, scale: -2, vx: 100 });
  stepLeaf(leaf, 1 / 60);
  assertClose(leaf.x, HALF_W - 2 * R1, TOL, 'x');
});

test('a leaf bigger than the world is held at the center, not NaN', () => {
  const leaf = leafAt({ x: 100, y: 100, scale: 100, vx: 50, vy: 50 });
  stepLeaf(leaf, 1 / 60);
  assert(leaf.x === 0 && leaf.y === 0, `at (${leaf.x}, ${leaf.y})`);
});

// ---------- Bad values never reach the screen ----------

test('NaN or Infinity velocity is treated as 0', () => {
  const leaf = leafAt({ x: 10, y: 20 });
  leaf.vx = NaN;          // set directly, past setLeafValues, to test stepLeaf's own guard
  leaf.vy = Infinity;
  stepLeaf(leaf, 1 / 60);
  assertAllFinite([leaf.x, leaf.y, leaf.vx, leaf.vy], 'leaf');
  assert(leaf.x === 10 && leaf.y === 20, `moved to (${leaf.x}, ${leaf.y})`);
});

test('a NaN position is reset to the center', () => {
  const leaf = leafAt({ vx: 0 });
  leaf.x = NaN;
  leaf.y = -Infinity;
  stepLeaf(leaf, 1 / 60);
  assert(leaf.x === 0 && leaf.y === 0, `at (${leaf.x}, ${leaf.y})`);
});

test('a NaN scale does not make the position NaN', () => {
  const leaf = leafAt({ x: 900, vx: 10 });
  leaf.scale = NaN;
  stepLeaf(leaf, 1 / 60);
  assertAllFinite([leaf.x, leaf.y], 'position');
});

// ---------- Step 4: spawning many leaves ----------

test('step 4 config: 1000 leaves, limit 10,000, scale 0.8 to 1.2, a numeric seed', () => {
  assert(LEAF_COUNT === 1000, `LEAF_COUNT ${LEAF_COUNT}`);
  assert(MAX_LEAVES === 10000, `MAX_LEAVES ${MAX_LEAVES}`);
  assert(LEAF_SCALE_MIN === 0.8 && LEAF_SCALE_MAX === 1.2, `scale ${LEAF_SCALE_MIN} to ${LEAF_SCALE_MAX}`);
  assert(Number.isFinite(LEAF_SEED), `LEAF_SEED ${LEAF_SEED}`);
});

test('spawnLeaves(1000) returns 1000 separate leaf objects', () => {
  const leaves = spawnLeaves(1000, 1);
  assert(leaves.length === 1000, `length ${leaves.length}`);
  assert(new Set(leaves).size === 1000, 'some entries are the same object');
});

test('every spawned leaf is fully inside the world', () => {
  for (const leaf of spawnLeaves(1000, 2)) {
    const r = leafRadius(leaf.scale);
    assert(Math.abs(leaf.x) <= HALF_W - r + 1e-9, `x ${leaf.x} with radius ${r}`);
    assert(Math.abs(leaf.y) <= HALF_H - r + 1e-9, `y ${leaf.y} with radius ${r}`);
  }
});

test('spawned angles are in [0, 2 pi), scales in [0.8, 1.2], velocities 0', () => {
  for (const leaf of spawnLeaves(1000, 3)) {
    assert(leaf.angle >= 0 && leaf.angle < 2 * Math.PI, `angle ${leaf.angle}`);
    assert(leaf.scale >= 0.8 && leaf.scale <= 1.2, `scale ${leaf.scale}`);
    assert(leaf.vx === 0 && leaf.vy === 0, `velocity (${leaf.vx}, ${leaf.vy})`);
  }
});

test('spawned leaves are spread over the whole world', () => {
  const leaves = spawnLeaves(1000, 4);
  // Each quarter of the world should get roughly a quarter of the leaves (250).
  const quarters = [0, 0, 0, 0];
  for (const leaf of leaves) quarters[(leaf.x >= 0 ? 1 : 0) + (leaf.y >= 0 ? 2 : 0)]++;
  assert(quarters.every((n) => n > 180 && n < 320), `per quarter: ${quarters}`);
});

test('the same seed gives the same layout, a different seed a different one', () => {
  const a = spawnLeaves(50, 7);
  const b = spawnLeaves(50, 7);
  const c = spawnLeaves(50, 8);
  assert(a.every((leaf, i) => leaf.x === b[i].x && leaf.y === b[i].y && leaf.angle === b[i].angle),
    'same seed, different layout');
  assert(a.some((leaf, i) => leaf.x !== c[i].x), 'different seed, same layout');
});

test('spawnLeaves with no seed uses LEAF_SEED', () => {
  const a = spawnLeaves(10);
  const b = spawnLeaves(10, LEAF_SEED);
  assert(a.every((leaf, i) => leaf.x === b[i].x && leaf.y === b[i].y), 'layouts differ');
});

test('spawnLeaves with 0, negative, NaN, or non-number counts returns an empty list', () => {
  for (const count of [0, -5, NaN, Infinity, undefined, '100']) {
    const leaves = spawnLeaves(count, 1);
    assert(Array.isArray(leaves) && leaves.length === 0, `count ${count}: length ${leaves.length}`);
  }
});

test('spawnLeaves rounds a decimal count down', () => {
  assert(spawnLeaves(10.9, 1).length === 10, 'not rounded down');
});

test('spawnLeaves never returns more than MAX_LEAVES', () => {
  assert(spawnLeaves(MAX_LEAVES + 500, 1).length === MAX_LEAVES, 'not clamped');
});

test('spawned leaves do not move when stepped (they are static)', () => {
  const leaves = spawnLeaves(100, 5);
  const before = leaves.map((leaf) => [leaf.x, leaf.y]);
  for (const leaf of leaves) stepLeaf(leaf, 1 / 60);
  assert(leaves.every((leaf, i) => leaf.x === before[i][0] && leaf.y === before[i][1]), 'a leaf moved');
});

// ---------- Step 5: wind and drag ----------

const F = 1.5;     // friction used in these tests (per second)
const TOP = 400;   // wind speed used in these tests (world units per second)

// Wind blowing toward `bearing` degrees (0 = up, 90 = right, clockwise).
function blowing(bearing, speed = TOP, friction = F) {
  return createWind({ bearing, speed, friction });
}

// Step a leaf for `seconds` at `hz` steps per second.
function run(leaf, wind, seconds, hz = 60) {
  const steps = Math.round(seconds * hz);
  for (let i = 0; i < steps; i++) stepLeaf(leaf, 1 / hz, wind);
  return leaf;
}

test('step 5 config: friction 1.5, top speed 400, start Calm toward 90 degrees', () => {
  assert(FRICTION === 1.5, `FRICTION ${FRICTION}`);
  assert(WIND_MAX_SPEED === 400, `WIND_MAX_SPEED ${WIND_MAX_SPEED}`);
  assert(WIND_START.bearing === 90 && WIND_START.speed === 0, JSON.stringify(WIND_START));
});

test('createWind: bearings 0, 90, 180, 270 point up, right, down, left', () => {
  const cases = [[0, 0, TOP], [90, TOP, 0], [180, 0, -TOP], [270, -TOP, 0]];
  for (const [bearing, vx, vy] of cases) {
    const w = blowing(bearing);
    assertClose(w.vx, vx, 1e-9, `bearing ${bearing} vx`);
    assertClose(w.vy, vy, 1e-9, `bearing ${bearing} vy`);
  }
});

test('createWind: 360 is the same as 0, -90 the same as 270, 450 the same as 90', () => {
  for (const [a, b] of [[360, 0], [-90, 270], [450, 90]]) {
    assertClose(blowing(a).vx, blowing(b).vx, 1e-9, `${a} vs ${b} vx`);
    assertClose(blowing(a).vy, blowing(b).vy, 1e-9, `${a} vs ${b} vy`);
  }
});

test('createWind: 45 degrees points up and right with the full speed', () => {
  const w = blowing(45);
  assertClose(w.vx, TOP / Math.SQRT2, 1e-9, 'vx');
  assertClose(w.vy, TOP / Math.SQRT2, 1e-9, 'vy');
});

test('createWind: NaN bearing, NaN speed, or negative speed means no wind', () => {
  for (const [bearing, speed] of [[NaN, TOP], [90, NaN], [90, -50], [Infinity, TOP], [90, undefined]]) {
    const w = createWind({ bearing, speed, friction: F });
    assert(w.vx === 0 && w.vy === 0, `bearing ${bearing}, speed ${speed}: (${w.vx}, ${w.vy})`);
  }
});

test('createWind: friction that is NaN, Infinity, or below 0 becomes 0', () => {
  for (const friction of [NaN, Infinity, -1, undefined, 'x']) {
    assert(createWind({ bearing: 90, speed: TOP, friction }).friction === 0, `friction ${friction}`);
  }
  assert(createWind({ bearing: 90, speed: TOP, friction: 2 }).friction === 2, 'a good friction is kept');
});

test('createWind with no input gives no wind and no friction', () => {
  const w = createWind();
  assert(w.vx === 0 && w.vy === 0 && w.friction === 0, JSON.stringify(w));
});

test('windName: Calm, Breeze, Wind, Gale', () => {
  const cases = [[0, 'Calm'], [50, 'Breeze'], [200, 'Wind'], [400, 'Gale'], [NaN, 'Calm'], [-10, 'Calm']];
  for (const [speed, name] of cases) {
    assert(windName(speed, TOP) === name, `speed ${speed}: expected ${name}, got ${windName(speed, TOP)}`);
  }
});

test('windName with a top speed of 0 does not divide by zero', () => {
  assert(windName(0, 0) === 'Calm' && windName(10, 0) === 'Gale', `${windName(0, 0)}, ${windName(10, 0)}`);
});

test('wind moves a resting leaf in the wind direction', () => {
  for (const [bearing, sx, sy] of [[0, 0, 1], [90, 1, 0], [180, 0, -1], [270, -1, 0]]) {
    const leaf = leafAt({});
    stepLeaf(leaf, 1 / 60, blowing(bearing));
    assert(Math.sign(Math.round(leaf.x * 1e6)) === sx && Math.sign(Math.round(leaf.y * 1e6)) === sy,
      `bearing ${bearing}: moved to (${leaf.x}, ${leaf.y})`);
  }
});

test('drag with no wind: speed after 1 s is v0 * e^(-1.5)', () => {
  const leaf = run(leafAt({ x: -700, vx: 300 }), blowing(90, 0), 1);
  assertClose(leaf.vx, 300 * Math.exp(-F), 1e-9, 'vx');
});

test('drag never reverses a leaf, and after 5 s it is under 1% of the start', () => {
  const leaf = leafAt({ x: -700, vx: 300, vy: -100 });
  for (let i = 0; i < 300; i++) {
    stepLeaf(leaf, 1 / 60, blowing(0, 0));
    assert(leaf.vx >= 0 && leaf.vy <= 0, `reversed at step ${i}: (${leaf.vx}, ${leaf.vy})`);
  }
  assert(leaf.vx < 3 && leaf.vy > -1, `still (${leaf.vx}, ${leaf.vy}) after 5 s`);
});

test('a leaf speeds up toward the wind speed and never passes it', () => {
  const leaf = leafAt({ x: -770 });
  for (let i = 0; i < 240; i++) {   // 4 s, before it reaches the far wall
    stepLeaf(leaf, 1 / 60, blowing(90));
    assert(leaf.vx <= TOP + 1e-9, `vx ${leaf.vx} passed the wind speed`);
  }
  assert(leaf.vx > 395, `vx only ${leaf.vx} after 4 s`);
});

test('the exact formula: speed and position after 1 s match the closed form', () => {
  // v(t) = W (1 - e^(-f t)),  x(t) = x0 + W (t - (1 - e^(-f t)) / f), starting from rest.
  const leaf = run(leafAt({ x: -600 }), blowing(90), 1);
  assertClose(leaf.vx, TOP * (1 - Math.exp(-F)), 1e-9, 'vx');
  assertClose(leaf.x, -600 + TOP * (1 - (1 - Math.exp(-F)) / F), 1e-9, 'x');
});

test('1 s of wind at 30, 60, and 144 steps per second ends the same', () => {
  const ends = [30, 60, 144].map((hz) => run(leafAt({ x: -600, y: -100, vx: 50 }), blowing(60), 1, hz));
  for (const leaf of ends.slice(1)) {
    assertClose(leaf.vx, ends[0].vx, 1e-9, 'vx');
    assertClose(leaf.vy, ends[0].vy, 1e-9, 'vy');
    assertClose(leaf.x, ends[0].x, 1e-6, 'x');
    assertClose(leaf.y, ends[0].y, 1e-6, 'y');
  }
});

test('wind into a wall holds the leaf there without building up speed', () => {
  const leaf = leafAt({ x: HALF_W - R1 });
  for (let i = 0; i < 60; i++) {
    stepLeaf(leaf, 1 / 60, blowing(90));
    assertClose(leaf.x, HALF_W - R1, 1e-9, `x at step ${i}`);
    assert(leaf.vx === 0, `vx ${leaf.vx} at step ${i}`);
  }
});

test('wind at an angle slides a leaf along the wall', () => {
  const leaf = run(leafAt({ x: HALF_W - R1, y: 0 }), blowing(45), 0.5);
  assertClose(leaf.x, HALF_W - R1, 1e-9, 'x');
  assert(leaf.y > 20 && leaf.vy > 0, `y ${leaf.y}, vy ${leaf.vy}`);
});

test('turning the wind away lets a leaf leave the wall', () => {
  const leaf = run(leafAt({ x: HALF_W - R1 }), blowing(90), 0.5);
  run(leaf, blowing(270), 1);
  assert(leaf.x < HALF_W - R1 - 50, `x ${leaf.x}`);
});

test('friction 0 or below: no drag and no wind push (velocity kept)', () => {
  for (const friction of [0, -2, NaN]) {
    const leaf = run(leafAt({ x: -700, vx: 100 }), blowing(0, TOP, friction), 0.5);
    assertClose(leaf.vx, 100, 1e-9, `friction ${friction} vx`);
    assertClose(leaf.vy, 0, 1e-9, `friction ${friction} vy`);
    assertClose(leaf.x, -650, 1e-9, `friction ${friction} x`);
  }
});

test('a huge dt with wind is clamped to 1/30 s', () => {
  const a = leafAt({ x: -600 });
  const b = leafAt({ x: -600 });
  stepLeaf(a, 5, blowing(90));
  stepLeaf(b, 1 / 30, blowing(90));
  assertClose(a.x, b.x, 1e-9, 'x');
  assertClose(a.vx, b.vx, 1e-9, 'vx');
});

test('a broken wind object never makes NaN', () => {
  const winds = [{ vx: NaN, vy: Infinity, friction: 1.5 }, { vx: 10 }, {}, null, 'wind', { friction: NaN }];
  for (const wind of winds) {
    const leaf = leafAt({ vx: 10 });
    stepLeaf(leaf, 1 / 60, wind);
    assertAllFinite([leaf.x, leaf.y, leaf.vx, leaf.vy], `wind ${JSON.stringify(wind)}`);
  }
});

test('without a wind argument the step 3 behavior is unchanged', () => {
  const a = leafAt({ vx: 200, vy: 120 });
  stepLeaf(a, 1 / 60);
  assertClose(a.vx, 200, 1e-12, 'vx');
  assertClose(a.x, 200 / 60, 1e-12, 'x');
});

test('1000 spawned leaves all drift with the wind', () => {
  const leaves = spawnLeaves(1000, 9);
  const before = leaves.map((leaf) => leaf.x);
  const wind = blowing(90, 100);
  for (let i = 0; i < 30; i++) for (const leaf of leaves) stepLeaf(leaf, 1 / 60, wind);
  // Every leaf moved right, except ones already at the right wall.
  assert(leaves.every((leaf, i) => leaf.x > before[i] || leaf.x >= HALF_W - leafRadius(leaf.scale) - 1e-9),
    'a leaf did not move right');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
