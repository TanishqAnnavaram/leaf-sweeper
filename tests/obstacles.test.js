// Step 9 obstacle tests: layout, bouncing, tunneling, spawning. Run with:  node tests/obstacles.test.js

import { test, assert, assertClose, assertAllFinite, report } from './harness.js';
import {
  createLeaf, stepLeaf, spawnLeaves, createWind, leafRadius, resolveObstacles,
} from '../src/physics.js';
import {
  OBSTACLES, OBSTACLE_RESTITUTION, OBSTACLE_WALL_GAP, MAX_STEP_DISTANCE, WORLD_WIDTH, WORLD_HEIGHT,
  VOID_RADIUS, LEAF_SCALE_MIN, LEAF_SCALE_MAX, FRICTION, WIND_MAX_SPEED, GUST_STRENGTH, SUCTION_MAX,
  SUCTION_SWIRL, MAX_DT, CAPTURE_RADIUS, MAX_LEAVES,
} from '../src/config.js';
import { createGusts } from '../src/physics.js';
import { createNoise } from '../src/noise.js';

const E = 0.5;

function leafAt(values) {
  return createLeaf({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, scale: 1, spin: 0, spinFactor: 1, fade: 1, ...values });
}

// A wind with only the obstacles switched on (no wind, no void), unless asked for.
function obstacleWind(extra = {}, obstacles = OBSTACLES) {
  return createWind({ bearing: 90, speed: 0, friction: FRICTION, obstacles, ...extra });
}

function gap(leaf, o) {
  return Math.hypot(leaf.x - o.x, leaf.y - o.y) - (o.radius + leafRadius(leaf.scale));
}

// ---------- Layout ----------

test('5 obstacles: 3 rocks and 2 trunks, radii 30 to 55, restitution 0.5, wall gap 60', () => {
  assert(OBSTACLES.length === 5, `count ${OBSTACLES.length}`);
  assert(OBSTACLES.filter((o) => o.kind === 'rock').length === 3, 'rocks');
  assert(OBSTACLES.filter((o) => o.kind === 'trunk').length === 2, 'trunks');
  assert(OBSTACLES.every((o) => o.radius >= 30 && o.radius <= 55), 'radii');
  assert(OBSTACLE_RESTITUTION === E && OBSTACLE_WALL_GAP === 60, `${OBSTACLE_RESTITUTION}, ${OBSTACLE_WALL_GAP}`);
});

test('every obstacle is inside the world, at least 60 units from every wall', () => {
  for (const o of OBSTACLES) {
    assert(Math.abs(o.x) + o.radius <= WORLD_WIDTH / 2 - 60 && Math.abs(o.y) + o.radius <= WORLD_HEIGHT / 2 - 60,
      `obstacle at (${o.x}, ${o.y}) r ${o.radius} is too close to a wall`);
  }
});

