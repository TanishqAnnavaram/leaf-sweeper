// Step 7 playability test: can a simple scripted player win with the default settings?
// Node only (it simulates minutes of play, which would freeze the browser test page).
// Run with:  node tests/play.test.js
//
// The script repeats one plan for each corner of the world:
//   1. Gale toward the corner for 4 s: leaves slide along the walls and gather there.
//   2. Gale from that corner straight at the void for 5 s: the pile crosses the middle.
// Leaves that miss the void end up in the opposite corner and are picked up on a later pass.

import { test, assert, report } from './harness.js';
import {
  stepLeaf, spawnLeaves, createWind, createGusts, advanceGusts, removeFinished,
} from '../src/physics.js';
import { createNoise } from '../src/noise.js';
import { createGame, updateGame } from '../src/game.js';
import { createWindControl, setPointer, stepWindControl } from '../src/control.js';
import {
  LEAF_COUNT, LEAF_SEED, FRICTION, WIND_MAX_SPEED, GUST_STRENGTH, GUST_SIZE, SPIN_AMOUNT,
  SUCTION_MAX, VOID_RADIUS, CAPTURE_RADIUS, VOID_X, VOID_Y, WORLD_WIDTH, WORLD_HEIGHT,
  AIM_GALE_DISTANCE, WIND_TURN_RATE, WIND_BUILD_TIME,
} from '../src/config.js';

const DT = 1 / 30;   // simulation step for the test (the game clamps to 1/30 too)

// Compass bearing from point a to point b (0 = up, 90 = right).
function bearingTo(ax, ay, bx, by) {
  return (Math.atan2(bx - ax, by - ay) * 180) / Math.PI;
}

function playScript(maxSeconds) {
  const leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED);
  const game = createGame(leaves.length);
  const gusts = createGusts(createNoise(LEAF_SEED));
  const settings = {
    bearing: 90, speed: WIND_MAX_SPEED, friction: FRICTION, gustStrength: GUST_STRENGTH,
    gustSize: GUST_SIZE, spinAmount: SPIN_AMOUNT, suction: SUCTION_MAX, voidRadius: VOID_RADIUS,
    captureRadius: CAPTURE_RADIUS,
  };
  const hw = WORLD_WIDTH / 2, hh = WORLD_HEIGHT / 2;
  const corners = [[-hw, hh], [hw, -hh], [hw, hh], [-hw, -hh]];   // alternate opposite corners
  const plan = [];
  for (const [cx, cy] of corners) {
    plan.push({ bearing: bearingTo(0, 0, cx, cy), seconds: 4 });          // gather in the corner
    plan.push({ bearing: bearingTo(cx, cy, VOID_X, VOID_Y), seconds: 5 }); // blow through the void
  }

  let t = 0;
  while (t < maxSeconds && !game.won) {
    for (const move of plan) {
      settings.bearing = move.bearing;
      for (let s = 0; s < move.seconds && !game.won; s += DT) {
        const wind = createWind(settings, gusts);
        for (const leaf of leaves) stepLeaf(leaf, DT, wind);
        advanceGusts(gusts, wind, DT);
        const removed = removeFinished(leaves);
        updateGame(game, { dt: DT, windSpeed: settings.speed, removed, remaining: leaves.length });
        t += DT;
      }
      if (game.won || t >= maxSeconds) break;
    }
  }
  return { game, left: leaves.length, seconds: t };
}

test('a scripted player clears all 1000 leaves within 5 simulated minutes', () => {
  const started = Date.now();
  const result = playScript(300);
  const realSeconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  scripted player: cleared ${result.game.cleared} of ${result.game.total}, `
    + `${result.left} left, game time ${result.seconds.toFixed(1)} s, real time ${realSeconds} s`);
  assert(result.game.won, `not won: ${result.left} leaves left after ${result.seconds.toFixed(0)} s`);
  assert(result.game.cleared === LEAF_COUNT, `cleared ${result.game.cleared}`);
});

// ---------- Step 8: the same plan, played with the mouse-aim controller ----------
// The player "holds the mouse" at a spot; the wind blows from there toward the void, and it can
// only turn at WIND_TURN_RATE and build up over WIND_BUILD_TIME, as in the real game.
//   gather in corner c:  hold the cursor on the opposite side of the void, 700 units out (a Gale)
//   sweep from corner c:  hold the cursor on the corner itself (918 units out, a Gale)

function playMouseScript(maxSeconds) {
  const leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED);
  const game = createGame(leaves.length);
  const gusts = createGusts(createNoise(LEAF_SEED));
  const control = createWindControl();
  const settings = {
    bearing: control.bearing, speed: 0, friction: FRICTION, gustStrength: GUST_STRENGTH,
    gustSize: GUST_SIZE, spinAmount: SPIN_AMOUNT, suction: SUCTION_MAX, voidRadius: VOID_RADIUS,
    captureRadius: CAPTURE_RADIUS, topSpeed: WIND_MAX_SPEED, galeDistance: AIM_GALE_DISTANCE,
    turnRate: WIND_TURN_RATE, buildTime: WIND_BUILD_TIME,
  };
  const hw = WORLD_WIDTH / 2, hh = WORLD_HEIGHT / 2;
  const corners = [[-hw, hh], [hw, -hh], [hw, hh], [-hw, -hh]];
  const plan = [];
  for (const [cx, cy] of corners) {
    const d = Math.hypot(cx, cy);
    plan.push({ x: (-cx / d) * 700, y: (-cy / d) * 700, seconds: 4 });   // gather in the corner
    plan.push({ x: cx, y: cy, seconds: 5 });                             // blow through the void
  }

  let t = 0;
  while (t < maxSeconds && !game.won) {
    for (const move of plan) {
      setPointer(control, { holding: true, x: move.x, y: move.y });
      for (let s = 0; s < move.seconds && !game.won; s += DT) {
        stepWindControl(control, DT, settings);
        settings.bearing = control.bearing;
        settings.speed = control.speed;
        const wind = createWind(settings, gusts);
        for (const leaf of leaves) stepLeaf(leaf, DT, wind);
        advanceGusts(gusts, wind, DT);
        const removed = removeFinished(leaves);
        updateGame(game, { dt: DT, windSpeed: settings.speed, removed, remaining: leaves.length });
        t += DT;
      }
      if (game.won || t >= maxSeconds) break;
    }
  }
  return { game, left: leaves.length, seconds: t };
}

test('a scripted player using the mouse-aim controls also wins within 5 simulated minutes', () => {
  const result = playMouseScript(300);
  console.log(`  mouse-aim player: cleared ${result.game.cleared} of ${result.game.total}, `
    + `${result.left} left, game time ${result.seconds.toFixed(1)} s`);
  assert(result.game.won, `not won: ${result.left} leaves left after ${result.seconds.toFixed(0)} s`);
});

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
