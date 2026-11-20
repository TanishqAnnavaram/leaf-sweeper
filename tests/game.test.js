// Step 7 game state tests: counter, timer, win. Run with:  node tests/game.test.js

import { test, assert, assertClose, report } from './harness.js';
import { createGame, updateGame, addLeavesToGame, formatTime } from '../src/game.js';

// One frame of the game: dt seconds, the wind speed, leaves removed this frame, leaves left.
function frame(game, { dt = 1 / 60, windSpeed = 0, removed = 0, remaining }) {
  return updateGame(game, { dt, windSpeed, removed, remaining });
}

test('a new game: 0 cleared, the total, time 0, not started, not won', () => {
  const g = createGame(1000);
  assert(g.cleared === 0 && g.total === 1000 && g.time === 0 && !g.started && !g.won, JSON.stringify(g));
});

test('a bad total becomes 0', () => {
  for (const total of [NaN, -5, undefined, 'x']) {
    assert(createGame(total).total === 0, `total ${total}`);
  }
});

test('the timer waits for the first wind', () => {
  const g = createGame(10);
  for (let i = 0; i < 60; i++) frame(g, { remaining: 10 });
  assert(g.time === 0 && !g.started, `time ${g.time}`);
  frame(g, { windSpeed: 50, remaining: 10 });
  assert(g.started, 'not started by wind');
});

test('once started, the timer keeps running at Calm', () => {
  const g = createGame(10);
  frame(g, { windSpeed: 50, remaining: 10 });
  for (let i = 0; i < 60; i++) frame(g, { windSpeed: 0, remaining: 10 });
  assertClose(g.time, 61 / 60, 1e-9, 'time');
});

test('the counter adds up the removed leaves', () => {
  const g = createGame(10);
  frame(g, { windSpeed: 50, removed: 3, remaining: 7 });
  frame(g, { windSpeed: 50, removed: 2, remaining: 5 });
  assert(g.cleared === 5, `cleared ${g.cleared}`);
});

test('a bad removed count is ignored', () => {
  const g = createGame(10);
  for (const removed of [NaN, -3, 'x', undefined]) frame(g, { windSpeed: 1, removed, remaining: 10 });
  assert(g.cleared === 0, `cleared ${g.cleared}`);
});

test('win when nothing is left, and the timer stops', () => {
  const g = createGame(3);
  frame(g, { windSpeed: 100, removed: 3, remaining: 0 });
  assert(g.won, 'not won');
  const t = g.time;
  for (let i = 0; i < 60; i++) frame(g, { windSpeed: 100, remaining: 0 });
  assert(g.time === t, `time kept running after the win: ${t} to ${g.time}`);
});

test('no win with leaves still left (including ones being captured)', () => {
  const g = createGame(3);
  frame(g, { windSpeed: 100, removed: 2, remaining: 1 });
  assert(!g.won, 'won with a leaf left');
});

test('a game with total 0 is never won', () => {
  const g = createGame(0);
  frame(g, { windSpeed: 100, remaining: 0 });
  assert(!g.won, 'won an empty game');
});

test('the timer only moves when updateGame is called (pausing skips it)', () => {
  const g = createGame(10);
  frame(g, { windSpeed: 100, dt: 0.5, remaining: 10 });
  const t = g.time;
  // While paused, the loop calls no update, so nothing here. Then one more frame:
  frame(g, { windSpeed: 100, dt: 1 / 60, remaining: 10 });
  assertClose(g.time, t + 1 / 60, 1e-12, 'time');
});

test('a bad or huge dt is ignored or clamped like the physics', () => {
  const g = createGame(10);
  frame(g, { windSpeed: 100, dt: NaN, remaining: 10 });
  frame(g, { windSpeed: 100, dt: -1, remaining: 10 });
  assert(g.time === 0, `time ${g.time}`);
  frame(g, { windSpeed: 100, dt: 5, remaining: 10 });
  assertClose(g.time, 1 / 30, 1e-12, 'time after a 5 s dt');
});

test('+100 raises the total, clears the win, and keeps the time', () => {
  const g = createGame(3);
  frame(g, { windSpeed: 100, dt: 1 / 30, removed: 3, remaining: 0 });
  const t = g.time;
  addLeavesToGame(g, 100);
  assert(g.total === 103 && g.cleared === 3 && !g.won && g.time === t, JSON.stringify(g));
  frame(g, { windSpeed: 100, dt: 1 / 30, remaining: 100 });
  assert(g.time > t, 'timer did not continue');
});

test('addLeavesToGame ignores bad counts', () => {
  const g = createGame(10);
  for (const n of [NaN, -5, 'x']) addLeavesToGame(g, n);
  assert(g.total === 10, `total ${g.total}`);
});

test('formatTime: 0:00.0, 1:23.4, 61:05.0, 0:59.9, and NaN or negative gives 0:00.0', () => {
  const cases = [[0, '0:00.0'], [83.45, '1:23.4'], [3665, '61:05.0'], [59.99, '0:59.9'], [83.4, '1:23.4'],
    [NaN, '0:00.0'], [-3, '0:00.0'], [Infinity, '0:00.0']];
  for (const [seconds, text] of cases) {
    assert(formatTime(seconds) === text, `${seconds}: expected ${text}, got ${formatTime(seconds)}`);
  }
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
