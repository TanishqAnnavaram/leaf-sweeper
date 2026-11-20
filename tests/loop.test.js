// Step 3 game loop tests. Run with:  node tests/loop.test.js
// The loop is fed fake timestamps, so no browser and no real waiting are needed.

import { test, assert, assertClose, report } from './harness.js';
import { frameDt, createLoop } from '../src/loop.js';
import { createLeaf, stepLeaf } from '../src/physics.js';
import { MAX_DT } from '../src/config.js';

const TOL = 1e-9;
const FRAME_60 = 1000 / 60;   // one 60 Hz frame in milliseconds

// A fake requestAnimationFrame: it stores the callback so a test can fire it by hand.
function fakeFrames() {
  const fake = {
    pending: null,     // the callback waiting for the next frame
    requested: 0,      // how many times a frame was asked for
    cancelled: 0,
    request(cb) {
      fake.requested++;
      fake.pending = cb;
      return fake.requested;   // a handle, like the real one
    },
    cancel() {
      fake.cancelled++;
      fake.pending = null;
    },
    fire(now) {        // run the waiting frame, as the browser would
      const cb = fake.pending;
      fake.pending = null;
      if (cb) cb(now);
    },
  };
  return fake;
}

// A loop that records every dt it was given and counts renders.
function recordingLoop(extra = {}) {
  const log = { dts: [], renders: 0, order: [] };
  const loop = createLoop({
    update(dt) { log.dts.push(dt); log.order.push('update'); },
    render() { log.renders++; log.order.push('render'); },
    ...extra,
  });
  return { loop, log };
}

// ---------- frameDt ----------

test('frameDt: a 16.67 ms frame gives 1/60 s', () => {
  assertClose(frameDt(1000 + FRAME_60, 1000), 1 / 60, TOL, 'dt');
});

test('frameDt: a 1000 ms gap is clamped to 1/30 s', () => {
  assertClose(frameDt(2000, 1000), MAX_DT, TOL, 'dt');
});

test('frameDt: first frame (no last time) gives 0', () => {
  assert(frameDt(1000, null) === 0, 'null');
  assert(frameDt(1000, undefined) === 0, 'undefined');
});

test('frameDt: zero and negative gaps give 0', () => {
  assert(frameDt(1000, 1000) === 0, 'zero');
  assert(frameDt(900, 1000) === 0, 'negative');
});

test('frameDt: NaN and Infinity give 0', () => {
  assert(frameDt(NaN, 1000) === 0, 'NaN now');
  assert(frameDt(1000, NaN) === 0, 'NaN last');
  assert(frameDt(Infinity, 1000) === 0, 'Infinity now');
  assert(frameDt(1000, -Infinity) === 0, '-Infinity last');
});

// ---------- tick ----------

test('tick: first frame updates with dt 0, later frames with the real gap', () => {
  const { loop, log } = recordingLoop();
  loop.tick(1000);
  loop.tick(1000 + FRAME_60);
  assert(log.dts[0] === 0, `first dt ${log.dts[0]}`);
  assertClose(log.dts[1], 1 / 60, TOL, 'second dt');
});

test('tick: update runs before render every frame', () => {
  const { loop, log } = recordingLoop();
  loop.tick(0);
  loop.tick(FRAME_60);
  assert(log.order.join(',') === 'update,render,update,render', log.order.join(','));
});

test('tick: a long gap (hidden tab) gives at most 1/30 s', () => {
  const { loop, log } = recordingLoop();
  loop.tick(1000);
  loop.tick(61000);   // one minute later
  assertClose(log.dts[1], MAX_DT, TOL, 'dt');
});

test('tick: a NaN timestamp gives dt 0 and does not spoil the next frame', () => {
  const { loop, log } = recordingLoop();
  loop.tick(1000);
  loop.tick(NaN);
  loop.tick(1000 + FRAME_60);
  assert(log.dts[1] === 0, `NaN frame dt ${log.dts[1]}`);
  assertClose(log.dts[2], 1 / 60, TOL, 'next dt');
});

// ---------- Pause ----------

test('pause: update stops, render keeps going', () => {
  const { loop, log } = recordingLoop();
  loop.tick(0);
  loop.setPaused(true);
  loop.tick(FRAME_60);
  loop.tick(2 * FRAME_60);
  assert(log.dts.length === 1, `update ran ${log.dts.length} times`);
  assert(log.renders === 3, `render ran ${log.renders} times`);
});

test('pause: the leaf does not move while paused', () => {
  const leaf = createLeaf();
  const loop = createLoop({ update: (dt) => stepLeaf(leaf, dt), render() {} });
  loop.tick(0);
  loop.tick(FRAME_60);
  loop.setPaused(true);
  const x = leaf.x;
  const y = leaf.y;
  for (let i = 2; i < 100; i++) loop.tick(i * FRAME_60);
  assert(leaf.x === x && leaf.y === y, 'leaf moved while paused');
});