test('obstacles do not overlap each other (room for a leaf between them)', () => {
  const leafGap = 2 * leafRadius(LEAF_SCALE_MAX);
  for (let i = 0; i < OBSTACLES.length; i++) {
    for (let j = i + 1; j < OBSTACLES.length; j++) {
      const a = OBSTACLES[i], b = OBSTACLES[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
      assert(d > leafGap, `obstacles ${i} and ${j} are only ${d.toFixed(1)} apart`);
    }
  }
});

test('obstacles are clear of the void ring', () => {
  for (const o of OBSTACLES) {
    assert(Math.hypot(o.x, o.y) - o.radius > VOID_RADIUS, `obstacle at (${o.x}, ${o.y}) touches the void ring`);
  }
});

test('two obstacles sit on corner-to-void diagonals', () => {
  // Distance from an obstacle's center to the line from a corner through the void.
  const onDiagonal = (o) => [[800, 450], [800, -450]].some(([cx, cy]) => {
    const d = Math.abs(cx * o.y - cy * o.x) / Math.hypot(cx, cy);
    return d < o.radius;   // the diagonal passes through the obstacle
  });
  assert(OBSTACLES.filter(onDiagonal).length === 2, `${OBSTACLES.filter(onDiagonal).length} on diagonals`);
});

test('the obstacle list cannot be changed by accident (frozen)', () => {
  assert(Object.isFrozen(OBSTACLES) && OBSTACLES.every((o) => Object.isFrozen(o)), 'not frozen');
});

// ---------- One collision ----------

const ROCK = { x: 0, y: 0, radius: 40, kind: 'rock' };

test('an overlapping leaf is pushed out to exactly touching', () => {
  const leaf = leafAt({ x: 50, y: 0 });   // 50 from the center; touching would be 40 + 23.3
  resolveObstacles(leaf, [ROCK]);
  assertClose(gap(leaf, ROCK), 0, 1e-9, 'gap');
  assertClose(leaf.y, 0, 1e-9, 'pushed straight out');
});

test('the velocity into the obstacle bounces back at 50%, the sideways part is kept', () => {
  const leaf = leafAt({ x: 50, y: 0, vx: -100, vy: 30 });   // moving into the rock, and sideways
  resolveObstacles(leaf, [ROCK]);
  assertClose(leaf.vx, 50, 1e-9, 'vx after the bounce');
  assertClose(leaf.vy, 30, 1e-9, 'sideways part');
});

test('a leaf already moving away is pushed out but its velocity is left alone', () => {
  const leaf = leafAt({ x: 50, y: 0, vx: 80, vy: -10 });
  resolveObstacles(leaf, [ROCK]);
  assert(leaf.vx === 80 && leaf.vy === -10, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('a leaf not touching is not changed', () => {
  const leaf = leafAt({ x: 70, y: 0, vx: -100 });
  resolveObstacles(leaf, [ROCK]);
  assert(leaf.x === 70 && leaf.vx === -100, `(${leaf.x}, ${leaf.vx})`);
});

test('a leaf exactly at the center is pushed out in a fixed direction, never NaN', () => {
  const leaf = leafAt({ x: 0, y: 0, vx: 0, vy: 0 });
  resolveObstacles(leaf, [ROCK]);
  assertAllFinite([leaf.x, leaf.y, leaf.vx, leaf.vy], 'leaf');
  assertClose(gap(leaf, ROCK), 0, 1e-9, 'gap');
});

test('scale 0 leaves and broken obstacles are safe', () => {
  const leaf = leafAt({ x: 30, y: 0, scale: 0, vx: -10 });
  resolveObstacles(leaf, [ROCK, { x: NaN, y: 0, radius: 10 }, { x: 0, y: 0, radius: -5 }, null, 'rock']);
  assertAllFinite([leaf.x, leaf.y, leaf.vx, leaf.vy], 'leaf');
  assertClose(leaf.x, 40, 1e-9, 'pushed to the rock edge');
});

test('createWind keeps only valid obstacles', () => {
  const w = createWind({ obstacles: [ROCK, { x: NaN, y: 0, radius: 5 }, { x: 1, y: 1, radius: 0 }, null] });
  assert(w.obstacles.length === 1, `kept ${w.obstacles.length}`);
  assert(createWind({}).obstacles.length === 0, 'default should have no obstacles');
});

// ---------- Over time ----------

test('a leaf blown straight at an obstacle is never inside it on any frame', () => {
  const rock = OBSTACLES[0];
  const leaf = leafAt({ x: rock.x - 200, y: rock.y });
  const w = obstacleWind({ speed: WIND_MAX_SPEED, bearing: 90 });
  for (let i = 0; i < 300; i++) {
    stepLeaf(leaf, 1 / 60, w);
    assert(gap(leaf, rock) >= -1e-6, `inside the rock by ${(-gap(leaf, rock)).toFixed(3)} at frame ${i}`);
  }
});

test('a leaf hitting off-center slides around and carries on', () => {
  const rock = OBSTACLES[0];
  const leaf = leafAt({ x: rock.x - 200, y: rock.y + 30 });
  const w = obstacleWind({ speed: 200, bearing: 90 });
  for (let i = 0; i < 300; i++) stepLeaf(leaf, 1 / 60, w);
  assert(leaf.x > rock.x + rock.radius, `stuck at x ${leaf.x.toFixed(1)} (rock at ${rock.x})`);
});

test('a leaf blown into the gap between an obstacle and a wall is never trapped inside either', () => {
  for (const o of OBSTACLES) {
    const leaf = leafAt({ x: o.x, y: o.y + Math.sign(o.y) * (o.radius + 30) });
    const w = obstacleWind({ speed: WIND_MAX_SPEED, bearing: o.y > 0 ? 0 : 180 });   // toward the near wall
    for (let i = 0; i < 120; i++) {
      stepLeaf(leaf, 1 / 60, w);
      const r = leafRadius(leaf.scale);
      assert(gap(leaf, o) >= -1e-6, 'inside the obstacle');
      assert(Math.abs(leaf.y) <= WORLD_HEIGHT / 2 - r + 1e-9, 'outside the world');
    }
  }
});

// ---------- Tunneling ----------

test('MAX_STEP_DISTANCE is below the smallest obstacle-plus-leaf radius', () => {
  const smallest = Math.min(...OBSTACLES.map((o) => o.radius)) + leafRadius(LEAF_SCALE_MIN);
  assert(MAX_STEP_DISTANCE < smallest, `${MAX_STEP_DISTANCE} vs ${smallest.toFixed(1)}`);
});

test('with default settings no leaf needs sub-steps (fastest move per frame is under the limit)', () => {
  // Fastest a leaf can head: Gale with the strongest gust, plus the full suction with its swirl.
  const fastest = WIND_MAX_SPEED * (1 + GUST_STRENGTH) + SUCTION_MAX * Math.hypot(1, SUCTION_SWIRL);
  assert(fastest * MAX_DT <= MAX_STEP_DISTANCE, `${(fastest * MAX_DT).toFixed(1)} units per frame`);
});

test('even with maximum tuning, a very fast leaf never passes through the smallest rock', () => {
  const rock = OBSTACLES.reduce((a, b) => (a.radius < b.radius ? a : b));
  const gusts = createGusts(createNoise(1));
  const w = createWind({
    bearing: 90, speed: 800, friction: FRICTION, gustStrength: 1, gustSize: 300, suction: 1000,
    voidRadius: VOID_RADIUS, obstacles: OBSTACLES,
  }, gusts);
  const leaf = leafAt({ x: rock.x - 60, y: rock.y, vx: 3000, scale: LEAF_SCALE_MIN });
  stepLeaf(leaf, MAX_DT, w);
  assert(leaf.x < rock.x, `went through: x ${leaf.x.toFixed(1)}, rock at ${rock.x}`);
  assert(gap(leaf, rock) >= -1e-6, 'inside the rock');
});

test('a fast leaf is moved in sub-steps: one 1/30 s step equals two 1/60 s steps', () => {
  // 1500 units/s * 1/30 s = 50 units > 40, so it needs 2 sub-steps; 1/60 s steps (25 units) need none.
  const w = obstacleWind({ speed: 800, bearing: 90, spinAmount: 1 }, []);
  const a = leafAt({ x: -700, y: 0, vx: 1500 });
  const b = leafAt({ x: -700, y: 0, vx: 1500 });
  stepLeaf(a, 1 / 30, w);
  stepLeaf(b, 1 / 60, w);
  stepLeaf(b, 1 / 60, w);
  assertClose(a.x, b.x, 1e-9, 'x');
  assertClose(a.vx, b.vx, 1e-9, 'vx');
  assertClose(a.angle, b.angle, 1e-9, 'angle');
});

test('a slow leaf takes exactly one step (no sub-steps at normal speeds)', () => {
  const w = obstacleWind({ speed: 400, bearing: 90, spinAmount: 1 }, []);
  const a = leafAt({ x: -700, y: 0, vx: 400 });
  const b = leafAt({ x: -700, y: 0, vx: 400 });
  stepLeaf(a, 1 / 30, w);
  stepLeaf(b, 1 / 60, w);
  stepLeaf(b, 1 / 60, w);
  // Exact physics makes the two nearly equal anyway, but the spin update differs a little,
  // so equal angles to 1e-12 would mean a sub-step happened.
  assert(Math.abs(a.angle - b.angle) > 1e-12, 'a slow 1/30 s step was split into sub-steps');
});

// ---------- Captured leaves ----------

test('a captured leaf passes straight through an obstacle', () => {
  const w = createWind({
    bearing: 90, speed: 0, friction: FRICTION, suction: SUCTION_MAX, voidRadius: VOID_RADIUS,
    captureRadius: CAPTURE_RADIUS, obstacles: [{ x: 0, y: 0, radius: 15, kind: 'rock' }],
  });
  const leaf = leafAt({ x: 25, y: 0 });
  // Catch the leaf first (no obstacle yet), then put an obstacle at the void's center:
  // the caught leaf must spiral right through it.
  stepLeaf(leaf, 1 / 60, createWind({ suction: SUCTION_MAX, voidRadius: VOID_RADIUS, captureRadius: CAPTURE_RADIUS, friction: FRICTION }));
  assert(leaf.captured, 'setup: not captured');
  for (let i = 0; i < 40; i++) stepLeaf(leaf, 1 / 60, w);
  assert(leaf.captured && leaf.done, `captured ${leaf.captured}, done ${leaf.done}`);
});

// ---------- Spawning ----------

test('no leaf spawns touching an obstacle (start, +100 style, and other seeds)', () => {
  for (const [count, seed] of [[1000, 20261119], [100, 20262119], [MAX_LEAVES, 5]]) {
    for (const leaf of spawnLeaves(count, seed)) {
      for (const o of OBSTACLES) {
        assert(gap(leaf, o) >= 0, `seed ${seed}: leaf at (${leaf.x.toFixed(1)}, ${leaf.y.toFixed(1)}) touches an obstacle`);
      }
    }
  }
});

test('spawnLeaves can be told to use no obstacles', () => {
  const leaves = spawnLeaves(10, 1, VOID_RADIUS, []);
  assert(leaves.length === 10, `length ${leaves.length}`);
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
