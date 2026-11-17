// Step 2 math tests. Run with:  node tests/math.test.js
// These test src/math.js only. No WebGL is involved.

import { test, assert, assertClose, assertAllClose, assertAllFinite, report } from './harness.js';
import {
  identity, multiply, translation, rotation, scaling, transformPoint,
  fitScale, projection, worldRect, worldToScreen, screenToWorld, leafMatrix,
} from '../src/math.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../src/config.js';

const W = WORLD_WIDTH;    // 1600
const H = WORLD_HEIGHT;   // 900
const TOL = 1e-9;

// ---------- Spec 1: world size ----------

test('world is 1600 x 900 units', () => {
  assert(W === 1600 && H === 900, `got ${W} x ${H}`);
});

// ---------- Basic matrix functions ----------

test('identity leaves a point unchanged', () => {
  assertAllClose(transformPoint(identity(), 12.5, -7), [12.5, -7], TOL);
});

test('translation moves a point', () => {
  assertAllClose(transformPoint(translation(100, -50), 1, 2), [101, -48], TOL);
});

test('scaling stretches a point', () => {
  assertAllClose(transformPoint(scaling(2, 3), 4, 5), [8, 15], TOL);
});

test('multiply(a, b) applies b first, then a', () => {
  // Scale by 2 first, then move by (10, 0): (1, 1) -> (2, 2) -> (12, 2)
  const m = multiply(translation(10, 0), scaling(2, 2));
  assertAllClose(transformPoint(m, 1, 1), [12, 2], TOL);
  // The other order gives a different answer: move first, then scale: (1, 1) -> (11, 1) -> (22, 2)
  const n = multiply(scaling(2, 2), translation(10, 0));
  assertAllClose(transformPoint(n, 1, 1), [22, 2], TOL);
});

test('multiplying by identity changes nothing', () => {
  const m = multiply(translation(3, 4), rotation(0.7));
  assertAllClose(multiply(m, identity()), m, TOL);
  assertAllClose(multiply(identity(), m), m, TOL);
});

// ---------- Spec 5: angle in radians, counterclockwise positive ----------

test('rotation by 90 degrees maps (1, 0) to (0, 1)', () => {
  assertAllClose(transformPoint(rotation(Math.PI / 2), 1, 0), [0, 1], TOL);
});

test('rotation by 180 degrees maps (1, 0) to (-1, 0)', () => {
  assertAllClose(transformPoint(rotation(Math.PI), 1, 0), [-1, 0], TOL);
});

test('negative angle rotates clockwise', () => {
  assertAllClose(transformPoint(rotation(-Math.PI / 2), 1, 0), [0, -1], TOL);
});

test('an angle above 2*pi equals its wrapped value', () => {
  const a = transformPoint(rotation(0.5 + 2 * Math.PI), 3, 4);
  const b = transformPoint(rotation(0.5), 3, 4);
  assertAllClose(a, b, 1e-9);
  // Many full turns, as will happen to a leaf that tumbles for minutes.
  const c = transformPoint(rotation(0.5 + 2 * Math.PI * 1000), 3, 4);
  assertAllClose(c, b, 1e-6);
});

test('rotation keeps the distance from the origin', () => {
  const [x, y] = transformPoint(rotation(1.234), 3, 4);
  assertClose(Math.hypot(x, y), 5, TOL);
});

// ---------- Spec 2: projection with the "contain" fit rule ----------

test('world center maps to the clip-space center', () => {
  assertAllClose(transformPoint(projection(W, H, 1600, 900), 0, 0), [0, 0], TOL);
  assertAllClose(transformPoint(projection(W, H, 1000, 300), 0, 0), [0, 0], TOL);
});

test('16:9 window: world corners map to the clip edges', () => {
  const p = projection(W, H, 1280, 720);
  assertAllClose(transformPoint(p, 800, 450), [1, 1], TOL);
  assertAllClose(transformPoint(p, -800, -450), [-1, -1], TOL);
  assertAllClose(transformPoint(p, -800, 450), [-1, 1], TOL);
  assertAllClose(transformPoint(p, 800, -450), [1, -1], TOL);
});

