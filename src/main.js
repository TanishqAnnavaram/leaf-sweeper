import { createRenderer } from './renderer.js';
import {
  stepLeaf, spawnLeaves, createWind, createGusts, advanceGusts, removeFinished, windName,
} from './physics.js';
import { createGame, updateGame, addLeavesToGame, formatTime, leavesToAdd } from './game.js';
import { createWindControl, setPointer, stepWindControl, pointerToWorld } from './control.js';
import { createNoise } from './noise.js';
import { createCrowd, countCells, shelterLeaves, spreadLeaves } from './crowd.js';
import { createLoop } from './loop.js';
import { createFpsCounter } from './fps.js';
import { createControls } from './ui.js';
import {
  LEAF_COUNT, LEAF_SEED, FRICTION, WIND_MAX_SPEED,
  GUST_STRENGTH, GUST_SIZE, SPIN_AMOUNT, MAX_LEAVES,
  VOID_X, VOID_Y, VOID_RADIUS, CAPTURE_RADIUS, SUCTION_MAX, VOID_DISC_RADIUS,
  AIM_GALE_DISTANCE, WIND_TURN_RATE, WIND_BUILD_TIME, OBSTACLES, PILE_CAP, SPREAD_SPEED, SHELTER,
} from './config.js';

const canvas = document.querySelector('#game');
const errorBox = document.querySelector('#error');
const pausedLabel = document.querySelector('#paused');
const statsBox = document.querySelector('#stats');
const hudCount = document.querySelector('#hud-count');
const hudFill = document.querySelector('#hud-fill');
const hudTime = document.querySelector('#hud-time');
const resetButton = document.querySelector('#reset');
const addButton = document.querySelector('#add');
const winCard = document.querySelector('#win');
const winTime = document.querySelector('#win-time');
const againButton = document.querySelector('#again');
const moreButton = document.querySelector('#more');
const compassArrow = document.querySelector('#compass-arrow');
const compassLabel = document.querySelector('#compass-label');

// Show a problem on the page as well as in the console.
function showError(err) {
  errorBox.textContent = err.message;
  errorBox.hidden = false;
  console.error(err);
}

