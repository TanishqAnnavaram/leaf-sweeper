// Leaf movement. No WebGL here, so this file can be tested on its own in Node.
// Step 3: leaf movement at constant velocity, stopping at the edge of the world.
// Step 4: spawning many leaves at random (seeded) places.
// Step 5: wind and ground drag.
// Step 6: noise gusts and tumbling.
// Step 7: the void (suction, capture, removal).

import {
  WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_DT, LEAF_START,
  MAX_LEAVES, LEAF_SEED, LEAF_SCALE_MIN, LEAF_SCALE_MAX, WIND_MAX_SPEED,
  GUST_MAX_TURN, GUST_EVOLVE, SPIN_RESPONSE, SPIN_FACTOR_MIN, SPIN_FACTOR_MAX,
  VOID_X, VOID_Y, VOID_RADIUS, SUCTION_SWIRL, CAPTURE_TIME, CAPTURE_TURNS,
} from './config.js';
import { createRandom } from './random.js';

const KEYS = ['x', 'y', 'vx', 'vy', 'angle', 'scale', 'spin', 'spinFactor', 'fade'];
const TWO_PI = 2 * Math.PI;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Copy the valid values onto the leaf. Missing or non-finite values (NaN, Infinity, strings)
// are skipped, so a bad value can never get into the simulation.
export function setLeafValues(leaf, values) {
  if (!values) {
    return leaf;
  }
  for (const key of KEYS) {
    if (isNumber(values[key])) {
      leaf[key] = values[key];
    }
  }
  return leaf;
}

// A new leaf: the start values from config.js, with any valid overrides on top.
export function createLeaf(values) {
  return setLeafValues({ ...LEAF_START }, values);
}

// Radius of the smallest circle around the leaf, at any angle.
// The rectangle's corner is (w/2, h/2) from its center, so the radius is
//   r = sqrt((w/2)^2 + (h/2)^2) = 0.5 * sqrt(w^2 + h^2), times the scale.
// Using a circle means the leaf stays fully inside the world even while it spins.
export function leafRadius(scale) {
  if (!isNumber(scale)) {
    return 0;
  }
  return 0.5 * Math.sqrt(LEAF_WIDTH * LEAF_WIDTH + LEAF_HEIGHT * LEAF_HEIGHT) * Math.abs(scale);
}

// Turn the wind settings into what stepLeaf needs. Call it once per frame, not once per leaf.
//   bearing       degrees the wind blows toward: 0 = up, 90 = right, clockwise
//   speed         world units per second: the speed a leaf ends up moving at in this wind
//   friction      ground drag, per second
//   gustStrength  0 to 1: how much gusts change the speed (0 = even wind, as in step 5)
//   gustSize      world units across one gust patch
//   spinAmount    how much moving leaves tumble (0 = no spin)
//   suction       the void's pull at its center, in world units per second (0 = no pull)
//   voidRadius    attraction radius: no pull farther than this from the void
//   captureRadius a leaf closer than this to the void is caught (0 = never)
// `gusts` (optional) is the gust state from createGusts: the noise function, the time, the drift.
// Returns the same names plus { gusts }, every value safe to use. Settings left out are switched off.
export function createWind({
  bearing, speed, friction, gustStrength, gustSize, spinAmount, suction, voidRadius, captureRadius,
} = {}, gusts) {
  const safeFriction = isNumber(friction) && friction > 0 ? friction : 0;
  let vx = 0;
  let vy = 0;
  if (isNumber(bearing) && isNumber(speed) && speed > 0) {
    // Compass bearing to a vector. A compass measures from "up", clockwise, so
    // x uses sin and y uses cos (the reverse of a math angle measured from "right", counterclockwise).
    const radians = (bearing * Math.PI) / 180;
    vx = Math.sin(radians) * speed;
    vy = Math.cos(radians) * speed;
  }
  // Gust strength is kept in [0, 1], so the speed factor (1 + strength * gust) is never negative.
  const strength = isNumber(gustStrength) ? Math.min(1, Math.max(0, gustStrength)) : 0;
  const size = isNumber(gustSize) && gustSize > 0 ? gustSize : 0;   // 0 = no gusts (and no divide by zero)
  const useGusts = strength > 0 && size > 0 && Boolean(gusts) && typeof gusts.noise === 'function';
  return {
    vx,
    vy,
    friction: safeFriction,
    gustStrength: useGusts ? strength : 0,
    gustSize: size,
    gusts: useGusts ? gusts : null,
    spinAmount: isNumber(spinAmount) && spinAmount > 0 ? spinAmount : 0,
    suction: isNumber(suction) && suction > 0 ? suction : 0,
    voidRadius: isNumber(voidRadius) && voidRadius > 0 ? voidRadius : 0,
    captureRadius: isNumber(captureRadius) && captureRadius > 0 ? captureRadius : 0,
  };
}

