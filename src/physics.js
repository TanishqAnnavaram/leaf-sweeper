// Leaf movement. No WebGL here, so this file can be tested on its own in Node.
// Step 3: leaf movement at constant velocity, stopping at the edge of the world.
// Step 4: spawning many leaves at random (seeded) places.
// Step 5: wind and ground drag.
// Step 6: noise gusts and tumbling.

import {
  WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_DT, LEAF_START,
  MAX_LEAVES, LEAF_SEED, LEAF_SCALE_MIN, LEAF_SCALE_MAX, WIND_MAX_SPEED,
  GUST_MAX_TURN, GUST_EVOLVE, SPIN_RESPONSE, SPIN_FACTOR_MIN, SPIN_FACTOR_MAX,
} from './config.js';
import { createRandom } from './random.js';

const KEYS = ['x', 'y', 'vx', 'vy', 'angle', 'scale', 'spin', 'spinFactor'];
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
// `gusts` (optional) is the gust state from createGusts: the noise function, the time, the drift.
// Returns { vx, vy, friction, gustStrength, gustSize, gusts, spinAmount }, every value safe to use.
export function createWind({ bearing, speed, friction, gustStrength, gustSize, spinAmount } = {}, gusts) {
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
    const own = leafWind(wind, leaf.x, leaf.y);
    const wx = own.vx;
    const wy = own.vy;
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
  }
  return leaf;
}

// Make `count` still leaves at random places, each fully inside the world.
// The same seed always gives the same layout.
export function spawnLeaves(count, seed = LEAF_SEED) {
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
    const x = (2 * random() - 1) * maxX;
    const y = (2 * random() - 1) * maxY;
    const angle = random() * 2 * Math.PI;   // any direction, [0, 2 pi)
    // Spin direction (half clockwise, half counterclockwise) and strength.
    const direction = spinRandom() < 0.5 ? -1 : 1;
    const spinFactor = direction * (SPIN_FACTOR_MIN + (SPIN_FACTOR_MAX - SPIN_FACTOR_MIN) * spinRandom());
    leaves.push(createLeaf({ x, y, vx: 0, vy: 0, angle, scale, spin: 0, spinFactor }));
  }
  return leaves;
}
