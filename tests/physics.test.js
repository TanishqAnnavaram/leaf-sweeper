// Physics tests (steps 3 to 6). Run with:  node tests/physics.test.js
// These test src/physics.js only. No WebGL is involved.

import { test, assert, assertClose, assertAllFinite, report } from './harness.js';
import {
  createLeaf, setLeafValues, stepLeaf, leafRadius, spawnLeaves, createWind, windName,
  leafWind, createGusts, advanceGusts,
} from '../src/physics.js';
import { createNoise } from '../src/noise.js';
import {
  WORLD_WIDTH, WORLD_HEIGHT, LEAF_RADIUS, MAX_DT, LEAF_START,
  LEAF_COUNT, MAX_LEAVES, LEAF_SEED, LEAF_SCALE_MIN, LEAF_SCALE_MAX,
  FRICTION, WIND_MAX_SPEED, WIND_START,
  GUST_STRENGTH, GUST_SIZE, GUST_MAX_TURN, SPIN_AMOUNT, SPIN_FACTOR_MIN, SPIN_FACTOR_MAX,
} from '../src/config.js';

const TOL = 1e-9;
const HALF_W = WORLD_WIDTH / 2;    // 800
const HALF_H = WORLD_HEIGHT / 2;   // 450
// Radius of the circle around a scale-1 leaf. Step 10a: the farthest point of the leaf shape from its
// center, which is half its length (16 units), instead of half the old rectangle's diagonal.
const R1 = LEAF_RADIUS;

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

