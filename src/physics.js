// Leaf movement. No WebGL here, so this file can be tested on its own in Node.
// Step 3: one leaf moving at constant velocity that stops at the edge of the world.

import { WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_DT, LEAF_START } from './config.js';

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

// Move one leaf forward in time by dt seconds. Changes the leaf in place.
export function stepLeaf(leaf, dt) {
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

  // Euler step for constant velocity: new position = old position + velocity * time.
  leaf.x += leaf.vx * dt;
  leaf.y += leaf.vy * dt;

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
