// FPS counter. No WebGL and no page elements here, so it can be tested in Node with fake timestamps.
//
// Why average over a window instead of using 1 / dt each frame: single frames vary a lot,
// so a per-frame number would flicker too fast to read. Counting the frames in 0.5 s is steady.

// windowMs     how often a new report is made (and how long each average covers)
// resetGapMs   a gap longer than this (for example a hidden tab) starts the count again,
//              so the paused time does not show up as one very slow frame
export function createFpsCounter({ windowMs = 500, resetGapMs = 1000 } = {}) {
  let windowStart = null;   // time the current window began, in ms
  let last = null;          // time of the previous frame, in ms
  let frames = 0;           // frames finished in the current window
  let workSum = 0;          // total work ms in the current window
  let workCount = 0;        // frames with a valid work value
  let latest = null;        // the last report: { fps, frameMs, workMs }, or null before the first

  function restart(now) {
    windowStart = now;
    frames = 0;
    workSum = 0;
    workCount = 0;
  }

  // Call once per frame with the frame's time (ms) and the work done in it (ms).
  // Returns the latest report, which changes once per window.
  function frame(now, workMs) {
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      return latest;   // ignore a bad timestamp
    }
    if (last !== null && now === last) {
      return latest;   // same time again: not a new frame
    }
    const gapTooLong = last !== null && (now < last || now - last > resetGapMs);
    last = now;
    if (windowStart === null || gapTooLong) {
      restart(now);    // first frame, a clock that went backwards, or a long gap
      return latest;
    }

    frames++;
    if (typeof workMs === 'number' && Number.isFinite(workMs) && workMs >= 0) {
      workSum += workMs;
      workCount++;
    }

    const elapsed = now - windowStart;
    if (elapsed >= windowMs) {
      latest = {
        fps: (frames * 1000) / elapsed,              // frames per second = frames / seconds
        frameMs: elapsed / frames,                   // average time between frames
        workMs: workCount > 0 ? workSum / workCount : 0,
      };
      restart(now);
    }
    return latest;
  }

  return { frame, latest: () => latest };
}
