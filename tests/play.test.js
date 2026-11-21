// Playability tests (steps 7 to 9b): can scripted players win with the default settings, and is the
// corner-pile exploit no longer a shortcut? Node only (it simulates minutes of play, which would freeze
// the browser test page). Run with:  node tests/play.test.js
//
// Each frame runs the same steps as the real game (src/main.js): pile shelter, move every leaf, spread
// overfull squares, drift the gusts, remove finished leaves, update the score.

import { test, assert, report } from './harness.js';
import {
  stepLeaf, spawnLeaves, createWind, createGusts, advanceGusts, removeFinished,
} from '../src/physics.js';
import { createNoise } from '../src/noise.js';
import { createGame, updateGame } from '../src/game.js';
import { createWindControl, setPointer, stepWindControl } from '../src/control.js';
import { createCrowd, countCells, shelterLeaves, spreadLeaves } from '../src/crowd.js';
import {
  LEAF_COUNT, LEAF_SEED, FRICTION, WIND_MAX_SPEED, GUST_STRENGTH, GUST_SIZE, SPIN_AMOUNT,
  SUCTION_MAX, VOID_RADIUS, CAPTURE_RADIUS, VOID_X, VOID_Y, WORLD_WIDTH, WORLD_HEIGHT,
  AIM_GALE_DISTANCE, WIND_TURN_RATE, WIND_BUILD_TIME, OBSTACLES, PILE_CAP, SPREAD_SPEED, SHELTER,
} from '../src/config.js';

// Single sweeps depend a lot on where the gust patches are, so each player is checked with the gust
// clock started at these times (seconds), as if the page had been open that long (step 9).
const GUST_CLOCKS = [0, 10, 37, 60, 123];
const DT = 1 / 30;   // simulation step for the test (the game clamps to 1/30 too)
const HW = WORLD_WIDTH / 2;
const HH = WORLD_HEIGHT / 2;
// Below this many leaves, the fixed-route players switch to a mop-up: blow the rest into one corner for
// 8 s, then keep the cursor behind their middle for 12 s, repeated. (Chasing the leaf farthest from the
// void, as first planned, fails: the wind blows one way over the whole field, so blowing one straggler
// in blows the stragglers on the other side away.)
const MOP_UP_BELOW = 100;

// Compass bearing from point a to point b (0 = up, 90 = right).
function bearingTo(ax, ay, bx, by) {
  return (Math.atan2(bx - ax, by - ay) * 180) / Math.PI;
}

// A new game: leaves, score, gusts at the given clock, pile rules, and the settings the game uses.
function newGame(gustClock) {
  const leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED);
  const gusts = createGusts(createNoise(LEAF_SEED));
  gusts.time = gustClock;
  const settings = {
    bearing: 90, speed: 0, friction: FRICTION, gustStrength: GUST_STRENGTH, gustSize: GUST_SIZE,
    spinAmount: SPIN_AMOUNT, suction: SUCTION_MAX, voidRadius: VOID_RADIUS, captureRadius: CAPTURE_RADIUS,
    topSpeed: WIND_MAX_SPEED, galeDistance: AIM_GALE_DISTANCE, turnRate: WIND_TURN_RATE,
    buildTime: WIND_BUILD_TIME, obstacles: OBSTACLES, pileCap: PILE_CAP, spreadSpeed: SPREAD_SPEED,
    shelter: SHELTER,
  };
  return { leaves, game: createGame(leaves.length), gusts, settings, crowd: createCrowd(), t: 0 };
}

// One frame, in the same order as main.js.
function frame(g) {
  const { leaves, gusts, settings, crowd } = g;
  const rules = { cap: settings.pileCap, spreadSpeed: settings.spreadSpeed, shelter: settings.shelter, obstacles: settings.obstacles };
  const wind = createWind(settings, gusts);
  countCells(crowd, leaves);
  shelterLeaves(crowd, leaves, rules);
  for (const leaf of leaves) stepLeaf(leaf, DT, wind);
  countCells(crowd, leaves);
  spreadLeaves(crowd, leaves, DT, rules);
  advanceGusts(gusts, wind, DT);
  const removed = removeFinished(leaves);
  updateGame(g.game, { dt: DT, windSpeed: settings.speed, removed, remaining: leaves.length });
  g.t += DT;
}