// The gust state: the noise function, the simulation time, and how far the gust pattern has drifted.
// It is kept between frames, so it lives outside createWind.
export function createGusts(noise) {
  return { noise, time: 0, offsetX: 0, offsetY: 0 };
}

// Move the gust state forward by dt seconds: time passes, and the whole pattern drifts downwind at
// the wind speed, so gust fronts sweep across the field. Call it once per frame, after the leaves move.
export function advanceGusts(gusts, wind, dt) {
  if (!gusts || !isNumber(dt) || dt <= 0) {
    return gusts;
  }
  dt = Math.min(dt, MAX_DT);
  gusts.time += dt;
  if (wind && isNumber(wind.vx) && isNumber(wind.vy)) {
    gusts.offsetX += wind.vx * dt;
    gusts.offsetY += wind.vy * dt;
  }
  return gusts;
}

// The wind one leaf feels at (x, y). Without gusts, it is the base wind.
// With gusts, two noise values are read at the leaf's spot in the drifting pattern:
//   speed:      w_leaf = w_wind * (1 + k * gust(x, y, t))       (the pitch's formula, k = gustStrength)
//   direction:  turned by  turnGust(x, y, t) * GUST_MAX_TURN degrees
export function leafWind(wind, x, y) {
  if (!wind || typeof wind !== 'object') {
    return { vx: 0, vy: 0 };
  }
  const wx = isNumber(wind.vx) ? wind.vx : 0;
  const wy = isNumber(wind.vy) ? wind.vy : 0;
  const g = wind.gusts;
  if (!g || typeof g.noise !== 'function' || !(wind.gustStrength > 0) || !(wind.gustSize > 0)
      || (wx === 0 && wy === 0)) {
    return { vx: wx, vy: wy };
  }
  // Noise coordinates: the position in "gust patches", shifted by the drift, with time as the 3rd axis.
  const sx = (x - (isNumber(g.offsetX) ? g.offsetX : 0)) / wind.gustSize;
  const sy = (y - (isNumber(g.offsetY) ? g.offsetY : 0)) / wind.gustSize;
  const sz = (isNumber(g.time) ? g.time : 0) * GUST_EVOLVE;
  const speedGust = g.noise(sx, sy, sz);
  // The second value is read far away in noise space, so it is unrelated to the first.
  const turnGust = g.noise(sx + 17.31, sy - 9.57, sz + 41.13);

  const factor = 1 + wind.gustStrength * speedGust;           // 0.4 to 1.6 when k = 0.6
  const turn = (turnGust * GUST_MAX_TURN * Math.PI) / 180;    // radians, -25 to +25 degrees
  // Rotate the wind vector by `turn` (a 2D rotation), then scale it.
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return {
    vx: (wx * c - wy * s) * factor,
    vy: (wx * s + wy * c) * factor,
  };
}

// A name for the wind speed, shown beside the slider.
export function windName(speed, topSpeed = WIND_MAX_SPEED) {
  if (!isNumber(speed) || speed <= 0) {
    return 'Calm';
  }
  if (!isNumber(topSpeed) || topSpeed <= 0) {
    return 'Gale';   // any wind at all, with no top speed to compare to (avoids dividing by zero)
  }
  const fraction = speed / topSpeed;
  if (fraction < 0.3) return 'Breeze';
  if (fraction < 0.7) return 'Wind';
  return 'Gale';
}

