// Step 4 FPS counter tests. Run with:  node tests/fps.test.js
// The counter is fed fake timestamps in milliseconds, so no browser and no waiting are needed.

import { test, assert, assertClose, report } from './harness.js';
import { createFpsCounter } from '../src/fps.js';

// Feed `seconds` of frames at `hz` frames per second, starting at time `start` (ms).
// Each frame reports `workMs` of work. Returns the last stats the counter gave.
function run(counter, hz, seconds, start = 0, workMs = 1) {
  let stats = null;
  const frames = Math.round(hz * seconds);
  for (let i = 0; i <= frames; i++) {
    stats = counter.frame(start + i * (1000 / hz), workMs);
  }
  return stats;
}

test('60 frames per second reports 60 FPS and 16.67 ms per frame', () => {
  const stats = run(createFpsCounter(), 60, 1);
  assertClose(stats.fps, 60, 0.5, 'fps');
  assertClose(stats.frameMs, 1000 / 60, 0.2, 'frameMs');
});

test('30 Hz reports 30 FPS', () => {
  assertClose(run(createFpsCounter(), 30, 1).fps, 30, 0.5, 'fps');
});

test('144 Hz reports 144 FPS', () => {
  assertClose(run(createFpsCounter(), 144, 1).fps, 144, 1, 'fps');
});

test('nothing is reported before the first 0.5 s', () => {
  const counter = createFpsCounter();
  const stats = run(counter, 60, 0.4);
  assert(stats === null, 'reported too early: ' + JSON.stringify(stats));
  assert(counter.latest() === null, 'latest() should be null');
});

test('a new report comes every 0.5 s', () => {
  const counter = createFpsCounter();
  const first = run(counter, 60, 0.5);
  assert(first !== null, 'no report after 0.5 s');
  const same = counter.frame(500 + 1000 / 60, 1);
  assert(same === first, 'the report changed before the next 0.5 s');
  const second = run(counter, 60, 0.5, 500);
  assert(second !== first, 'no new report after 1 s');
});

test('work ms is the average work per frame', () => {
  const counter = createFpsCounter();
  let stats = null;
  for (let i = 0; i <= 30; i++) {
    stats = counter.frame(i * (1000 / 60), i % 2 === 0 ? 1 : 3);   // alternating 1 ms and 3 ms
  }
  assertClose(stats.workMs, 2, 0.1, 'workMs');
});

test('a bad work value (NaN or negative) is left out of the average', () => {
  const counter = createFpsCounter();
  let stats = null;
  for (let i = 0; i <= 30; i++) {
    stats = counter.frame(i * (1000 / 60), i % 3 === 0 ? NaN : (i % 3 === 1 ? -5 : 2));
  }
  assertClose(stats.workMs, 2, 1e-9, 'workMs');
});

test('a gap over 1 s (hidden tab) restarts the count instead of reporting a low FPS', () => {
  const counter = createFpsCounter();
  run(counter, 60, 1);                        // normal second
  counter.frame(1000 + 5000, 1);              // tab hidden for 5 s
  const stats = run(counter, 60, 0.5, 6000);  // half a second of normal frames after it
  assertClose(stats.fps, 60, 0.5, 'fps after the gap');
});

test('NaN and Infinity timestamps are ignored', () => {
  const counter = createFpsCounter();
  let stats = null;
  for (let i = 0; i <= 60; i++) {
    stats = counter.frame(i * (1000 / 60), 1);
    counter.frame(NaN, 1);
    counter.frame(Infinity, 1);
  }
  assertClose(stats.fps, 60, 0.5, 'fps');
});

test('a repeated timestamp is not counted as a frame', () => {
  const counter = createFpsCounter();
  let stats = null;
  for (let i = 0; i <= 60; i++) {
    stats = counter.frame(i * (1000 / 60), 1);
    counter.frame(i * (1000 / 60), 1);   // same time again
  }
  assertClose(stats.fps, 60, 0.5, 'fps');
});

test('a timestamp that goes backwards restarts the count', () => {
  const counter = createFpsCounter();
  run(counter, 60, 0.3, 10000);
  counter.frame(0, 1);   // clock jumped back
  const stats = run(counter, 60, 0.5, 0);
  assertClose(stats.fps, 60, 0.5, 'fps');
});

test('two counters do not share state', () => {
  const a = createFpsCounter();
  const b = createFpsCounter();
  run(a, 60, 1);
  assert(b.latest() === null, 'b changed when a was used');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
