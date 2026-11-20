import { createRenderer } from './renderer.js';
import {
  stepLeaf, spawnLeaves, createWind, createGusts, advanceGusts, removeFinished, windName,
} from './physics.js';
import { createGame, updateGame, addLeavesToGame, formatTime } from './game.js';
import { createNoise } from './noise.js';
import { createLoop } from './loop.js';
import { createFpsCounter } from './fps.js';
import { createControls } from './ui.js';
import {
  LEAF_COUNT, LEAF_SEED, FRICTION, WIND_MAX_SPEED, WIND_START,
  GUST_STRENGTH, GUST_SIZE, SPIN_AMOUNT, MAX_LEAVES,
  VOID_X, VOID_Y, VOID_RADIUS, CAPTURE_RADIUS, SUCTION_MAX, VOID_DISC_RADIUS,
} from './config.js';

const canvas = document.querySelector('#game');
const errorBox = document.querySelector('#error');
const pausedLabel = document.querySelector('#paused');
const statsBox = document.querySelector('#stats');
const hudCount = document.querySelector('#hud-count');
const hudFill = document.querySelector('#hud-fill');
const hudTime = document.querySelector('#hud-time');
const winCard = document.querySelector('#win');
const winTime = document.querySelector('#win-time');
const againButton = document.querySelector('#again');
const moreButton = document.querySelector('#more');

// Show a problem on the page as well as in the console.
function showError(err) {
  errorBox.textContent = err.message;
  errorBox.hidden = false;
  console.error(err);
}

try {
  const renderer = createRenderer(canvas);
  let leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED);   // 1000 still leaves, same layout every load
  let game = createGame(leaves.length);              // counter, timer, win
  let round = 0;          // each Play again uses a new seed, so each round has a new layout
  let extraBatches = 0;   // and so does each +100
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
    suction: SUCTION_MAX,          // the void's pull at its center, units per second
    voidRadius: VOID_RADIUS,       // where the pull starts
    captureRadius: CAPTURE_RADIUS, // where leaves are caught
  };
  const pane = createControls(settings);

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

  // The counter, progress bar and timer at the bottom, and the win card. Page text is only
  // rewritten when it changes (the timer about 10 times a second), not on every frame.
  const shown = { count: '', time: '', fill: '' };
  function showHud() {
    const count = `Cleared ${game.cleared} / ${game.total}`;
    if (count !== shown.count) {
      shown.count = count;
      hudCount.textContent = count;
    }
    const time = formatTime(game.time);
    if (time !== shown.time) {
      shown.time = time;
      hudTime.textContent = time;
    }
    const fill = `${game.total > 0 ? (100 * game.cleared) / game.total : 0}%`;   // no divide by zero
    if (fill !== shown.fill) {
      shown.fill = fill;
      hudFill.style.width = fill;
    }
    if (game.won && winCard.hidden) {
      winTime.textContent = `Your time: ${time}`;
      winCard.hidden = false;
    } else if (!game.won && !winCard.hidden) {
      winCard.hidden = true;
    }
  }

  // Set the wind back to Calm and make the panel show it (code changes do not refresh it by themselves).
  function calmWind() {
    settings.speed = 0;
    settings.strength = windName(0, settings.topSpeed);
    pane.refresh();
  }

  // Win card buttons.
  againButton.addEventListener('click', () => {
    round++;
    leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED + round);
    game = createGame(leaves.length);   // cleared 0, timer 0, waits for the first wind again
    calmWind();
    showStats(shownStats);
    againButton.blur();
  });
  moreButton.addEventListener('click', () => {
    const count = Math.min(100, MAX_LEAVES - leaves.length);   // never more than the GPU buffer holds
    extraBatches++;
    const extra = spawnLeaves(count, LEAF_SEED + 1000 + extraBatches);
    leaves.push(...extra);
    addLeavesToGame(game, extra.length);   // bigger total, the round goes on, the timer continues
    showStats(shownStats);
    moreButton.blur();
  });

  // Every frame: move the leaves (unless paused), then draw them.
  // "Work" is the time our own code takes: update + packing + upload + draw call.
  // It does not include the GPU's drawing time, which runs in parallel after the call returns.
  const callbacks = {
    update(dt) {
      const t0 = performance.now();
      const wind = createWind(settings, gusts);   // once per frame, shared by every leaf
      for (const leaf of leaves) {
        stepLeaf(leaf, dt, wind);   // each leaf reads its own gust from the noise inside stepLeaf
      }
      advanceGusts(gusts, wind, dt);   // then time moves on and the gust pattern drifts downwind
      const removed = removeFinished(leaves);   // leaves the void has finished with (swap-and-pop)
      updateGame(game, { dt, windSpeed: settings.speed, removed, remaining: leaves.length });
      updateMs = performance.now() - t0;
    },
    render() {
      const t0 = performance.now();
      renderer.setVoid({ x: VOID_X, y: VOID_Y, discRadius: VOID_DISC_RADIUS, ringRadius: settings.voidRadius });
      renderer.setLeaves(leaves);
      renderer.render();
      const t1 = performance.now();
      const stats = fps.frame(t1, updateMs + (t1 - t0));
      updateMs = 0;   // when paused, update does not run, so it adds no time
      if (stats !== shownStats) {
        shownStats = stats;
        showStats(stats);
      }
      showHud();
    },
    onError: showError,
  };
  const loop = createLoop(callbacks);

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
  //   leafDebug.game               the game state: cleared, total, time, won
  //   leafDebug.leaveOnly(5)       keep 5 leaves, placed near the void (to test the win quickly)
  //   leafDebug.advance(4)         run 4 s of the game right now in 1/60 s steps, without waiting for
  //                                screen frames (for testing when the browser is throttled)
  window.leafDebug = {
    spawn(count, seed = LEAF_SEED) {
      leaves = spawnLeaves(count, seed);
      game = createGame(leaves.length);
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
    get game() {
      return game;
    },
    leaveOnly(n = 5) {
      const keep = Math.max(0, Math.min(Math.floor(n) || 0, leaves.length));
      leaves.length = keep;   // drop the rest
      leaves.forEach((leaf, i) => {   // place them on a circle 120 units from the void, at rest
        const a = (i / Math.max(keep, 1)) * 2 * Math.PI;
        Object.assign(leaf, { x: VOID_X + 120 * Math.cos(a), y: VOID_Y + 120 * Math.sin(a), vx: 0, vy: 0 });
      });
      game.cleared = game.total - keep;   // count the dropped leaves as cleared
      return keep;
    },
    advance(seconds) {
      const steps = Math.max(0, Math.min(Math.round((Number(seconds) || 0) * 60), 60 * 600));   // at most 10 min
      for (let i = 0; i < steps; i++) {
        if (!loop.isPaused()) {
          callbacks.update(1 / 60);
        }
      }
      callbacks.render();   // draw the result once
      return { cleared: game.cleared, total: game.total, time: formatTime(game.time), won: game.won };
    },
  };
} catch (err) {
  showError(err);
}
