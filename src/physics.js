// Leaf movement. No WebGL here, so this file can be tested on its own in Node.
// Step 3: leaf movement at constant velocity, stopping at the edge of the world.
// Step 4: spawning many leaves at random (seeded) places.
// Step 5: wind and ground drag.

import {
  WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_DT, LEAF_START,
  MAX_LEAVES, LEAF_SEED, LEAF_SCALE_MIN, LEAF_SCALE_MAX, WIND_MAX_SPEED,
} from './config.js';
import { createRandom } from './random.js';

const KEYS = ['x', 'y', 'vx', 'vy', 'angle', 'scale'];

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
//   bearing   degrees the wind blows toward: 0 = up, 90 = right, clockwise
//   speed     world units per second: the speed a leaf ends up moving at in this wind
//   friction  ground drag, per second
// Returns { vx, vy, friction }: the wind's velocity as a vector, and a safe friction.
export function createWind({ bearing, speed, friction } = {}) {
  const safeFriction = isNumber(friction) && friction > 0 ? friction : 0;
  if (!isNumber(bearing) || !isNumber(speed) || speed <= 0) {
    return { vx: 0, vy: 0, friction: safeFriction };   // no wind
  }
  // Compass bearing to a vector. A compass measures from "up", clockwise, so
  // x uses sin and y uses cos (the reverse of a math angle measured from "right", counterclockwise).
  const radians = (bearing * Math.PI) / 180;
  return { vx: Math.sin(radians) * speed, vy: Math.cos(radians) * speed, friction: safeFriction };
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
// `wind` comes from createWind. Without it, the leaf keeps its velocity (no wind, no drag).
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
    const wx = isNumber(wind.vx) ? wind.vx : 0;
    const wy = isNumber(wind.vy) ? wind.vy : 0;
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
  return leaf;
}

// Make `count` still leaves at random places, each fully inside the world.
// The same seed always gives the same layout.
export function spawnLeaves(count, seed = LEAF_SEED) {
  // A bad count (NaN, Infinity, text, negative) gives no leaves. A decimal is rounded down.
  let n = (typeof count === 'number' && Number.isFinite(count)) ? Math.floor(count) : 0;
  n = Math.max(0, Math.min(n, MAX_LEAVES));

  const random = createRandom(seed);
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
    leaves.push(createLeaf({ x, y, vx: 0, vy: 0, angle, scale }));
  }
  return leaves;
}
