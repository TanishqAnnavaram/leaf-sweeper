// Physics tests (steps 3 and 4). Run with:  node tests/physics.test.js
// These test src/physics.js only. No WebGL is involved.

import { test, assert, assertClose, assertAllFinite, report } from './harness.js';
import { createLeaf, setLeafValues, stepLeaf, leafRadius, spawnLeaves } from '../src/physics.js';
import {
  WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_DT, LEAF_START,
  LEAF_COUNT, MAX_LEAVES, LEAF_SEED, LEAF_SCALE_MIN, LEAF_SCALE_MAX,
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

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