test('unpause: no jump, the next dt is one frame', () => {
  const { loop, log } = recordingLoop();
  loop.tick(0);
  loop.setPaused(true);
  for (let i = 1; i <= 120; i++) loop.tick(i * FRAME_60);   // 2 seconds paused
  loop.setPaused(false);
  loop.tick(121 * FRAME_60);
  assertClose(log.dts[log.dts.length - 1], 1 / 60, 1e-9, 'dt after unpause');
});

test('togglePaused and isPaused', () => {
  const { loop } = recordingLoop();
  assert(loop.isPaused() === false, 'starts unpaused');
  assert(loop.togglePaused() === true && loop.isPaused() === true, 'first toggle');
  assert(loop.togglePaused() === false && loop.isPaused() === false, 'second toggle');
});

test('setPaused only accepts true or false', () => {
  const { loop } = recordingLoop();
  loop.setPaused('yes');
  assert(loop.isPaused() === true, 'a truthy value pauses');
  loop.setPaused(0);
  assert(loop.isPaused() === false, 'a falsy value unpauses');
});

// ---------- Frame-rate independence through the loop ----------

test('one second at 30, 60, and 144 Hz moves the leaf the same distance', () => {
  for (const hz of [30, 60, 144]) {
    const leaf = createLeaf();
    const loop = createLoop({ update: (dt) => stepLeaf(leaf, dt), render() {} });
    for (let i = 0; i <= hz; i++) loop.tick(5000 + i * (1000 / hz));   // first frame has dt 0
    assertClose(leaf.x, -600 + 200, 1e-6, `${hz} Hz x`);
    assertClose(leaf.y, -300 + 120, 1e-6, `${hz} Hz y`);
  }
});

// ---------- start and stop ----------

test('start asks for exactly one frame, and each frame asks for the next', () => {
  const fake = fakeFrames();
  const { loop, log } = recordingLoop({ requestFrame: fake.request, cancelFrame: fake.cancel });
  loop.start();
  assert(fake.requested === 1, `requested ${fake.requested}`);
  fake.fire(0);
  fake.fire(FRAME_60);
  assert(fake.requested === 3, `requested ${fake.requested}`);
  assert(log.renders === 2, `rendered ${log.renders}`);
  assert(loop.isRunning() === true, 'not running');
});

test('calling start twice does not run two loops', () => {
  const fake = fakeFrames();
  const { loop } = recordingLoop({ requestFrame: fake.request, cancelFrame: fake.cancel });
  loop.start();
  loop.start();
  assert(fake.requested === 1, `requested ${fake.requested}`);
});

test('stop cancels the waiting frame', () => {
  const fake = fakeFrames();
  const { loop, log } = recordingLoop({ requestFrame: fake.request, cancelFrame: fake.cancel });
  loop.start();
  fake.fire(0);
  loop.stop();
  assert(fake.cancelled === 1, `cancelled ${fake.cancelled}`);
  fake.fire(FRAME_60);   // nothing should be waiting
  assert(log.renders === 1, `rendered ${log.renders}`);
  assert(loop.isRunning() === false, 'still running');
});

test('a restart does not see the time spent stopped', () => {
  const fake = fakeFrames();
  const { loop, log } = recordingLoop({ requestFrame: fake.request, cancelFrame: fake.cancel });
  loop.start();
  fake.fire(0);
  loop.stop();
  loop.start();
  fake.fire(10000);
  assert(log.dts[1] === 0, `dt after restart ${log.dts[1]}`);
});

// ---------- Errors ----------

test('an error in update stops the loop and is reported once', () => {
  const fake = fakeFrames();
  const errors = [];
  const loop = createLoop({
    update() { throw new Error('boom'); },
    render() {},
    onError: (err) => errors.push(err.message),
    requestFrame: fake.request,
    cancelFrame: fake.cancel,
  });
  loop.start();
  fake.fire(0);
  fake.fire(FRAME_60);   // must do nothing: the loop has stopped
  assert(errors.length === 1 && errors[0] === 'boom', `errors: ${errors}`);
  assert(loop.isRunning() === false, 'still running');
  assert(fake.pending === null, 'a next frame was requested after the error');
});

test('an error in render also stops the loop', () => {
  const fake = fakeFrames();
  const errors = [];
  const loop = createLoop({
    update() {},
    render() { throw new Error('draw failed'); },
    onError: (err) => errors.push(err.message),
    requestFrame: fake.request,
    cancelFrame: fake.cancel,
  });
  loop.start();
  fake.fire(0);
  assert(errors.length === 1 && loop.isRunning() === false, `errors: ${errors}`);
});

test('without onError, an error is thrown so it still shows in the console', () => {
  const loop = createLoop({ update() { throw new Error('loud'); }, render() {} });
  let caught = null;
  try {
    loop.tick(0);
  } catch (err) {
    caught = err;
  }
  assert(caught && caught.message === 'loud', 'the error was swallowed');
});

test('createLoop needs update and render functions', () => {
  let threw = false;
  try {
    createLoop({ update: 5 });
  } catch (err) {
    threw = true;
  }
  assert(threw, 'no error for a missing render function');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
