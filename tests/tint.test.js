// Step 10a tests: each leaf's tint (its autumn color, 0 to 1), stored on the leaf so it moves with it.
// Run with:  node tests/tint.test.js

import { test, assert, report } from './harness.js';
import {
  createLeaf, spawnLeaves, stepLeaf, createWind, removeFinished, leafRadius,
} from '../src/physics.js';
import { createRandom } from '../src/random.js';
import {
  LEAF_START, LEAF_SEED, LEAF_SCALE_MIN, LEAF_SCALE_MAX, WORLD_WIDTH, WORLD_HEIGHT,
  VOID_X, VOID_Y, VOID_RADIUS, OBSTACLES, SPIN_FACTOR_MIN, SPIN_FACTOR_MAX, TINT_SEED_OFFSET,
  CAPTURE_RADIUS, SUCTION_MAX,
} from '../src/config.js';

test('a new leaf has tint 0.5 unless given one; a bad tint is ignored', () => {
  assert(LEAF_START.tint === 0.5, `LEAF_START.tint ${LEAF_START.tint}`);
  assert(createLeaf().tint === 0.5, 'default');
  assert(createLeaf({ tint: 0.2 }).tint === 0.2, 'given 0.2');
  assert(createLeaf({ tint: NaN }).tint === 0.5, 'NaN was used');
});

test('spawned tints are finite and in [0, 1)', () => {
  for (const leaf of spawnLeaves(1000)) {
    assert(Number.isFinite(leaf.tint) && leaf.tint >= 0 && leaf.tint < 1, `tint ${leaf.tint}`);
  }
});

test('tints spread over all 5 colors: each fifth of [0, 1) gets at least 10% of 1000 leaves', () => {
  const bands = [0, 0, 0, 0, 0];
  for (const leaf of spawnLeaves(1000)) bands[Math.min(4, Math.floor(leaf.tint * 5))]++;
  assert(bands.every((n) => n >= 100), `bands ${bands}`);
});

test('almost every leaf has its own tint (at least 990 different values in 1000)', () => {
  const tints = new Set(spawnLeaves(1000).map((leaf) => leaf.tint));
  assert(tints.size >= 990, `${tints.size} different tints`);
});

test('the same seed gives the same tints, another seed different ones', () => {
  const a = spawnLeaves(50, 7).map((l) => l.tint);
  const b = spawnLeaves(50, 7).map((l) => l.tint);
  const c = spawnLeaves(50, 8).map((l) => l.tint);
  assert(a.every((t, i) => t === b[i]), 'same seed, different tints');
  assert(a.some((t, i) => t !== c[i]), 'different seeds, same tints');
});

test('tints come from their own (third) random stream: seed + TINT_SEED_OFFSET', () => {
  const random = createRandom(LEAF_SEED + TINT_SEED_OFFSET);
  const leaves = spawnLeaves(20);
  leaves.forEach((leaf, i) => {
    const expected = random();
    assert(leaf.tint === expected, `leaf ${i}: ${leaf.tint} vs ${expected}`);
  });
});

test('adding tints moved nothing: position, scale, angle, and spin still come from the first two streams', () => {
  // Rebuild leaf 0 by hand, the way spawnLeaves picks it (steps 4, 6, 7, 9).
  const random = createRandom(LEAF_SEED);
  const spinRandom = createRandom(LEAF_SEED + 7919);
  const scale = LEAF_SCALE_MIN + (LEAF_SCALE_MAX - LEAF_SCALE_MIN) * random();
  const r = leafRadius(scale);
  const maxX = WORLD_WIDTH / 2 - r;
  const maxY = WORLD_HEIGHT / 2 - r;
  let x = 0, y = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    x = (2 * random() - 1) * maxX;
    y = (2 * random() - 1) * maxY;
    const clear = OBSTACLES.every((o) => Math.hypot(x - o.x, y - o.y) >= o.radius + r);
    if (Math.hypot(x - VOID_X, y - VOID_Y) >= VOID_RADIUS && clear) break;
  }
  const angle = random() * 2 * Math.PI;
  const direction = spinRandom() < 0.5 ? -1 : 1;
  const spinFactor = direction * (SPIN_FACTOR_MIN + (SPIN_FACTOR_MAX - SPIN_FACTOR_MIN) * spinRandom());
  const leaf = spawnLeaves(1)[0];
  assert(leaf.scale === scale && leaf.x === x && leaf.y === y, `got (${leaf.x}, ${leaf.y}) scale ${leaf.scale}`);
  assert(leaf.angle === angle && leaf.spinFactor === spinFactor, `angle ${leaf.angle}, spinFactor ${leaf.spinFactor}`);
});

test('wind, walls, and spinning never change a tint', () => {
  const leaf = createLeaf({ x: 700, y: 0, vx: 0, vy: 0, tint: 0.37, spinFactor: 1 });
  const wind = createWind({ bearing: 90, speed: 400, friction: 1.5, spinAmount: 0.5 });
  for (let i = 0; i < 120; i++) stepLeaf(leaf, 1 / 60, wind);
  assert(leaf.tint === 0.37, `tint ${leaf.tint}`);
});

test('being caught and spiralling into the void never changes a tint', () => {
  const leaf = createLeaf({ x: 10, y: 0, vx: 0, vy: 0, tint: 0.81 });
  const wind = createWind({ captureRadius: CAPTURE_RADIUS, suction: SUCTION_MAX, voidRadius: VOID_RADIUS });
  for (let i = 0; i < 60 && !leaf.done; i++) stepLeaf(leaf, 1 / 60, wind);
  assert(leaf.done === true, 'leaf was not finished');
  assert(leaf.tint === 0.81, `tint ${leaf.tint}`);
});

test('swap-and-pop moves each leaf with its own tint', () => {
  const leaves = [0.1, 0.2, 0.3, 0.4, 0.5].map((tint, i) => createLeaf({ x: i * 10, tint }));
  leaves[1].done = true;
  assert(removeFinished(leaves) === 1, 'not removed');
  // The last leaf (tint 0.5) now sits where the removed one was, and still has tint 0.5.
  const tints = leaves.map((l) => l.tint);
  assert(tints.join() === '0.1,0.5,0.3,0.4', `tints ${tints}`);
  assert(leaves[1].x === 40, `moved leaf x ${leaves[1].x}`);
});

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
