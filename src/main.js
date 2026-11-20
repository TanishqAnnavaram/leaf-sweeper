import { createRenderer } from './renderer.js';
import {
  stepLeaf, spawnLeaves, createWind, createGusts, advanceGusts,
} from './physics.js';
import { createNoise } from './noise.js';
import { createLoop } from './loop.js';
import { createFpsCounter } from './fps.js';
import { createControls } from './ui.js';
import {
  LEAF_COUNT, LEAF_SEED, FRICTION, WIND_MAX_SPEED, WIND_START,
  GUST_STRENGTH, GUST_SIZE, SPIN_AMOUNT,
} from './config.js';

const canvas = document.querySelector('#game');
const errorBox = document.querySelector('#error');
const pausedLabel = document.querySelector('#paused');
const statsBox = document.querySelector('#stats');

// Show a problem on the page as well as in the console.
function showError(err) {
  errorBox.textContent = err.message;
  errorBox.hidden = false;
  console.error(err);
}

try {
  const renderer = createRenderer(canvas);
  let leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED);   // 1000 still leaves, same layout every load
  const fps = createFpsCounter();
  let shownStats = null;   // the report currently on screen
  let updateMs = 0;        // time the last update took

  // Wind settings. The control panel's sliders change these values; update() reads them each frame.
  const settings = {
    bearing: WIND_START.bearing,   // degrees the wind blows toward (0 = up, 90 = right)
    speed: WIND_START.speed,       // world units per second, 0 = Calm
    friction: FRICTION,
    topSpeed: WIND_MAX_SPEED,
    gustStrength: GUST_STRENGTH,   // 0 = even wind (step 5), 1 = strongest gusts
    gustSize: GUST_SIZE,           // world units across one gust patch
    spinAmount: SPIN_AMOUNT,       // how much moving leaves tumble
  };
  createControls(settings);

  // Gust state: our own Perlin noise (seeded, so gusts are the same on every load), the simulation
  // time, and the drift of the gust pattern. It only moves forward in update(), so pausing freezes it.
  const gusts = createGusts(createNoise(LEAF_SEED));

  // Write the counter text. Called only when a new report arrives (every 0.5 s), not every frame,
  // because changing page text is slow compared with our drawing.
  function showStats(stats) {
    const lines = stats
      ? [
          `FPS    ${stats.fps.toFixed(1)}`,
          `frame  ${stats.frameMs.toFixed(2)} ms`,
          `work   ${stats.workMs.toFixed(2)} ms`,
        ]
      : ['FPS    --', 'frame  -- ms', 'work   -- ms'];
    lines.push(`leaves ${leaves.length}`);
    statsBox.textContent = lines.join('\n');
  }
  showStats(null);

  // Every frame: move the leaves (unless paused), then draw them.
  // "Work" is the time our own code takes: update + packing + upload + draw call.
  // It does not include the GPU's drawing time, which runs in parallel after the call returns.
  const loop = createLoop({
    update(dt) {
      const t0 = performance.now();
      const wind = createWind(settings, gusts);   // once per frame, shared by every leaf
      for (const leaf of leaves) {
        stepLeaf(leaf, dt, wind);   // each leaf reads its own gust from the noise inside stepLeaf
      }
      advanceGusts(gusts, wind, dt);   // then time moves on and the gust pattern drifts downwind
      updateMs = performance.now() - t0;
    },
    render() {
      const t0 = performance.now();
      renderer.setLeaves(leaves);
      renderer.render();
      const t1 = performance.now();
      const stats = fps.frame(t1, updateMs + (t1 - t0));
      updateMs = 0;   // when paused, update does not run, so it adds no time
      if (stats !== shownStats) {
        shownStats = stats;
        showStats(stats);
      }
    },
    onError: showError,
  });

  // P pauses and unpauses, F hides and shows the counter.
  // e.repeat is true while a key is held down, so holding a key toggles only once.
  window.addEventListener('keydown', (e) => {
    // Ignore held keys, and keys typed into a text box (Tweakpane has number boxes).
    if (e.repeat || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) {
      return;
    }
    if (e.code === 'KeyP') {
      pausedLabel.hidden = !loop.togglePaused();
    } else if (e.code === 'KeyF') {
      statsBox.hidden = !statsBox.hidden;
    }
  });

  loop.start();

  // Debug handle for the browser console. For example:
  //   leafDebug.spawn(5000)        replace the leaves with 5000 new ones (stress test)
  //   leafDebug.spawn(5000, 7)     the same, with another random layout
  //   leafDebug.reset()            back to the normal 1000 leaves
  //   leafDebug.count()            how many leaves there are
  //   leafDebug.getLeaf(0)         a copy of one leaf's values
  //   leafDebug.wind               the live wind settings (change them here or in the panel)
  //   leafDebug.gusts              the gust state: simulation time and drift
  window.leafDebug = {
    spawn(count, seed = LEAF_SEED) {
      leaves = spawnLeaves(count, seed);
      showStats(shownStats);   // update the leaf count right away
      return leaves.length;
    },
    reset() {
      return window.leafDebug.spawn(LEAF_COUNT, LEAF_SEED);
    },
    count() {
      return leaves.length;
    },
    getLeaf(i) {
      return leaves[i] ? { ...leaves[i] } : null;   // a copy, so the console cannot change it by accident
    },
    wind: settings,
    gusts,
  };
} catch (err) {
  showError(err);
}
