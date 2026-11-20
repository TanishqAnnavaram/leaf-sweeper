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
import {
  LEAF_COUNT, LEAF_SEED, FRICTION, WIND_MAX_SPEED, GUST_STRENGTH, GUST_SIZE, SPIN_AMOUNT,
  SUCTION_MAX, VOID_RADIUS, CAPTURE_RADIUS, VOID_X, VOID_Y, WORLD_WIDTH, WORLD_HEIGHT,
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

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
