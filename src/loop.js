// The game loop: once per screen refresh, update the simulation by the time that passed, then draw.
// No WebGL here. The browser's frame timer can be swapped for a fake one, so this file is tested in Node.

import { MAX_DT } from './config.js';

// Seconds between two frame timestamps given in milliseconds.
//   dt = (now - last) / 1000, then clamped to the range 0 to MAX_DT.
// No last time (the first frame), a zero or negative gap, or a non-finite value all give 0.
export function frameDt(now, last) {
  if (typeof last !== 'number') {
    return 0;
  }
  const dt = (now - last) / 1000;
  if (!Number.isFinite(dt) || dt <= 0) {
    return 0;
  }
  return Math.min(dt, MAX_DT);
}

// Make a loop.
//   update(dt)    move the simulation forward by dt seconds (skipped while paused)
//   render()      draw the current state (runs every frame, even while paused)
//   onError(err)  optional: called once if update or render throws; the loop then stops
//   requestFrame, cancelFrame   optional: replace the browser's requestAnimationFrame (for tests)
export function createLoop({ update, render, onError, requestFrame, cancelFrame } = {}) {
  if (typeof update !== 'function' || typeof render !== 'function') {
    throw new Error('createLoop needs an update function and a render function.');
  }
  const request = requestFrame || ((cb) => requestAnimationFrame(cb));
  const cancel = cancelFrame || ((handle) => cancelAnimationFrame(handle));

  let last = null;       // timestamp of the previous frame, in ms (null before the first frame)
  let paused = false;
  let running = false;
  let handle = null;     // id of the frame we asked the browser for

  // One frame. Exposed so tests can drive the loop with chosen timestamps.
  function tick(now) {
    const dt = frameDt(now, last);
    if (Number.isFinite(now)) {
      last = now;   // updated even while paused, so unpausing does not see the paused time
    }
    try {
      if (!paused) {
        update(dt);
      }
      render();
    } catch (err) {
      // Stop instead of repeating the same error 60 times a second.
      stop();
      if (onError) {
        onError(err);
      } else {
        throw err;
      }
    }
  }

  // The browser calls this once per screen refresh with a timestamp in ms.
  function frame(now) {
    handle = null;
    tick(now);
    if (running) {
      handle = request(frame);   // ask for the next frame
    }
  }

  function start() {
    if (running) {
      return;   // already going: never run two loops at once
    }
    running = true;
    last = null;   // a restart begins fresh, so the time spent stopped is not counted
    handle = request(frame);
  }

  function stop() {
    running = false;
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
  }

  function setPaused(value) {
    paused = Boolean(value);
    return paused;
  }

  return {
    start,
    stop,
    tick,
    setPaused,
    togglePaused: () => setPaused(!paused),
    isPaused: () => paused,
    isRunning: () => running,
  };
}
