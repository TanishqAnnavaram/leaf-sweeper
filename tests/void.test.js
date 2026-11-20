// Step 7 void tests: suction, capture, removal, and spawning outside the void.
// Run with:  node tests/void.test.js

import { test, assert, assertClose, assertAllFinite, report } from './harness.js';
import {
  createLeaf, stepLeaf, spawnLeaves, createWind, suctionAt, removeFinished, leafRadius,
} from '../src/physics.js';
import {
  VOID_X, VOID_Y, VOID_RADIUS, CAPTURE_RADIUS, SUCTION_MAX, SUCTION_SWIRL, CAPTURE_TIME,
  VOID_DISC_RADIUS, FRICTION, WORLD_WIDTH, WORLD_HEIGHT,
} from '../src/config.js';

const R = 220;
const S = 500;

// A wind with the void switched on. Gusts and spin are off unless asked for.
function voidWind(extra = {}) {
  return createWind({
    bearing: 90, speed: 0, friction: FRICTION,
    suction: S, voidRadius: R, captureRadius: CAPTURE_RADIUS, ...extra,
  });
}

function leafAt(values) {
  return createLeaf({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, scale: 1, spin: 0, spinFactor: 1, fade: 1, ...values });
}

function dist(leaf) {
  return Math.hypot(leaf.x - VOID_X, leaf.y - VOID_Y);
}

// ---------- Config ----------

test('step 7 config: void at (0, 0), radius 220, capture 30, pull 500, swirl 0.3, 0.6 s, disc 40', () => {
  assert(VOID_X === 0 && VOID_Y === 0, `void at (${VOID_X}, ${VOID_Y})`);
  assert(VOID_RADIUS === 220 && CAPTURE_RADIUS === 30, `${VOID_RADIUS}, ${CAPTURE_RADIUS}`);
  assert(SUCTION_MAX === 500 && SUCTION_SWIRL === 0.3, `${SUCTION_MAX}, ${SUCTION_SWIRL}`);
  assert(CAPTURE_TIME === 0.6 && VOID_DISC_RADIUS === 40, `${CAPTURE_TIME}, ${VOID_DISC_RADIUS}`);
});

// ---------- Suction ----------

test('no pull outside the attraction radius', () => {
  const w = voidWind();
  for (const [x, y] of [[221, 0], [0, -300], [500, 400], [220.0001, 0]]) {
    const p = suctionAt(w, x, y);
    assert(p.vx === 0 && p.vy === 0, `pull (${p.vx}, ${p.vy}) at (${x}, ${y})`);
  }
});

test('the pull points to the center with strength 500 * (1 - d / 220)', () => {
  const w = voidWind({ suction: S });
  for (const d of [20, 55, 110, 200]) {
    for (const angle of [0, 1, 2.5, 4]) {
      const x = d * Math.cos(angle), y = d * Math.sin(angle);
      const p = suctionAt(w, x, y);
      const inward = -(p.vx * x + p.vy * y) / d;   // the part of the pull pointing to the center
      assertClose(inward, S * (1 - d / R), 1e-9, `inward pull at d = ${d}`);
    }
  }
});

test('the swirl is perpendicular to the pull, 30% of it, and counterclockwise', () => {
  const w = voidWind();
  for (const [x, y] of [[100, 0], [0, 150], [-60, -80]]) {
    const d = Math.hypot(x, y);
    const p = suctionAt(w, x, y);
    // Counterclockwise direction at (x, y) is (-y, x) / d.
    const swirl = (p.vx * -y + p.vy * x) / d;
    assertClose(swirl, SUCTION_SWIRL * S * (1 - d / R), 1e-9, `swirl at (${x}, ${y})`);
  }
});

test('no NaN at the exact center', () => {
  const p = suctionAt(voidWind(), 0, 0);
  assertAllFinite([p.vx, p.vy], 'pull at the center');
});

test('suction 0 or a broken setting means no pull, never NaN', () => {
  for (const extra of [{ suction: 0 }, { suction: NaN }, { suction: -100 }, { voidRadius: 0 },
    { voidRadius: NaN }, { voidRadius: -5 }]) {
    const p = suctionAt(voidWind(extra), 50, 50);
    assert(p.vx === 0 && p.vy === 0, `${JSON.stringify(extra)}: (${p.vx}, ${p.vy})`);
  }
});

