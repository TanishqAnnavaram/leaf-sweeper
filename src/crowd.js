// Pile rules (step 9b). No WebGL here, so this file can be tested on its own in Node.
//
// Why: with nothing stopping it, a Gale into a corner stacks every leaf on one spot (the walls hold
// each leaf one radius away, and that is the same spot for all of them). The pile then moves as one
// point and can be steered into the void in about 12 s (the "corner-pile exploit").
//
// Two rules, both based on a grid of small squares (cells) over the world:
//   1. Cell cap (spread): a square holds at most `cap` leaves. In a fuller square, each leaf is pushed
//      toward the emptier side, so a pile spreads into a lump instead of a point.
//   2. Shelter: in a fuller square only the `cap` leaves on top feel the full wind; the ones under them
//      feel a fraction of it. So pushing a pile peels it apart instead of carrying it whole.
//
// Counting leaves per square costs the same however crowded the field is (one pass over the leaves),
// unlike comparing every pair of leaves, which gets slow exactly when they are all on one spot.

import {
  WORLD_WIDTH, WORLD_HEIGHT, MAX_LEAVES, MAX_DT, CROWD_CELL, PILE_CAP, SPREAD_SPEED, SHELTER,
} from './config.js';
import { leafRadius, resolveObstacles } from './physics.js';

const HW = WORLD_WIDTH / 2;
const HH = WORLD_HEIGHT / 2;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// The grid and its arrays, made once and reused every frame (no new arrays per frame).
//   counts[k]   how many leaves are in square k (k = row * cols + column)
//   cellOf[i]   the square of leaf i, or -1 if it is not counted (caught, or a broken position)
//   seen[k]     scratch counter for shelterLeaves
export function createCrowd(maxLeaves = MAX_LEAVES) {
  const cols = Math.ceil(WORLD_WIDTH / CROWD_CELL);    // 1600 / 16 = 100
  const rows = Math.ceil(WORLD_HEIGHT / CROWD_CELL);   // 900 / 16 = 56.25, so 57
  return {
    cols,
    rows,
    counts: new Int32Array(cols * rows),
    seen: new Int32Array(cols * rows),
    cellOf: new Int32Array(Math.max(1, isNumber(maxLeaves) ? Math.floor(maxLeaves) : MAX_LEAVES)),
  };
}

// Count the leaves in each square. Call it again whenever the leaves have moved.
export function countCells(crowd, leaves) {
  crowd.counts.fill(0);
  if (!Array.isArray(leaves)) {
    return;
  }
  if (crowd.cellOf.length < leaves.length) {
    crowd.cellOf = new Int32Array(leaves.length);   // more leaves than planned: grow once
  }
  const { cols, rows } = crowd;
  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i];
    if (!l || l.captured || !isNumber(l.x) || !isNumber(l.y)) {
      crowd.cellOf[i] = -1;
      continue;
    }
    // World position to square: shift so the world starts at (0, 0), divide by the square size,
    // and keep it inside the grid (a leaf exactly on the far edge belongs to the last square).
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((l.x + HW) / CROWD_CELL)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((l.y + HH) / CROWD_CELL)));
    const k = cy * cols + cx;
    crowd.cellOf[i] = k;
    crowd.counts[k]++;
  }
}

// Read the rule settings, falling back to the defaults for missing or broken values.
function readRules(rules = {}) {
  const r = rules || {};
  return {
    cap: isNumber(r.cap) && r.cap >= 1 ? Math.floor(r.cap) : PILE_CAP,
    spreadSpeed: isNumber(r.spreadSpeed) && r.spreadSpeed >= 0 ? r.spreadSpeed : SPREAD_SPEED,
    shelter: isNumber(r.shelter) ? Math.min(1, Math.max(0, r.shelter)) : SHELTER,
    obstacles: Array.isArray(r.obstacles) ? r.obstacles : [],
  };
}