// Move one leaf forward in time by dt seconds. Changes the leaf in place.
// `wind` comes from createWind. Without it, the leaf keeps its velocity (no wind, no drag, no spin).
export function stepLeaf(leaf, dt, wind) {
  // A dt that is missing, zero, negative, or not finite means "no time passed".
  if (!isNumber(dt) || dt <= 0) {
    return leaf;
  }
  dt = Math.min(dt, MAX_DT);   // second guard: the loop clamps too, but physics never trusts its input

  // Defensive: a broken value is replaced, so NaN can never spread to the position or the GPU.
  if (!isNumber(leaf.vx)) leaf.vx = 0;
  if (!isNumber(leaf.vy)) leaf.vy = 0;
  if (!isNumber(leaf.x)) leaf.x = 0;
  if (!isNumber(leaf.y)) leaf.y = 0;

  // A caught leaf no longer feels wind or walls: it only plays its spiral into the void.
  if (leaf.captured) {
    return stepCaptured(leaf, dt);
  }

  const f = wind && isNumber(wind.friction) && wind.friction > 0 ? wind.friction : 0;
  if (f > 0) {
    // Wind and drag together. The pitch's two formulas,
    //   wind:  v = v + a * dt              (a = wind push, an acceleration)
    //   drag:  v = v * (1 - f * dt)
    // are small-step versions of one equation:  dv/dt = a - f * v.
    // Its exact solution over a step of length dt is
    //   v_new = W + (v - W) * e^(-f * dt),     where W = a / f is the speed the leaf heads toward.
    // We set W directly (it is the wind speed on the slider), so the push is a = W * f.
    // Because this is exact, the result is the same at any frame rate, and e^(-f * dt) is
    // always between 0 and 1, so drag can never flip a leaf backwards.
    // This leaf's own wind (the base wind changed by gusts at its position). It is held fixed
    // for the step, so the exact solution below still applies.
    // Plus the void's pull, which works the same way: a speed the leaf heads toward.
    const own = leafWind(wind, leaf.x, leaf.y);
    const pull = suctionAt(wind, leaf.x, leaf.y);
    const wx = own.vx + pull.vx;
    const wy = own.vy + pull.vy;
    const decay = Math.exp(-f * dt);
    // Position, also exact: the integral of v(t) over the step,
    //   x_new = x + W * dt + (v - W) * (1 - e^(-f * dt)) / f      (f > 0, so no divide by zero)
    const blend = (1 - decay) / f;
    leaf.x += wx * dt + (leaf.vx - wx) * blend;
    leaf.y += wy * dt + (leaf.vy - wy) * blend;
    leaf.vx = wx + (leaf.vx - wx) * decay;
    leaf.vy = wy + (leaf.vy - wy) * decay;
  } else {
    // No friction: the leaf keeps its velocity (step 3's constant velocity).
    // Euler step: new position = old position + velocity * time.
    leaf.x += leaf.vx * dt;
    leaf.y += leaf.vy * dt;
  }

  // Stop at the world edge. The world runs from -W/2 to W/2 and -H/2 to H/2,
  // and the leaf's center must stay one radius inside that.
  // If the leaf is bigger than the world, the limit would be negative: use 0 (the center).
  const r = leafRadius(leaf.scale);
  const maxX = Math.max(0, WORLD_WIDTH / 2 - r);
  const maxY = Math.max(0, WORLD_HEIGHT / 2 - r);

  // At a wall, clamp the position and zero only the velocity part that points into that wall.
  // The other part is kept, so the leaf slides along the wall until it reaches a corner.
  if (leaf.x > maxX) {
    leaf.x = maxX;
    if (leaf.vx > 0) leaf.vx = 0;
  } else if (leaf.x < -maxX) {
    leaf.x = -maxX;
    if (leaf.vx < 0) leaf.vx = 0;
  }
  if (leaf.y > maxY) {
    leaf.y = maxY;
    if (leaf.vy > 0) leaf.vy = 0;
  } else if (leaf.y < -maxY) {
    leaf.y = -maxY;
    if (leaf.vy < 0) leaf.vy = 0;
  }

  // Tumbling (step 6). Done after the wall check, so a leaf pinned to a wall stops spinning.
  if (wind && typeof wind === 'object') {
    if (!isNumber(leaf.spin)) leaf.spin = 0;
    if (!isNumber(leaf.spinFactor)) leaf.spinFactor = 0;
    if (!isNumber(leaf.angle)) leaf.angle = 0;
    const amount = isNumber(wind.spinAmount) && wind.spinAmount > 0 ? wind.spinAmount : 0;
    // Target spin: a wheel of radius r rolling at speed v turns at v / r radians per second.
    // Each leaf turns at a fraction of that (spinFactor, which also sets the direction).
    const speed = Math.hypot(leaf.vx, leaf.vy);
    const target = r > 0 ? (speed / r) * leaf.spinFactor * amount : 0;   // r > 0: no divide by zero
    // The spin catches up with the target smoothly (the same exact exponential as the drag).
    leaf.spin = target + (leaf.spin - target) * Math.exp(-SPIN_RESPONSE * dt);
    leaf.angle += leaf.spin * dt;
    // Keep the angle in [0, 2 pi), so it never grows large and loses precision.
    let a = leaf.angle % TWO_PI;
    if (a < 0) a += TWO_PI;
    if (!(a < TWO_PI)) a = 0;   // a + 2 pi can round up to exactly 2 pi
    leaf.angle = a;

    // Caught by the void? (Step 7.) Checked after the move, so a leaf that just arrived is caught.
    if (wind.captureRadius > 0) {
      const dx = leaf.x - VOID_X;
      const dy = leaf.y - VOID_Y;
      if (dx * dx + dy * dy < wind.captureRadius * wind.captureRadius) {
        startCapture(leaf);
      }
    }
  }
  return leaf;
}

