// Game state for the void step: how many leaves are cleared, the timer, and the win.
// Pure data and functions, no WebGL and no page elements, so it is tested in Node.

import { MAX_DT } from './config.js';

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// A new round with `total` leaves.
export function createGame(total) {
  return {
    total: isNumber(total) && total > 0 ? Math.floor(total) : 0,
    cleared: 0,       // leaves taken by the void so far
    time: 0,          // seconds of play, the score
    started: false,   // the timer starts the first time the wind rises above Calm
    won: false,
  };
}

// Call once per frame from the game loop's update (so pausing, which skips update, stops the timer).
//   dt         seconds since the last frame (clamped like the physics)
//   windSpeed  the wind speed setting; the first value above 0 starts the timer
//   removed    leaves the void finished this frame (from removeFinished)
//   remaining  leaves still in the scene, including ones being captured
export function updateGame(game, { dt, windSpeed, removed, remaining } = {}) {
  if (!game.started && isNumber(windSpeed) && windSpeed > 0) {
    game.started = true;
  }
  if (game.started && !game.won && isNumber(dt) && dt > 0) {
    game.time += Math.min(dt, MAX_DT);
  }
  if (isNumber(removed) && removed > 0) {
    game.cleared += Math.floor(removed);
  }
  // Win when there were leaves and none are left. Once won, the timer above stops.
  if (!game.won && game.total > 0 && remaining === 0) {
    game.won = true;
  }
  return game;
}

// "+100 leaves" after a win: a bigger total, the round goes on, and the timer keeps counting from here.
export function addLeavesToGame(game, count) {
  if (isNumber(count) && count > 0) {
    game.total += Math.floor(count);
    game.won = false;
  }
  return game;
}

// Seconds as minutes:seconds.tenths, for example 83.45 -> "1:23.4". A bad value shows 0:00.0.
export function formatTime(seconds) {
  if (!isNumber(seconds) || seconds < 0) {
    seconds = 0;
  }
  // Count whole tenths of a second. The tiny 1e-6 stops 83.4 from becoming 833.999... tenths.
  const tenths = Math.floor(seconds * 10 + 1e-6);
  const minutes = Math.floor(tenths / 600);
  const secs = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  return `${minutes}:${String(secs).padStart(2, '0')}.${tenth}`;
}

// How many leaves "+100 Leaves" may add: up to `want`, but never past `max` (the GPU buffer size).
// Bad numbers give 0, never a negative or NaN count.
export function leavesToAdd(current, max, want = 100) {
  // A leaf count or limit below 0 cannot happen, so it is treated as broken input too.
  if (!isNumber(current) || !isNumber(max) || !isNumber(want) || current < 0 || max < 0) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(want), Math.floor(max - current)));
}