// Shelter: set each leaf's windScale (1 = full wind). Uses the counts from countCells.
// "On top" = drawn last: the renderer draws the leaves in list order, so later leaves cover earlier
// ones. Going through the list backwards, the first `cap` leaves met in a square are the top ones.
export function shelterLeaves(crowd, leaves, rules) {
  if (!Array.isArray(leaves)) {
    return;
  }
  const { cap, shelter } = readRules(rules);
  crowd.seen.fill(0);
  for (let i = leaves.length - 1; i >= 0; i--) {
    const l = leaves[i];
    if (!l) continue;
    const k = i < crowd.cellOf.length ? crowd.cellOf[i] : -1;
    if (k < 0) {
      l.windScale = 1;   // caught or not counted: the rules do not apply
      continue;
    }
    crowd.seen[k]++;
    l.windScale = crowd.counts[k] <= cap || crowd.seen[k] <= cap ? 1 : shelter;
  }
}

// Cell cap: push the leaves of overfull squares apart. Uses the counts from countCells, so call
// countCells first (after the leaves have moved this frame).
// Each leaf in a square with n > cap leaves moves
//   distance = spreadSpeed * dt * min(1, (n - cap) / cap)       (fuller square, faster push)
// in the direction  (toward the emptier neighbour) + 0.5 * (its own fan direction), normalised.
//   - toward the emptier neighbour: the difference of the counts left and right, below and above
//     (a "gradient" of the crowding). Outside the world counts as very full, so piles spread inward.
//   - own fan direction: an angle from the leaf's tint, fixed for each leaf. Without it, leaves on
//     exactly the same spot would all move the same way and stay on one spot.
// Then rocks and walls are checked again, so a push never moves a leaf into a rock or out of the world.
export function spreadLeaves(crowd, leaves, dt, rules) {
  if (!Array.isArray(leaves) || !isNumber(dt) || dt <= 0) {
    return;
  }
  const step = Math.min(dt, MAX_DT);   // same clamp as the physics
  const { cap, spreadSpeed, obstacles } = readRules(rules);
  const { cols, rows, counts } = crowd;
  const FULL = 1e6;   // the count used for "outside the world"
  const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? FULL : counts[y * cols + x]);

  for (let i = 0; i < leaves.length; i++) {
    const k = i < crowd.cellOf.length ? crowd.cellOf[i] : -1;
    if (k < 0 || counts[k] <= cap) continue;
    const l = leaves[i];
    const x = k % cols;
    const y = (k - x) / cols;
    let gx = at(x - 1, y) - at(x + 1, y);   // positive: the right side is emptier
    let gy = at(x, y - 1) - at(x, y + 1);   // positive: the upper side is emptier
    const g = Math.sqrt(gx * gx + gy * gy);   // (Math.hypot is much slower in this hot loop)
    const fan = 2 * Math.PI * (isNumber(l.tint) ? l.tint : (i * 0.618034) % 1);
    gx = (g > 0 ? gx / g : 0) + 0.5 * Math.cos(fan);
    gy = (g > 0 ? gy / g : 0) + 0.5 * Math.sin(fan);
    const n = Math.sqrt(gx * gx + gy * gy);
    if (n < 1e-9) continue;   // the two directions cancelled out exactly: no push this frame
    const distance = spreadSpeed * step * Math.min(1, (counts[k] - cap) / cap);
    l.x += (gx / n) * distance;
    l.y += (gy / n) * distance;

    // Keep the rules of steps 3 and 9: never inside a rock, never outside the world.
    if (obstacles.length > 0) resolveObstacles(l, obstacles);
    const r = leafRadius(l.scale);
    const maxX = Math.max(0, HW - r);
    const maxY = Math.max(0, HH - r);
    l.x = Math.min(maxX, Math.max(-maxX, l.x));
    l.y = Math.min(maxY, Math.max(-maxY, l.y));
  }
}
