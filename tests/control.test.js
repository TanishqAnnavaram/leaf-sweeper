// Step 8 wind control tests: mouse aim, hold to blow. Run with:  node tests/control.test.js

import { test, assert, assertClose, report } from './harness.js';
import {
  aimWind, createWindControl, setPointer, stepWindControl, pointerToWorld,
} from '../src/control.js';
import {
  AIM_CALM_RADIUS, AIM_GALE_DISTANCE, WIND_TURN_RATE, WIND_BUILD_TIME, WIND_MAX_SPEED, WIND_START,
  MAX_DT,
} from '../src/config.js';

const TOP = 400;
const P = { topSpeed: TOP, galeDistance: 600, turnRate: 180, buildTime: 0.3 };

// Hold the pointer at (x, y) for `seconds`, stepping at `hz`.
function hold(control, x, y, seconds, hz = 60, params = P) {
  setPointer(control, { holding: true, x, y });
  for (let i = 0; i < Math.round(seconds * hz); i++) stepWindControl(control, 1 / hz, params);
  return control;
}

function release(control, seconds, hz = 60) {
  setPointer(control, { holding: false });
  for (let i = 0; i < Math.round(seconds * hz); i++) stepWindControl(control, 1 / hz, P);
  return control;
}

// Smallest difference between two bearings, in degrees (0 to 180).
function bearingGap(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return Math.min(d, 360 - d);
}

// ---------- Config ----------

test('step 8 config: calm radius 40, Gale at 600, turn 180 deg/s, build time 0.3 s', () => {
  assert(AIM_CALM_RADIUS === 40 && AIM_GALE_DISTANCE === 600, `${AIM_CALM_RADIUS}, ${AIM_GALE_DISTANCE}`);
  assert(WIND_TURN_RATE === 180 && WIND_BUILD_TIME === 0.3, `${WIND_TURN_RATE}, ${WIND_BUILD_TIME}`);
});

// ---------- Aim: direction and strength from the cursor ----------

test('a cursor right of the void blows left (270), above it blows down (180)', () => {
  assertClose(aimWind(500, 0, P).bearing, 270, 1e-9, 'right of the void');
  assertClose(aimWind(0, 300, P).bearing, 180, 1e-9, 'above the void');
  assertClose(aimWind(-500, 0, P).bearing, 90, 1e-9, 'left of the void');
  assertClose(aimWind(0, -300, P).bearing, 0, 1e-9, 'below the void');
});

test('the top-left corner (-800, 450) blows toward the void at about 119 degrees', () => {
  const expected = (Math.atan2(800, -450) * 180) / Math.PI;   // 119.36
  assertClose(aimWind(-800, 450, P).bearing, expected, 1e-9, 'bearing');
});

test('the bearing is always in [0, 360) and points from the cursor to the void', () => {
  for (let i = 0; i < 72; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const x = 300 * Math.cos(a), y = 300 * Math.sin(a);
    const { bearing } = aimWind(x, y, P);
    assert(bearing >= 0 && bearing < 360, `bearing ${bearing}`);
    // The wind vector (sin b, cos b) must point from (x, y) toward (0, 0): a negative dot product with (x, y).
    const r = (bearing * Math.PI) / 180;
    assert(Math.sin(r) * x + Math.cos(r) * y < 0, `bearing ${bearing} does not point at the void from (${x}, ${y})`);
  }
});

test('strength: 0 within 40 of the void, half at 320, Gale at 600 and beyond', () => {
  assert(aimWind(0, 0, P).speed === 0 && aimWind(30, 0, P).speed === 0 && aimWind(40, 0, P).speed === 0, 'calm zone');
  assertClose(aimWind(320, 0, P).speed, TOP / 2, 1e-9, 'half way');
  assertClose(aimWind(600, 0, P).speed, TOP, 1e-9, 'at 600');
  assertClose(aimWind(-900, 300, P).speed, TOP, 1e-9, 'beyond 600');
});

test('strength scales with the top speed setting', () => {
  assertClose(aimWind(320, 0, { ...P, topSpeed: 200 }).speed, 100, 1e-9, 'half of 200');
});

test('a Gale distance at or below the calm radius does not divide by zero', () => {
  for (const galeDistance of [40, 10, 0, -5, NaN]) {
    const a = aimWind(300, 0, { ...P, galeDistance });
    assert(Number.isFinite(a.speed) && a.speed >= 0 && a.speed <= TOP, `gale ${galeDistance}: speed ${a.speed}`);
  }
});