// Make `count` still leaves at random places, each fully inside the world.
// The same seed always gives the same layout.
// Leaves never start inside `avoidRadius` of the void, so nothing is pulled in before the player acts.
export function spawnLeaves(count, seed = LEAF_SEED, avoidRadius = VOID_RADIUS) {
  // A bad count (NaN, Infinity, text, negative) gives no leaves. A decimal is rounded down.
  let n = (typeof count === 'number' && Number.isFinite(count)) ? Math.floor(count) : 0;
  n = Math.max(0, Math.min(n, MAX_LEAVES));

  const random = createRandom(seed);
  // Spin factors come from a second random stream, so adding them in step 6 did not move any leaf:
  // the positions are the same as in steps 4 and 5 for the same seed.
  const spinRandom = createRandom((isNumber(seed) ? Math.floor(seed) : 0) + 7919);
  const leaves = [];
  for (let i = 0; i < n; i++) {
    // Pick the scale first, because a bigger leaf needs a bigger margin from the edge.
    const scale = LEAF_SCALE_MIN + (LEAF_SCALE_MAX - LEAF_SCALE_MIN) * random();
    const r = leafRadius(scale);
    const maxX = Math.max(0, WORLD_WIDTH / 2 - r);
    const maxY = Math.max(0, WORLD_HEIGHT / 2 - r);
    // random() is in [0, 1), so (2 * random() - 1) is in [-1, 1): a position from -max to max.
    // Try again while the spot is inside the void's radius (about 10% of the world). After 100 tries
    // (only possible with a huge radius) the last spot is used, so the loop always ends.
    const avoid = isNumber(avoidRadius) && avoidRadius > 0 ? avoidRadius : 0;
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      x = (2 * random() - 1) * maxX;
      y = (2 * random() - 1) * maxY;
      if (Math.hypot(x - VOID_X, y - VOID_Y) >= avoid) break;
    }
    const angle = random() * 2 * Math.PI;   // any direction, [0, 2 pi)
    // Spin direction (half clockwise, half counterclockwise) and strength.
    const direction = spinRandom() < 0.5 ? -1 : 1;
    const spinFactor = direction * (SPIN_FACTOR_MIN + (SPIN_FACTOR_MAX - SPIN_FACTOR_MIN) * spinRandom());
    leaves.push(createLeaf({ x, y, vx: 0, vy: 0, angle, scale, spin: 0, spinFactor, fade: 1 }));
  }
  return leaves;
}

// ---------- Step 7: the void ----------

// The void's pull on a leaf at (x, y), as a velocity the leaf heads toward (like the wind).
//   d = distance to the void's center
//   inward speed  = suction * (1 - d / R)      0 at the edge R, full strength at the center
//   swirl speed   = SUCTION_SWIRL * inward    sideways, counterclockwise, so leaves circle in
// Outside R there is no pull.
export function suctionAt(wind, x, y) {
  if (!wind || !(wind.suction > 0) || !(wind.voidRadius > 0) || !isNumber(x) || !isNumber(y)) {
    return { vx: 0, vy: 0 };
  }
  const dx = x - VOID_X;
  const dy = y - VOID_Y;
  const d = Math.hypot(dx, dy);
  // Minimum-distance guard: at (or extremely near) the center the direction (dx / d) is undefined,
  // because it would divide by zero. A leaf there is caught anyway, so it needs no pull.
  if (d >= wind.voidRadius || d < 1e-9) {
    return { vx: 0, vy: 0 };
  }
  const inward = wind.suction * (1 - d / wind.voidRadius);
  const ux = -dx / d;   // unit vector from the leaf toward the center
  const uy = -dy / d;
  const swirl = SUCTION_SWIRL * inward;
  // Counterclockwise around the center is the position direction turned by +90 degrees: (-dy, dx) / d.
  const tx = -dy / d;
  const ty = dx / d;
  return { vx: ux * inward + tx * swirl, vy: uy * inward + ty * swirl };
}