test('createWind without void settings has no suction and no capture (steps 5 and 6 unchanged)', () => {
  const w = createWind({ bearing: 90, speed: 100, friction: FRICTION });
  assert(w.suction === 0 && w.voidRadius === 0 && w.captureRadius === 0, JSON.stringify(w));
  const leaf = leafAt({ x: 0, y: 0 });
  stepLeaf(leaf, 1 / 60, w);
  assert(!leaf.captured, 'a leaf at the center was captured with no void');
});

test('at Calm, a leaf 150 units away is pulled in and caught within 5 s', () => {
  const leaf = leafAt({ x: 150, y: 0 });
  const w = voidWind();
  let caughtAt = null;
  for (let i = 0; i < 300 && caughtAt === null; i++) {
    stepLeaf(leaf, 1 / 60, w);
    if (leaf.captured) caughtAt = i / 60;
  }
  assert(caughtAt !== null, `not caught; ended ${dist(leaf).toFixed(1)} from the center`);
});

test('a Gale blowing through the middle catches a leaf', () => {
  const leaf = leafAt({ x: -700, y: 0 });
  const w = voidWind({ speed: 400 });
  for (let i = 0; i < 300 && !leaf.captured; i++) stepLeaf(leaf, 1 / 60, w);
  assert(leaf.captured, `not caught; at (${leaf.x.toFixed(1)}, ${leaf.y.toFixed(1)})`);
});

test('a leaf passing 150 units off center is bent inward', () => {
  const leaf = leafAt({ x: -700, y: 150 });
  const w = voidWind({ speed: 400 });
  let minY = 150;
  for (let i = 0; i < 240 && !leaf.captured; i++) {
    stepLeaf(leaf, 1 / 60, w);
    minY = Math.min(minY, leaf.y);
  }
  assert(leaf.captured || minY < 140, `lowest y ${minY.toFixed(1)}, never pulled toward the center`);
});

// ---------- Capture ----------

function capturedLeaf(extra = {}) {
  const leaf = leafAt({ x: 25, y: 0, ...extra });
  stepLeaf(leaf, 1 / 60, voidWind());
  assert(leaf.captured, 'setup: leaf at d = 25 was not captured');
  return leaf;
}

test('a leaf inside the capture radius is captured', () => {
  const leaf = capturedLeaf();
  assert(leaf.captured === true && !leaf.done, `captured ${leaf.captured}, done ${leaf.done}`);
});

test('a captured leaf gets closer to the center every frame', () => {
  const leaf = capturedLeaf();
  let last = dist(leaf);
  for (let i = 0; i < 30; i++) {
    stepLeaf(leaf, 1 / 60, voidWind());
    const d = dist(leaf);
    assert(d <= last + 1e-9, `distance grew from ${last} to ${d} at frame ${i}`);
    last = d;
  }
});

test('scale and fade go from 1 to 0 over 0.6 s, then the leaf is done', () => {
  const leaf = capturedLeaf({ scale: 1.2 });
  const w = voidWind();
  let lastScale = leaf.scale, lastFade = leaf.fade;
  for (let i = 0; i < 34; i++) {   // to just before 0.6 s
    stepLeaf(leaf, 1 / 60, w);
    assert(leaf.scale <= lastScale && leaf.fade <= lastFade, `grew at frame ${i}`);
    lastScale = leaf.scale;
    lastFade = leaf.fade;
  }
  assert(!leaf.done && leaf.fade > 0, `done too early (fade ${leaf.fade})`);
  for (let i = 0; i < 3; i++) stepLeaf(leaf, 1 / 60, w);   // past 0.6 s
  assert(leaf.done === true, 'not done after 0.6 s');
  assertClose(leaf.scale, 0, 1e-9, 'scale');
  assertClose(leaf.fade, 0, 1e-9, 'fade');
  assertClose(dist(leaf), 0, 1e-6, 'distance');
});