test('y is up: a positive world y gives a positive clip y', () => {
  const [, y] = transformPoint(projection(W, H, 1280, 720), 0, 100);
  assert(y > 0, `clip y was ${y}`);
});

test('wider window: bars on the left and right', () => {
  // 2000 x 900 window: the world is 1600 px wide, so it covers 1600/2000 = 0.8 of the width.
  const p = projection(W, H, 2000, 900);
  assertAllClose(transformPoint(p, 800, 450), [0.8, 1], TOL);
  assertAllClose(transformPoint(p, -800, -450), [-0.8, -1], TOL);
});

test('taller window: bars on the top and bottom', () => {
  // 1600 x 1800 window: the world is 900 px tall, so it covers 900/1800 = 0.5 of the height.
  const p = projection(W, H, 1600, 1800);
  assertAllClose(transformPoint(p, 800, 450), [1, 0.5], TOL);
  assertAllClose(transformPoint(p, -800, -450), [-1, -0.5], TOL);
});

test('phone portrait window (390 x 844): whole world still visible', () => {
  const [x, y] = transformPoint(projection(W, H, 390, 844), 800, 450);
  assertClose(x, 1, TOL, 'clip x');
  assert(y > 0 && y < 1, `clip y should be inside the window, got ${y}`);
});

test('the world is never stretched: one unit is the same pixel length in x and y', () => {
  for (const [cw, ch] of [[1280, 720], [2000, 900], [390, 844], [1, 5000]]) {
    const p = projection(W, H, cw, ch);
    const [cx] = transformPoint(p, 1, 0);
    const [, cy] = transformPoint(p, 0, 1);
    // clip units -> pixels: multiply by half the canvas size
    assertClose(cx * cw / 2, cy * ch / 2, 1e-9, `pixels per unit at ${cw}x${ch}`);
  }
});

test('pixel ratios 1, 2 and 3 give the same clip position', () => {
  const base = transformPoint(projection(W, H, 800, 600), 400, -200);
  for (const dpr of [2, 3]) {
    const scaled = transformPoint(projection(W, H, 800 * dpr, 600 * dpr), 400, -200);
    assertAllClose(scaled, base, TOL, `dpr ${dpr}`);
  }
});

test('fitScale picks the smaller of the two ratios', () => {
  assertClose(fitScale(W, H, 1600, 900), 1, TOL);
  assertClose(fitScale(W, H, 800, 450), 0.5, TOL);
  assertClose(fitScale(W, H, 2000, 900), 1, TOL);
  assertClose(fitScale(W, H, 1600, 1800), 1, TOL);
});

// ---------- Edge cases: bad canvas sizes must not produce NaN or Infinity ----------

test('zero-size canvas (minimized window) gives finite numbers', () => {
  for (const [cw, ch] of [[0, 0], [0, 600], [800, 0]]) {
    assertAllFinite(projection(W, H, cw, ch), `projection ${cw}x${ch}`);
    assertAllFinite(transformPoint(projection(W, H, cw, ch), 400, 300), `point ${cw}x${ch}`);
    assertAllFinite(screenToWorld(10, 10, W, H, cw, ch), `screenToWorld ${cw}x${ch}`);
    assertAllFinite(worldToScreen(10, 10, W, H, cw, ch), `worldToScreen ${cw}x${ch}`);
    assertClose(fitScale(W, H, cw, ch), 0, TOL, 'fitScale');
  }
});

test('negative, NaN and Infinity canvas sizes give finite numbers', () => {
  for (const [cw, ch] of [[-800, 600], [NaN, 600], [800, Infinity], [undefined, undefined]]) {
    assertAllFinite(projection(W, H, cw, ch), 'projection');
    assertAllFinite(screenToWorld(10, 10, W, H, cw, ch), 'screenToWorld');
  }
});

test('zero-size world gives finite numbers', () => {
  assertAllFinite(projection(0, 0, 800, 600), 'projection');
  assertAllFinite(screenToWorld(10, 10, 0, 0, 800, 600), 'screenToWorld');
});

// ---------- World rectangle inside the canvas (used to paint the ground) ----------