// The cursor spot behind a point, on the line from the void through it: holding there blows the point
// straight at the void. At least 450 units out, so the wind is strong.
function behind(x, y) {
  const d = Math.hypot(x - VOID_X, y - VOID_Y) || 1;
  const reach = Math.max(d + 250, 450);
  return { x: VOID_X + ((x - VOID_X) / d) * reach, y: VOID_Y + ((y - VOID_Y) / d) * reach };
}

// The middle of the leaves that are not caught yet.
function middle(leaves) {
  let x = 0, y = 0, n = 0;
  for (const l of leaves) {
    if (!l.captured) { x += l.x; y += l.y; n++; }
  }
  return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

// ---------- Step 7: instant aim. Each corner: Gale toward it for 4 s (gather), then from it at the
// void for 5 s (sweep). Step 9b: below 100 leaves, the mop-up (see MOP_UP_BELOW). ----------
function playScript(maxSeconds, gustClock = 0) {
  const g = newGame(gustClock);
  g.settings.speed = WIND_MAX_SPEED;
  const corners = [[-HW, HH], [HW, -HH], [HW, HH], [-HW, -HH]];   // alternate opposite corners
  const plan = [];
  for (const [cx, cy] of corners) {
    plan.push({ bearing: bearingTo(0, 0, cx, cy), seconds: 4 });
    plan.push({ bearing: bearingTo(cx, cy, VOID_X, VOID_Y), seconds: 5 });
  }
  while (g.t < maxSeconds && !g.game.won) {
    if (g.leaves.length <= MOP_UP_BELOW) {
      g.settings.bearing = bearingTo(HW, HH, VOID_X, VOID_Y);   // pile into the bottom-left corner
      for (let s = 0; s < 8 && !g.game.won; s += DT) frame(g);
      for (let s = 0; s < 12 && !g.game.won; s += DT) {
        const m = middle(g.leaves);
        g.settings.bearing = bearingTo(m.x, m.y, VOID_X, VOID_Y);   // push the lump at the void
        frame(g);
      }
      continue;
    }
    for (const move of plan) {
      g.settings.bearing = move.bearing;
      for (let s = 0; s < move.seconds && !g.game.won; s += DT) frame(g);
      if (g.game.won || g.t >= maxSeconds || g.leaves.length <= MOP_UP_BELOW) break;
    }
  }
  return { game: g.game, left: g.leaves.length, seconds: g.t };
}

// ---------- Step 8: the same plan with the mouse-aim controller (turn limit and build-up). ----------
// Gather in corner c: hold the cursor on the other side of the void, 700 units out (a Gale).
// Sweep from corner c: hold the cursor on the corner itself. Step 9b: below 100 leaves, the mop-up.
function playMouseScript(maxSeconds, gustClock = 0) {
  const g = newGame(gustClock);
  const control = createWindControl();
  const corners = [[-HW, HH], [HW, -HH], [HW, HH], [-HW, -HH]];
  const plan = [];
  for (const [cx, cy] of corners) {
    const d = Math.hypot(cx, cy);
    plan.push({ x: (-cx / d) * 700, y: (-cy / d) * 700, seconds: 4 });
    plan.push({ x: cx, y: cy, seconds: 5 });
  }
  const mouseFrame = () => {
    stepWindControl(control, DT, g.settings);
    g.settings.bearing = control.bearing;
    g.settings.speed = control.speed;
    frame(g);
  };
  while (g.t < maxSeconds && !g.game.won) {
    if (g.leaves.length <= MOP_UP_BELOW) {
      setPointer(control, { holding: true, x: HW, y: HH });   // pile into the bottom-left corner
      for (let s = 0; s < 8 && !g.game.won; s += DT) mouseFrame();
      for (let s = 0; s < 12 && !g.game.won; s += DT) {
        const m = middle(g.leaves);
        setPointer(control, { holding: true, ...behind(m.x, m.y) });
        mouseFrame();
      }
      continue;
    }
    for (const move of plan) {
      setPointer(control, { holding: true, x: move.x, y: move.y });
      for (let s = 0; s < move.seconds && !g.game.won; s += DT) mouseFrame();
      if (g.game.won || g.t >= maxSeconds || g.leaves.length <= MOP_UP_BELOW) break;
    }
  }
  return { game: g.game, left: g.leaves.length, seconds: g.t };
}

// ---------- Step 9b: the corner-pile exploit (found by Tanishq on Nov 20). ----------
// Hold the cursor in the top-right corner for 8 s: every leaf piles into the bottom-left corner.
// Then for 12 s keep the cursor behind the middle of the pile, so the wind pushes the pile straight
// at the void. Repeat. Before step 9b this won in 12 s at most gust clocks.
function playExploit(maxSeconds, gustClock = 0) {
  const g = newGame(gustClock);
  const control = createWindControl();
  const mouseFrame = () => {
    stepWindControl(control, DT, g.settings);
    g.settings.bearing = control.bearing;
    g.settings.speed = control.speed;
    frame(g);
  };
  while (g.t < maxSeconds && !g.game.won) {
    setPointer(control, { holding: true, x: HW, y: HH });
    for (let s = 0; s < 8 && !g.game.won; s += DT) mouseFrame();
    for (let s = 0; s < 12 && !g.game.won; s += DT) {
      const m = middle(g.leaves);
      setPointer(control, { holding: true, ...behind(m.x, m.y) });
      mouseFrame();
    }
  }
  return { game: g.game, left: g.leaves.length, seconds: g.t };
}

function format(result) {
  return result.game.won ? `${result.seconds.toFixed(0)}s` : `LOST (${result.left} left)`;
}

test('a scripted player clears all 1000 leaves within 5 simulated minutes, at every gust clock', () => {
  const started = Date.now();
  const times = [];
  for (const clock of GUST_CLOCKS) {
    const result = playScript(300, clock);
    times.push(format(result));
    assert(result.game.won, `gust clock ${clock}: not won, ${result.left} leaves left after ${result.seconds.toFixed(0)} s`);
    assert(result.game.cleared === LEAF_COUNT, `gust clock ${clock}: cleared ${result.game.cleared}`);
  }
  console.log(`  scripted player (instant aim), win times: ${times.join(' ')} `
    + `(real time ${((Date.now() - started) / 1000).toFixed(1)} s)`);
});

test('a scripted player using the mouse-aim controls also wins within 5 simulated minutes, at every gust clock', () => {
  const times = [];
  for (const clock of GUST_CLOCKS) {
    const result = playMouseScript(300, clock);
    times.push(format(result));
    assert(result.game.won, `gust clock ${clock}: not won, ${result.left} leaves left after ${result.seconds.toFixed(0)} s`);
  }
  console.log(`  mouse-aim player, win times: ${times.join(' ')}`);
});

test('step 9b: the corner-pile exploit takes at least 45 s at every gust clock, and still wins within 5 minutes', () => {
  const times = [];
  for (const clock of GUST_CLOCKS) {
    const result = playExploit(300, clock);
    times.push(format(result));
    assert(result.game.won, `gust clock ${clock}: not won, ${result.left} leaves left after ${result.seconds.toFixed(0)} s`);
    assert(result.seconds >= 45, `gust clock ${clock}: won in ${result.seconds.toFixed(0)} s, a shortcut`);
  }
  console.log(`  corner-pile exploit, win times: ${times.join(' ')}`);
});

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