test('a captured leaf ignores wind and walls', () => {
  const leaf = capturedLeaf();
  const gale = voidWind({ speed: 400, bearing: 0 });
  const d0 = dist(leaf);
  for (let i = 0; i < 10; i++) stepLeaf(leaf, 1 / 60, gale);
  assert(dist(leaf) < d0, 'the wind carried a captured leaf away');
  assert(leaf.vx === 0 && leaf.vy === 0, `velocity (${leaf.vx}, ${leaf.vy})`);
});

test('capture time is measured in simulation time (dt), and a bad dt changes nothing', () => {
  const leaf = capturedLeaf();
  const before = { ...leaf };
  for (const dt of [0, -1, NaN]) stepLeaf(leaf, dt, voidWind());
  assert(leaf.x === before.x && leaf.fade === before.fade, 'a bad dt moved the capture on');
});

test('the capture radius can be switched off (0) while suction stays on', () => {
  const leaf = leafAt({ x: 10, y: 0 });
  stepLeaf(leaf, 1 / 60, voidWind({ captureRadius: 0 }));
  assert(!leaf.captured, 'captured with capture radius 0');
});

// ---------- Removal (swap-and-pop) ----------

function tagged(ids, doneIds) {
  return ids.map((id) => ({ id, done: doneIds.includes(id) }));
}

test('removeFinished removes exactly the done leaves and keeps the rest', () => {
  const leaves = tagged([0, 1, 2, 3, 4, 5, 6, 7], [1, 4, 6]);
  const removed = removeFinished(leaves);
  assert(removed === 3, `removed ${removed}`);
  const ids = leaves.map((l) => l.id).sort((a, b) => a - b);
  assert(ids.join(',') === '0,2,3,5,7', `left ${ids}`);
});

test('removeFinished handles done leaves next to each other and at the end', () => {
  const leaves = tagged([0, 1, 2, 3, 4], [2, 3, 4]);
  assert(removeFinished(leaves) === 3, 'count');
  assert(leaves.map((l) => l.id).sort().join(',') === '0,1', `left ${leaves.map((l) => l.id)}`);
});

test('removeFinished with all done empties the list, with none done changes nothing', () => {
  const all = tagged([0, 1, 2], [0, 1, 2]);
  assert(removeFinished(all) === 3 && all.length === 0, `left ${all.length}`);
  const none = tagged([0, 1, 2], []);
  assert(removeFinished(none) === 0 && none.map((l) => l.id).join(',') === '0,1,2', 'changed');
});

test('removeFinished on an empty or non-list input returns 0', () => {
  assert(removeFinished([]) === 0, 'empty');
  assert(removeFinished(undefined) === 0 && removeFinished(null) === 0, 'non-list');
});

test('removeFinished on 10,000 leaves with half done', () => {
  const leaves = [];
  for (let i = 0; i < 10000; i++) leaves.push({ id: i, done: i % 2 === 0 });
  assert(removeFinished(leaves) === 5000 && leaves.length === 5000, `length ${leaves.length}`);
  assert(leaves.every((l) => !l.done), 'a done leaf is left');
});

// ---------- Spawning ----------

test('no leaf spawns inside the attraction radius', () => {
  for (const leaf of spawnLeaves(1000, 21)) {
    assert(dist(leaf) >= VOID_RADIUS, `leaf at distance ${dist(leaf).toFixed(1)}`);
  }
});

test('spawning outside the void still gives the exact count, inside the world', () => {
  const leaves = spawnLeaves(1000, 22);
  assert(leaves.length === 1000, `length ${leaves.length}`);
  for (const leaf of leaves) {
    const r = leafRadius(leaf.scale);
    assert(Math.abs(leaf.x) <= WORLD_WIDTH / 2 - r + 1e-9 && Math.abs(leaf.y) <= WORLD_HEIGHT / 2 - r + 1e-9,
      `leaf outside the world at (${leaf.x}, ${leaf.y})`);
  }
});

test('the same seed gives the same layout, and every spawned leaf starts at fade 1, not captured', () => {
  const a = spawnLeaves(100, 23);
  const b = spawnLeaves(100, 23);
  assert(a.every((l, i) => l.x === b[i].x && l.y === b[i].y), 'layouts differ');
  assert(a.every((l) => l.fade === 1 && !l.captured && !l.done), 'a leaf starts faded or captured');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