// Start a leaf's capture: remember where it was (as a distance and an angle around the center)
// and its size, so the spiral and the shrink can be worked out from there.
function startCapture(leaf) {
  const dx = leaf.x - VOID_X;
  const dy = leaf.y - VOID_Y;
  leaf.captured = true;
  leaf.done = false;
  leaf.captureT = 0;                       // seconds since capture
  leaf.captureR0 = Math.hypot(dx, dy);     // distance at capture
  leaf.captureA0 = Math.atan2(dy, dx);     // angle around the center at capture
  leaf.captureScale0 = isNumber(leaf.scale) ? leaf.scale : 1;
  leaf.vx = 0;
  leaf.vy = 0;
}

// One step of a caught leaf. With p = progress from 0 to 1 over CAPTURE_TIME seconds:
//   distance = r0 * (1 - p)                     straight in, so it gets closer every frame
//   angle around the center = a0 + turns * 2 pi * p   it circles while it falls in (a spiral)
//   scale = scale0 * (1 - p),  fade = 1 - p      shrink and fade together
// At p = 1 the leaf is marked done; removeFinished then takes it out of the list.
function stepCaptured(leaf, dt) {
  leaf.captureT = (isNumber(leaf.captureT) ? leaf.captureT : 0) + dt;
  // The small 1e-9 makes 36 steps of 1/60 s count as the full 0.6 s despite rounding.
  const p = Math.min(1, leaf.captureT / CAPTURE_TIME + 1e-9);
  const r0 = isNumber(leaf.captureR0) ? leaf.captureR0 : 0;
  const a0 = isNumber(leaf.captureA0) ? leaf.captureA0 : 0;
  const s0 = isNumber(leaf.captureScale0) ? leaf.captureScale0 : 1;
  const r = r0 * (1 - p);
  const a = a0 + CAPTURE_TURNS * TWO_PI * p;
  leaf.x = VOID_X + r * Math.cos(a);
  leaf.y = VOID_Y + r * Math.sin(a);
  leaf.vx = 0;
  leaf.vy = 0;
  leaf.scale = p >= 1 ? 0 : s0 * (1 - p);
  leaf.fade = p >= 1 ? 0 : 1 - p;
  // Spin faster and faster as it falls in (in the leaf's own spin direction).
  const direction = isNumber(leaf.spinFactor) && leaf.spinFactor < 0 ? -1 : 1;
  leaf.angle = (isNumber(leaf.angle) ? leaf.angle : 0) + direction * (4 + 20 * p) * dt;
  let wrapped = leaf.angle % TWO_PI;
  if (wrapped < 0) wrapped += TWO_PI;
  leaf.angle = wrapped < TWO_PI ? wrapped : 0;
  if (p >= 1) {
    leaf.done = true;
  }
  return leaf;
}

// Take every finished (done) leaf out of the list, in place, and return how many were removed.
// "Swap-and-pop": move the last leaf into the gap, then shorten the list by one. Each removal is
// constant time (no shifting of all the leaves after it, as splice would do), so a whole pass is O(n).
// The order of the leaves changes, which does not matter for drawing or physics.
export function removeFinished(leaves) {
  if (!Array.isArray(leaves)) {
    return 0;
  }
  let removed = 0;
  let i = 0;
  while (i < leaves.length) {
    const leaf = leaves[i];
    if (leaf && leaf.done) {
      const last = leaves.pop();      // take the last leaf off the end
      if (i < leaves.length) {
        leaves[i] = last;             // and put it where the finished leaf was
      }
      removed++;
      // Do not move i on: the leaf just moved into slot i has not been checked yet.
    } else {
      i++;
    }
  }
  return removed;
}