test('leafRadius at scale 1 is half the leaf length (16)', () => {
  assert(R1 === 16, `LEAF_RADIUS ${R1}`);
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
  const leaf = leafAt({ x: 780, y: 0, vx: 200, vy: 50 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.x, HALF_W - R1, TOL, 'x');
  assert(leaf.vx === 0, `vx ${leaf.vx}`);
  assert(leaf.vy === 50, `vy ${leaf.vy}`);
});

test('stops at the left wall', () => {
  const leaf = leafAt({ x: -780, y: 0, vx: -200, vy: 50 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.x, -(HALF_W - R1), TOL, 'x');
  assert(leaf.vx === 0 && leaf.vy === 50, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('stops at the top wall', () => {
  const leaf = leafAt({ x: 0, y: 430, vx: 40, vy: 200 });
  stepLeaf(leaf, 1 / 30);
  assertClose(leaf.y, HALF_H - R1, TOL, 'y');
  assert(leaf.vy === 0 && leaf.vx === 40, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('stops at the bottom wall', () => {
  const leaf = leafAt({ x: 0, y: -430, vx: 40, vy: -200 });
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
  // y goes from -300 to 450 - 16 = 434 at 120 units/s: 734 / 120 = 6.12 s.
  const leaf = createLeaf();
  for (let i = 0; i < 60 * 6; i++) stepLeaf(leaf, 1 / 60);
  assert(leaf.vy === 120, 'stopped before 6 s');
  for (let i = 0; i < 8; i++) stepLeaf(leaf, 1 / 60);   // to 6.13 s
  assert(leaf.vy === 0, 'not stopped at 6.13 s');
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

// ---------- Step 6: gusts ----------

const NOISE = createNoise(LEAF_SEED);

// Base wind plus gust settings. `gusts` holds the noise, the time, and the drift offset.
function gusty({ bearing = 90, speed = TOP, strength = 0.6, size = 300, spin = 0, gusts } = {}) {
  return createWind(
    { bearing, speed, friction: F, gustStrength: strength, gustSize: size, spinAmount: spin },
    gusts || createGusts(NOISE),
  );
}

function windAngleDeg(v) {
  return (Math.atan2(v.vx, v.vy) * 180) / Math.PI;   // compass bearing of a wind vector
}

test('step 6 config: gust 0.6, size 300, turn 25 degrees, spin 0.3 to 1.0', () => {
  assert(GUST_STRENGTH === 0.6 && GUST_SIZE === 300 && GUST_MAX_TURN === 25,
    `${GUST_STRENGTH}, ${GUST_SIZE}, ${GUST_MAX_TURN}`);
  assert(SPIN_FACTOR_MIN === 0.3 && SPIN_FACTOR_MAX === 1.0, `${SPIN_FACTOR_MIN} to ${SPIN_FACTOR_MAX}`);
  assert(Number.isFinite(SPIN_AMOUNT) && SPIN_AMOUNT >= 0 && SPIN_AMOUNT <= 2, `SPIN_AMOUNT ${SPIN_AMOUNT}`);
});

test('gust strength 0 gives exactly the step 5 result', () => {
  const a = leafAt({ x: -300, y: 50 });
  const b = leafAt({ x: -300, y: 50 });
  const plain = blowing(60);
  const zeroGust = gusty({ bearing: 60, strength: 0 });
  for (let i = 0; i < 60; i++) {
    stepLeaf(a, 1 / 60, plain);
    stepLeaf(b, 1 / 60, zeroGust);
  }
  assert(a.x === b.x && a.y === b.y && a.vx === b.vx && a.vy === b.vy, 'results differ');
});

test('createWind without gust settings has no gusts and no spin (step 5 behavior)', () => {
  const w = createWind({ bearing: 90, speed: TOP, friction: F });
  const v = leafWind(w, 123, 45);
  assert(v.vx === w.vx && v.vy === w.vy, `got (${v.vx}, ${v.vy})`);
  assert(w.spinAmount === 0, `spinAmount ${w.spinAmount}`);
});

test('Calm with gusts still means no wind and no motion', () => {
  const w = gusty({ speed: 0, strength: 1 });
  const v = leafWind(w, 100, 100);
  assert(v.vx === 0 && v.vy === 0, `got (${v.vx}, ${v.vy})`);
  const leaf = run(leafAt({ x: 10, y: 20 }), w, 1);
  assert(leaf.x === 10 && leaf.y === 20, `moved to (${leaf.x}, ${leaf.y})`);
});

test('each leaf wind is 0.4x to 1.6x the base speed and within 25 degrees', () => {
  const w = gusty({ bearing: 90 });
  for (let i = 0; i < 2000; i++) {
    const x = -800 + (i % 50) * 32 + 0.37;
    const y = -450 + Math.floor(i / 50) * 22 + 0.19;
    const v = leafWind(w, x, y);
    const speed = Math.hypot(v.vx, v.vy);
    assert(speed >= 0.4 * TOP - 1e-9 && speed <= 1.6 * TOP + 1e-9, `speed ${speed} at (${x}, ${y})`);
    assert(Math.abs(windAngleDeg(v) - 90) <= 25 + 1e-9, `angle ${windAngleDeg(v)} at (${x}, ${y})`);
  }
});

test('gusts really vary: speeds and angles spread across the field', () => {
  const w = gusty({ bearing: 90 });
  let minS = Infinity, maxS = -Infinity, minA = Infinity, maxA = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const v = leafWind(w, -800 + (i % 50) * 32 + 0.37, -450 + Math.floor(i / 50) * 22 + 0.19);
    const s = Math.hypot(v.vx, v.vy);
    minS = Math.min(minS, s); maxS = Math.max(maxS, s);
    minA = Math.min(minA, windAngleDeg(v)); maxA = Math.max(maxA, windAngleDeg(v));
  }
  assert(maxS - minS > 0.4 * TOP, `speeds only ${minS.toFixed(0)} to ${maxS.toFixed(0)}`);
  assert(maxA - minA > 15, `angles only ${minA.toFixed(1)} to ${maxA.toFixed(1)}`);
});

test('the same position and time give the same wind', () => {
  const gusts = createGusts(NOISE);
  const w1 = gusty({ gusts });
  const w2 = gusty({ gusts });
  const a = leafWind(w1, 250.5, -120.25);
  const b = leafWind(w2, 250.5, -120.25);
  assert(a.vx === b.vx && a.vy === b.vy, 'different wind at the same place and time');
});

test('leaves far apart get different wind', () => {
  const w = gusty();
  let differ = 0;
  for (let i = 0; i < 50; i++) {
    const a = leafWind(w, -700 + i * 10, -300);
    const b = leafWind(w, -700 + i * 10 + 600, 300);
    if (Math.abs(a.vx - b.vx) > 1) differ++;
  }
  assert(differ > 40, `only ${differ} of 50 pairs differ`);
});

test('the wind at one spot changes over time', () => {
  const gusts = createGusts(NOISE);
  const before = leafWind(gusty({ gusts }), 100.5, 50.5);
  advanceGusts(gusts, gusty({ gusts }), 1 / 30);
  for (let i = 0; i < 59; i++) advanceGusts(gusts, gusty({ gusts }), 1 / 30);   // 2 s
  const after = leafWind(gusty({ gusts }), 100.5, 50.5);
  assert(Math.abs(after.vx - before.vx) > 1 || Math.abs(after.vy - before.vy) > 1, 'no change after 2 s');
});

test('advanceGusts moves time and drifts the pattern downwind', () => {
  const gusts = createGusts(NOISE);
  const w = gusty({ bearing: 90, speed: 200, gusts });
  advanceGusts(gusts, w, 1 / 60);
  assertClose(gusts.time, 1 / 60, 1e-12, 'time');
  assertClose(gusts.offsetX, 200 / 60, 1e-9, 'offsetX');
  assertClose(gusts.offsetY, 0, 1e-9, 'offsetY');
});

test('advanceGusts ignores a bad dt and clamps a huge one', () => {
  const gusts = createGusts(NOISE);
  const w = gusty({ gusts });
  for (const dt of [0, -1, NaN, Infinity]) advanceGusts(gusts, w, dt);
  assert(gusts.time === 0 && gusts.offsetX === 0, `time ${gusts.time}, offset ${gusts.offsetX}`);
  advanceGusts(gusts, w, 5);
  assertClose(gusts.time, MAX_DT, 1e-12, 'time after a 5 s dt');
});

test('averaged over a large area, the wind speed is close to the base speed', () => {
  const w = gusty({ bearing: 90 });
  let sum = 0, n = 0;
  for (let i = 0; i < 100; i++) {
    for (let j = 0; j < 100; j++) {
      const v = leafWind(w, i * 97.3, j * 61.7);
      sum += Math.hypot(v.vx, v.vy);
      n++;
    }
  }
  assertClose(sum / n / TOP, 1, 0.08, 'average speed / base speed');
});

test('bad gust settings never make NaN and never make the wind negative', () => {
  const cases = [
    { gustStrength: NaN }, { gustStrength: -1 }, { gustStrength: 5 }, { gustSize: 0 },
    { gustSize: -100 }, { gustSize: NaN }, { spinAmount: NaN }, { spinAmount: -1 },
  ];
  for (const extra of cases) {
    const w = createWind({ bearing: 90, speed: TOP, friction: F, gustStrength: 0.6, gustSize: 300, ...extra },
      createGusts(NOISE));
    for (let i = 0; i < 200; i++) {
      const v = leafWind(w, i * 13.7 - 800, i * 4.1 - 400);
      assertAllFinite([v.vx, v.vy], `${JSON.stringify(extra)}`);
      assert(v.vx >= -1e-9, `${JSON.stringify(extra)}: wind turned backwards, vx ${v.vx}`);
    }
    const leaf = run(leafAt({}), w, 0.5);
    assertAllFinite([leaf.x, leaf.y, leaf.vx, leaf.vy, leaf.angle], `${JSON.stringify(extra)} leaf`);
  }
});

test('gusts with a missing noise function fall back to even wind', () => {
  const w = createWind({ bearing: 90, speed: TOP, friction: F, gustStrength: 0.6, gustSize: 300 },
    { time: 0, offsetX: 0, offsetY: 0 });
  const v = leafWind(w, 10, 10);
  assertClose(v.vx, TOP, 1e-9, 'vx');
});

test('1 s with gusts at 30, 60, and 144 steps per second ends within 2%', () => {
  const ends = [30, 60, 144].map((hz) => {
    const gusts = createGusts(NOISE);
    const leaf = leafAt({ x: -600, y: -100 });
    for (let i = 0; i < hz; i++) {
      const w = gusty({ bearing: 60, gusts });
      stepLeaf(leaf, 1 / hz, w);
      advanceGusts(gusts, w, 1 / hz);
    }
    return leaf;
  });
  const travel = ends[0].x + 600;
  for (const leaf of ends.slice(1)) {
    assert(Math.abs(leaf.x - ends[0].x) < 0.02 * travel, `x ${leaf.x} vs ${ends[0].x}`);
  }
});

// ---------- Step 6: tumbling ----------

function spinner(values) {
  return leafAt({ spin: 0, spinFactor: 1, ...values });
}

test('a still leaf does not spin', () => {
  const leaf = spinner({ angle: 1 });
  run(leaf, gusty({ speed: 0, spin: 1 }), 1);
  assert(leaf.angle === 1, `angle ${leaf.angle}`);
});

test('a moving leaf spins', () => {
  const leaf = spinner({ x: -600, angle: 1 });
  run(leaf, gusty({ strength: 0, spin: 1 }), 1);
  assert(Math.abs(leaf.spin) > 1 && leaf.angle !== 1, `spin ${leaf.spin}, angle ${leaf.angle}`);
});

test('faster leaves spin faster', () => {
  const slow = run(spinner({ x: -600 }), gusty({ speed: 100, strength: 0, spin: 1 }), 1);
  const fast = run(spinner({ x: -600 }), gusty({ speed: 400, strength: 0, spin: 1 }), 1);
  assert(Math.abs(fast.spin) > 2 * Math.abs(slow.spin), `slow ${slow.spin}, fast ${fast.spin}`);
});

test('spin follows speed / radius * spinFactor * spinAmount', () => {
  // Wind 100 for 4 s: speed about 100, so the target spin is 100 / r * 0.5 * 1.
  const leaf = run(spinner({ x: -700, spinFactor: 0.5 }), gusty({ speed: 100, strength: 0, spin: 1 }), 4);
  const target = (Math.hypot(leaf.vx, leaf.vy) / leafRadius(1)) * 0.5;
  assertClose(leaf.spin, target, 0.05 * target, 'spin');
});

test('the sign of spinFactor sets the spin direction', () => {
  const ccw = run(spinner({ x: -600, spinFactor: 0.8 }), gusty({ strength: 0, spin: 1 }), 0.5);
  const cw = run(spinner({ x: -600, spinFactor: -0.8 }), gusty({ strength: 0, spin: 1 }), 0.5);
  assert(ccw.spin > 0 && cw.spin < 0, `ccw ${ccw.spin}, cw ${cw.spin}`);
});

test('spin dies out within about 3 s after the wind stops', () => {
  // Spin amount 2 * SPIN_AMOUNT: exactly 1 before step 10a, and the same tumbling with the new radius.
  const amount = 2 * SPIN_AMOUNT;
  const leaf = run(spinner({ x: -600 }), gusty({ strength: 0, spin: amount }), 1);
  const spinning = Math.abs(leaf.spin);
  run(leaf, gusty({ speed: 0, spin: amount }), 3);
  // Under 0.3 rad/s is less than one turn every 20 s: still to the eye.
  assert(Math.abs(leaf.spin) < 0.3, `spin ${leaf.spin} after 3 s of Calm (was ${spinning})`);
  assert(Math.abs(leaf.spin) < spinning / 20, 'spin did not die out');
});

test('spin amount 0 means no rotation, even when moving', () => {
  const leaf = run(spinner({ x: -600, angle: 2 }), gusty({ strength: 0, spin: 0 }), 1);
  assert(leaf.angle === 2, `angle ${leaf.angle}`);
});

test('the angle stays finite and inside [0, 2 pi) after a long spin', () => {
  const leaf = spinner({ x: -790, spinFactor: 1 });
  const w = gusty({ bearing: 0, speed: 50, strength: 0, spin: 2 });
  for (let i = 0; i < 60 * 60; i++) {   // one minute
    stepLeaf(leaf, 1 / 60, w);
    leaf.y = 0;   // keep it away from the top wall so it never stops
    assert(Number.isFinite(leaf.angle) && leaf.angle >= 0 && leaf.angle < 2 * Math.PI,
      `angle ${leaf.angle} at step ${i}`);
  }
});

test('NaN spin or spinFactor never makes the angle NaN', () => {
  const leaf = spinner({ x: -600 });
  leaf.spin = NaN;
  leaf.spinFactor = Infinity;
  run(leaf, gusty({ spin: 1 }), 0.5);
  assertAllFinite([leaf.angle, leaf.spin], 'angle and spin');
});

test('spawned leaves have spin 0 and spin factors 0.3 to 1.0 in both directions', () => {
  const leaves = spawnLeaves(1000, 12);
  let cw = 0, ccw = 0;
  for (const leaf of leaves) {
    assert(leaf.spin === 0, `spin ${leaf.spin}`);
    const m = Math.abs(leaf.spinFactor);
    assert(m >= 0.3 && m <= 1.0, `spinFactor ${leaf.spinFactor}`);
    if (leaf.spinFactor > 0) ccw++; else cw++;
  }
  assert(cw > 400 && ccw > 400, `${cw} clockwise, ${ccw} counterclockwise`);
});

test('the same seed gives the same spin factors', () => {
  const a = spawnLeaves(50, 13);
  const b = spawnLeaves(50, 13);
  assert(a.every((leaf, i) => leaf.spinFactor === b[i].spinFactor), 'spin factors differ');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