test('a NaN or Infinity cursor gives no aim', () => {
  for (const [x, y] of [[NaN, 0], [0, Infinity], [undefined, 3]]) {
    assert(aimWind(x, y, P) === null, `(${x}, ${y})`);
  }
});

// ---------- Holding and releasing ----------

test('a new control is Calm, not holding, pointing at the start bearing', () => {
  const c = createWindControl();
  assert(c.speed === 0 && !c.holding && c.bearing === WIND_START.bearing, JSON.stringify(c));
});

test('holding builds the wind toward the aim', () => {
  const c = hold(createWindControl(), 600, 0, 2);
  assertClose(c.bearing, 270, 1e-9, 'bearing');
  assert(c.speed > 0.99 * TOP, `speed ${c.speed}`);
});

test('releasing sets the target to Calm and keeps the last direction', () => {
  const c = hold(createWindControl(), 600, 0, 2);
  release(c, 0.3);
  assertClose(c.bearing, 270, 1e-9, 'bearing kept');
  assert(c.speed < 0.5 * TOP && c.speed > 0, `speed ${c.speed}`);
  release(c, 3);
  assert(c.speed === 0, `speed ${c.speed} after 3.3 s released (should reach exactly 0)`);
});

test('a NaN cursor counts as not holding', () => {
  const c = createWindControl();
  setPointer(c, { holding: true, x: NaN, y: 5 });
  assert(!c.holding, 'holding with a NaN cursor');
});

test('holding on the void itself blows nothing and keeps the direction', () => {
  const c = hold(createWindControl(), 600, 0, 1);
  hold(c, 10, -5, 3);
  assertClose(c.bearing, 270, 1e-9, 'bearing');
  assert(c.speed < 1, `speed ${c.speed}`);
});

// ---------- Build-up ----------

test('after 0.3 s from Calm the wind is about 63% of the target (1 - e^-1)', () => {
  const c = hold(createWindControl(), 600, 0, 0.3);
  assertClose(c.speed, TOP * (1 - Math.exp(-1)), 1e-6, 'speed');
});

test('the build-up never overshoots the target', () => {
  const c = createWindControl();
  setPointer(c, { holding: true, x: 600, y: 0 });
  for (let i = 0; i < 300; i++) {
    stepWindControl(c, 1 / 60, P);
    assert(c.speed <= TOP + 1e-9, `speed ${c.speed} at frame ${i}`);
  }
});

test('the build-up is the same at 30, 60, and 144 FPS', () => {
  const speeds = [30, 60, 144].map((hz) => hold(createWindControl(), 600, 0, 0.5, hz).speed);
  assertClose(speeds[1], speeds[0], 1e-9, '60 vs 30');
  assertClose(speeds[2], speeds[0], 1e-9, '144 vs 30');
});

test('build time 0 means the wind changes instantly', () => {
  const c = hold(createWindControl(), 600, 0, 1 / 60, 60, { ...P, buildTime: 0 });
  assertClose(c.speed, TOP, 1e-9, 'speed');
});

// ---------- Turning ----------

test('turning is limited to 180 degrees per second', () => {
  const c = hold(createWindControl(), 600, 0, 1);        // blowing 270 at full strength
  hold(c, 0, -600, 0.25);                                 // now aim to blow 0 (up): 90 degrees away
  assertClose(bearingGap(c.bearing, 270), 45, 1e-6, 'turned 45 degrees in 0.25 s');
});

test('turns go the short way around through 0', () => {
  const c = createWindControl({ bearing: 350 });
  c.speed = 300;                                          // not Calm, so it must turn, not jump
  setPointer(c, { holding: true, x: -Math.sin((10 * Math.PI) / 180) * 600, y: -Math.cos((10 * Math.PI) / 180) * 600 });
  stepWindControl(c, 1 / 60, P);                          // 3 degrees per frame at 180 deg/s
  assertClose(c.bearing, 353, 1e-6, 'bearing after one frame');
  for (let i = 0; i < 10; i++) stepWindControl(c, 1 / 60, P);
  assertClose(c.bearing, 10, 1e-6, 'arrived at 10 by crossing 0');
});