try {
  const renderer = createRenderer(canvas);
  renderer.setObstacles(OBSTACLES);   // they never move, so they are sent to the GPU once
  let debugView = false;              // D: collision circles of obstacles and leaves
  let grayBoxView = false;            // G: the gray-box look (orange rectangles), for comparison
  let leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED);   // 1000 still leaves, same layout every load
  let game = createGame(leaves.length);              // counter, timer, win
  let round = 0;          // each reset uses a new seed, so each round has a new layout
  let extraBatches = 0;   // and so does each +100
  const fps = createFpsCounter();
  let shownStats = null;   // the report currently on screen
  let updateMs = 0;        // time the last update took

  // The player's wind control (step 8): hold on the field and the wind blows from the cursor to the void.
  const control = createWindControl();

  // Wind and tuning settings. The control writes bearing and speed every frame; the developer
  // panel (press T) shows them and lets you change the tuning values.
  const settings = {
    bearing: control.bearing,      // degrees the wind blows toward (0 = up, 90 = right)
    speed: control.speed,          // world units per second, 0 = Calm
    friction: FRICTION,
    topSpeed: WIND_MAX_SPEED,
    gustStrength: GUST_STRENGTH,   // 0 = even wind (step 5), 1 = strongest gusts
    gustSize: GUST_SIZE,           // world units across one gust patch
    spinAmount: SPIN_AMOUNT,       // how much moving leaves tumble
    suction: SUCTION_MAX,          // the void's pull at its center, units per second
    voidRadius: VOID_RADIUS,       // where the pull starts
    captureRadius: CAPTURE_RADIUS, // where leaves are caught
    galeDistance: AIM_GALE_DISTANCE, // cursor distance from the void that gives a Gale
    turnRate: WIND_TURN_RATE,      // how fast the wind can turn, degrees per second
    buildTime: WIND_BUILD_TIME,    // how fast the wind builds up and dies down, seconds
    obstacles: OBSTACLES,          // rocks and trunks the leaves bounce off (step 9)
    pileCap: PILE_CAP,             // step 9b: leaves allowed in one 16-unit square before they spread
    spreadSpeed: SPREAD_SPEED,     // how fast an overfull square pushes its leaves apart, units per second
    shelter: SHELTER,              // wind fraction for leaves under the top ones in a pile
  };
  const crowd = createCrowd();     // step 9b: the grid the pile rules count leaves in (reused every frame)
  const pane = createControls(settings);
  pane.hidden = true;   // a developer panel: hidden until T is pressed

  // Gust state: our own Perlin noise (seeded, so gusts are the same on every load), the simulation
  // time, and the drift of the gust pattern. It only moves forward in update(), so pausing freezes it.
  const gusts = createGusts(createNoise(LEAF_SEED));

  // ---------- On-screen text ----------

  // Write the FPS counter text. Called only when a new report arrives (every 0.5 s), not every frame,
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

  // The counter, progress bar, timer, buttons, compass, and win card. Page elements are only
  // changed when what they show changes, not on every frame.
  const shown = { count: '', time: '', fill: '', canAdd: null, compass: '', name: '' };
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
    // +100 is greyed out once the GPU buffer is full.
    const canAdd = leavesToAdd(leaves.length, MAX_LEAVES) > 0;
    if (canAdd !== shown.canAdd) {
      shown.canAdd = canAdd;
      addButton.disabled = !canAdd;
      moreButton.disabled = !canAdd;
    }
    // Compass: the arrow points where the wind blows (SVG rotate is clockwise, like a compass bearing)
    // and grows with the wind's strength. Calm shows a short, dim arrow.
    const fraction = settings.topSpeed > 0 ? Math.min(1, settings.speed / settings.topSpeed) : 0;
    const compass = `rotate(${Math.round(settings.bearing)}) scale(${(0.45 + 0.55 * fraction).toFixed(2)})`;
    if (compass !== shown.compass) {
      shown.compass = compass;
      compassArrow.setAttribute('transform', compass);
      compassArrow.style.opacity = settings.speed > 0 ? '1' : '0.35';
    }
    const name = windName(settings.speed, settings.topSpeed);
    if (name !== shown.name) {
      shown.name = name;
      compassLabel.textContent = name;
      settings.strength = name;   // the developer panel shows it too
    }
    if (game.won && winCard.hidden) {
      winTime.textContent = `Your time: ${time}`;
      winCard.hidden = false;
    } else if (!game.won && !winCard.hidden) {
      winCard.hidden = true;
    }
  }

  // ---------- Reset Scene and +100 Leaves ----------

  // New round: a new layout, counter and timer back to 0, wind Calm and not held.
  function resetScene() {
    round++;
    leaves = spawnLeaves(LEAF_COUNT, LEAF_SEED + round);
    game = createGame(leaves.length);   // cleared 0, timer 0, waits for the first wind again
    setPointer(control, { holding: false });
    control.speed = 0;
    settings.speed = 0;
    showStats(shownStats);
  }

  // 100 more leaves (outside the void), at any time. The total grows and the timer keeps going.
  function addLeaves() {
    const count = leavesToAdd(leaves.length, MAX_LEAVES);   // never more than the GPU buffer holds
    if (count === 0) {
      return;
    }
    extraBatches++;
    const extra = spawnLeaves(count, LEAF_SEED + 1000 + extraBatches);
    leaves.push(...extra);
    addLeavesToGame(game, extra.length);
    showStats(shownStats);
  }

  // Buttons lose focus after a click, so a later Space or Enter does not press them again.
  for (const [button, action] of [[resetButton, resetScene], [againButton, resetScene],
    [addButton, addLeaves], [moreButton, addLeaves]]) {
    button.addEventListener('click', () => {
      action();
      button.blur();
    });
  }

  // ---------- Mouse and touch: hold to blow ----------
  // Pointer Events cover mouse, touch and pen with one set of handlers. Only the canvas listens, so
  // clicks on the buttons, the compass, or the panel never start the wind (they sit on top of it).

  let activePointer = null;   // the pointer that is blowing (one at a time)

  function aimAt(e) {
    const [x, y] = pointerToWorld(e.clientX, e.clientY, canvas.getBoundingClientRect());
    setPointer(control, { holding: true, x, y });
  }

  function release() {
    activePointer = null;
    setPointer(control, { holding: false });   // the wind dies down; the leaves coast to a stop
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;   // left button only
    }
    if (activePointer !== null) {
      return;   // a second finger does not take over
    }
    activePointer = e.pointerId;
    // Pointer capture: moves and the release still come to the canvas if the pointer leaves it.
    // If the browser refuses (for example a pointer made by a script), blowing still works without it.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // no capture: the wind stops if the pointer leaves the canvas, which is safe
    }
    aimAt(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === activePointer) {
      aimAt(e);
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (e) => {
      if (e.pointerId === activePointer) {
        release();
      }
    });
  }
  // Any interruption counts as a release, so the wind can never get stuck on.
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      release();
    }
  });

  // ---------- Game loop ----------

  // Every frame: steer the wind, move the leaves (unless paused), then draw them.
  // "Work" is the time our own code takes: update + packing + upload + draw call.
  // It does not include the GPU's drawing time, which runs in parallel after the call returns.
  const callbacks = {
    update(dt) {
      const t0 = performance.now();
      // The control moves the real wind toward what the pointer asks for (limited turn, smooth build).
      stepWindControl(control, dt, settings);
      settings.bearing = control.bearing;
      settings.speed = control.speed;
      const wind = createWind(settings, gusts);   // once per frame, shared by every leaf
      // Step 9b, pile rules: leaves under the top ones of a crowded square are sheltered from the wind,
      const rules = { cap: settings.pileCap, spreadSpeed: settings.spreadSpeed, shelter: settings.shelter, obstacles: settings.obstacles };
      countCells(crowd, leaves);
      shelterLeaves(crowd, leaves, rules);
      for (const leaf of leaves) {
        stepLeaf(leaf, dt, wind);   // each leaf reads its own gust from the noise inside stepLeaf
      }
      // and after moving, overfull squares push their leaves apart (so a pile is a lump, never a point).
      countCells(crowd, leaves);
      spreadLeaves(crowd, leaves, dt, rules);
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

  // ---------- Keys ----------
  // P pauses, F shows or hides the FPS counter, T the developer panel, R resets the scene,
  // D shows or hides the collision circles, G switches to the gray-box look of steps 2 to 9 and back.
  window.addEventListener('keydown', (e) => {
    // Ignore held keys, and keys typed into a text box (the developer panel has number boxes).
    if (e.repeat || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) {
      return;
    }
    if (e.code === 'KeyP') {
      pausedLabel.hidden = !loop.togglePaused();
    } else if (e.code === 'KeyF') {
      statsBox.hidden = !statsBox.hidden;
    } else if (e.code === 'KeyT') {
      pane.hidden = !pane.hidden;
    } else if (e.code === 'KeyR') {
      resetScene();
    } else if (e.code === 'KeyD') {
      debugView = !debugView;
      renderer.setDebug(debugView);
    } else if (e.code === 'KeyG') {
      grayBoxView = !grayBoxView;
      renderer.setGrayBox(grayBoxView);
    }
  });

  loop.start();

  // Debug handle for the browser console. For example:
  //   leafDebug.spawn(5000)        replace the leaves with 5000 new ones (stress test)
  //   leafDebug.spawn(5000, 7)     the same, with another random layout
  //   leafDebug.reset()            back to the normal 1000 leaves
  //   leafDebug.count()            how many leaves there are
  //   leafDebug.getLeaf(0)         a copy of one leaf's values
  //   leafDebug.wind               the live wind settings (bearing and speed are set by the control)
  //   leafDebug.aim(-800, 450)     hold the "mouse" at a world point; leafDebug.release() lets go
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
    control,
    aim(x, y) {
      setPointer(control, { holding: true, x, y });
      return control.holding;
    },
    release() {
      release();
    },
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