test('worldRect fills a 16:9 canvas exactly', () => {
  const r = worldRect(W, H, 1280, 720);
  assertAllClose([r.x, r.y, r.width, r.height], [0, 0, 1280, 720], TOL);
});

test('worldRect is centered with side bars in a wide canvas', () => {
  const r = worldRect(W, H, 2000, 900);
  assertAllClose([r.x, r.y, r.width, r.height], [200, 0, 1600, 900], TOL);
});

test('worldRect is centered with top and bottom bars in a tall canvas', () => {
  const r = worldRect(W, H, 1600, 1800);
  assertAllClose([r.x, r.y, r.width, r.height], [0, 450, 1600, 900], TOL);
});

test('worldRect of a zero-size canvas is empty and finite', () => {
  const r = worldRect(W, H, 0, 0);
  assertAllClose([r.x, r.y, r.width, r.height], [0, 0, 0, 0], TOL);
});

// ---------- Screen (mouse) position to world position ----------

test('screen center is world (0, 0)', () => {
  assertAllClose(screenToWorld(640, 360, W, H, 1280, 720), [0, 0], TOL);
});

test('screen top-left is world top-left (y flips)', () => {
  assertAllClose(screenToWorld(0, 0, W, H, 1280, 720), [-800, 450], TOL);
});

test('screen bottom-right is world bottom-right', () => {
  assertAllClose(screenToWorld(1280, 720, W, H, 1280, 720), [800, -450], TOL);
});

test('a click inside a side bar gives a world x outside the world', () => {
  const [x] = screenToWorld(0, 450, W, H, 2000, 900);
  assertClose(x, -1000, TOL, 'world x');
});

test('world -> screen -> world returns the same point', () => {
  for (const [vw, vh] of [[1280, 720], [2000, 900], [390, 844]]) {
    for (const [x, y] of [[0, 0], [800, 450], [-123.4, 56.7], [-800, -450]]) {
      const [sx, sy] = worldToScreen(x, y, W, H, vw, vh);
      assertAllClose(screenToWorld(sx, sy, W, H, vw, vh), [x, y], 1e-9, `${x},${y} at ${vw}x${vh}`);
    }
  }
});

// ---------- Spec 4: leaf transform (must match the vertex shader) ----------
// Order: scale first, then rotate, then move.

test('leaf with no rotation and scale 1 is just moved', () => {
  assertAllClose(transformPoint(leafMatrix(100, 200, 0, 1), 20, 12), [120, 212], TOL);
});

test('leaf rotated 90 degrees: its long side becomes vertical', () => {
  // Corner (20, 12) rotates to (-12, 20), then moves by (100, 200).
  assertAllClose(transformPoint(leafMatrix(100, 200, Math.PI / 2, 1), 20, 12), [88, 220], TOL);
});

test('leaf scale 2 doubles its size around its own center', () => {
  assertAllClose(transformPoint(leafMatrix(100, 200, 0, 2), 20, 12), [140, 224], TOL);
});

test('leaf center always lands on its position', () => {
  assertAllClose(transformPoint(leafMatrix(-300, 50, 2.2, 3.5), 0, 0), [-300, 50], TOL);
});

test('leaf scale 0 collapses every corner onto the position, with finite numbers', () => {
  const m = leafMatrix(100, 200, 1.0, 0);
  assertAllFinite(m, 'matrix');
  assertAllClose(transformPoint(m, 20, 12), [100, 200], TOL);
  assertAllClose(transformPoint(m, -20, -12), [100, 200], TOL);
});

test('leaf negative scale equals a half-turn (pi) rotation', () => {
  const a = transformPoint(leafMatrix(10, 20, 0.3, -1.5), 20, 12);
  const b = transformPoint(leafMatrix(10, 20, 0.3 + Math.PI, 1.5), 20, 12);
  assertAllClose(a, b, 1e-9);
});

test('full chain: leaf corner -> world -> clip in a 16:9 window', () => {
  // Leaf at (400, 0), no rotation: corner (20, 12) is at world (420, 12).
  const m = multiply(projection(W, H, 1600, 900), leafMatrix(400, 0, 0, 1));
  assertAllClose(transformPoint(m, 20, 12), [420 / 800, 12 / 450], TOL);
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