test('turning never overshoots the target', () => {
  const c = createWindControl({ bearing: 80 });
  c.speed = 300;
  setPointer(c, { holding: true, x: -600, y: 0 });       // target 90
  stepWindControl(c, 1 / 30, P);                          // could turn 6, needs 10
  stepWindControl(c, 1 / 30, P);                          // could turn 6, needs 4
  assertClose(c.bearing, 90, 1e-9, 'bearing');
});

test('an exact reversal turns clockwise (the bearing goes up)', () => {
  const c = createWindControl({ bearing: 90 });
  c.speed = 300;
  setPointer(c, { holding: true, x: 600, y: 0 });        // target 270, exactly opposite
  stepWindControl(c, 1 / 60, P);
  assertClose(c.bearing, 93, 1e-6, 'bearing');
});

test('at Calm, a new press points straight at the new direction', () => {
  const c = createWindControl({ bearing: 90 });
  hold(c, 600, 0, 1 / 60);                                // target 270, but the wind is Calm
  assertClose(c.bearing, 270, 1e-9, 'bearing');
});

// ---------- Bad input ----------

test('a bad dt changes nothing, a huge dt is clamped to 1/30 s', () => {
  const c = createWindControl();
  setPointer(c, { holding: true, x: 600, y: 0 });
  for (const dt of [0, -1, NaN, Infinity]) stepWindControl(c, dt, P);
  assert(c.speed === 0, `speed ${c.speed}`);
  stepWindControl(c, 10, P);
  assertClose(c.speed, TOP * (1 - Math.exp(-MAX_DT / 0.3)), 1e-9, 'speed after a 10 s dt');
});

test('missing or broken parameters fall back to the defaults', () => {
  const c = createWindControl();
  setPointer(c, { holding: true, x: 600, y: 0 });
  stepWindControl(c, 1 / 60, { topSpeed: NaN, turnRate: -1, buildTime: NaN, galeDistance: undefined });
  assert(Number.isFinite(c.speed) && Number.isFinite(c.bearing), JSON.stringify(c));
  assert(c.speed > 0 && c.speed <= WIND_MAX_SPEED, `speed ${c.speed}`);
});

// ---------- Mouse position to world position ----------

test('pointerToWorld: canvas center is the void, corners are the world corners (16:9 canvas)', () => {
  const rect = { left: 0, top: 0, width: 1280, height: 720 };
  const c = pointerToWorld(640, 360, rect);
  assertClose(c[0], 0, 1e-9, 'x'); assertClose(c[1], 0, 1e-9, 'y');
  const tl = pointerToWorld(0, 0, rect);
  assertClose(tl[0], -800, 1e-9, 'top-left x'); assertClose(tl[1], 450, 1e-9, 'top-left y');
  const br = pointerToWorld(1280, 720, rect);
  assertClose(br[0], 800, 1e-9, 'bottom-right x'); assertClose(br[1], -450, 1e-9, 'bottom-right y');
});

test('pointerToWorld uses the canvas position on the page (offset canvas)', () => {
  const rect = { left: 100, top: 50, width: 1280, height: 720 };
  const c = pointerToWorld(740, 410, rect);
  assertClose(c[0], 0, 1e-9, 'x'); assertClose(c[1], 0, 1e-9, 'y');
});

test('pointerToWorld works in CSS pixels, so the pixel ratio does not matter', () => {
  // The same CSS rectangle on a pixel ratio 1 and a pixel ratio 2 screen gives the same answer:
  // pointer events and getBoundingClientRect are both in CSS pixels.
  const rect = { left: 0, top: 0, width: 800, height: 450 };
  const a = pointerToWorld(200, 100, rect);
  assertClose(a[0], -400, 1e-9, 'x'); assertClose(a[1], 250, 1e-9, 'y');
});

test('a click in the letterbox bars still gives a world position and a direction', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 1000 };   // tall window: bars above and below
  const p = pointerToWorld(500, 10, rect);                       // in the top bar
  assert(p[1] > 450, `y ${p[1]} should be above the world`);
  const aim = aimWind(p[0], p[1], P);
  assertClose(aim.bearing, 180, 1e-9, 'blows down');
});

test('pointerToWorld with a zero-size canvas gives finite numbers', () => {
  const p = pointerToWorld(5, 5, { left: 0, top: 0, width: 0, height: 0 });
  assert(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${p}`);
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
