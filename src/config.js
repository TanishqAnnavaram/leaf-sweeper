// Shared constants. Kept free of WebGL so the physics and the tests can import them too.

// The game world is a fixed-size rectangle measured in "world units".
// The origin (0, 0) is the center, x grows to the right, y grows up.
// So x runs from -800 to 800 and y runs from -450 to 450.
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;

// Size of the gray-box leaf at scale 1, in world units.
export const LEAF_WIDTH = 40;
export const LEAF_HEIGHT = 24;

// Largest time step the simulation may take in one frame, in seconds.
// If a frame takes longer (a slow frame, or a hidden tab coming back), the leaf moves
// as if only 1/30 s had passed, so it can never jump far in one step.
export const MAX_DT = 1 / 30;

// Default values for createLeaf (the single moving leaf of step 3): position in world units,
// velocity in world units per second, angle in radians, scale (1 = normal size).
// Frozen so no code can change it by accident.
export const LEAF_START = Object.freeze({
  x: -600, y: -300, vx: 200, vy: 120, angle: 0, scale: 1, spin: 0, spinFactor: 0,
});

// Step 4: many leaves, drawn with one instanced draw call.
export const LEAF_COUNT = 1000;       // how many leaves the scene starts with
export const MAX_LEAVES = 10000;      // size of the GPU buffer; extra leaves are not drawn
export const LEAF_SEED = 20261119;    // seed for the random layout, so every reload looks the same
export const LEAF_SCALE_MIN = 0.8;    // spawned leaves get a random scale in this range
export const LEAF_SCALE_MAX = 1.2;

// Step 5: wind and ground drag.
// FRICTION is how fast the ground slows a leaf, per second. With 1.5, a leaf's speed halves
// every ln(2) / 1.5 = 0.46 s once the wind stops, so it is nearly still after about 3 s.
export const FRICTION = 1.5;
// The wind speed slider runs from 0 (Calm) to this many world units per second (Gale).
// The wind speed is the speed a leaf ends up moving at, so at Gale a leaf crosses the
// 1600-unit world in about 4 s.
export const WIND_MAX_SPEED = 400;
// Wind at the start: Calm, pointing right. Bearing in degrees, the direction the wind blows
// toward: 0 = up, 90 = right, 180 = down, 270 = left (clockwise, like a compass).
export const WIND_START = Object.freeze({ bearing: 90, speed: 0 });

// Step 6: noise gusts and tumbling.
// Each leaf's wind is the base wind times (1 + GUST_STRENGTH * gust), with gust from -1 to 1,
// so 0.6 gives 0.4x to 1.6x the base speed. A second noise value turns it by up to GUST_MAX_TURN degrees.
export const GUST_STRENGTH = 0.6;
export const GUST_SIZE = 300;         // size of one gust patch, in world units
export const GUST_MAX_TURN = 25;      // degrees
export const GUST_EVOLVE = 0.25;      // how fast the gust pattern changes shape (noise units per second)
// Tumbling: a leaf's spin heads toward  speed / radius * spinFactor * SPIN_AMOUNT  (radians per second).
// speed / radius is how fast a wheel of that radius turns when it rolls at that speed.
export const SPIN_AMOUNT = 0.5;
export const SPIN_RESPONSE = 4;       // how fast the spin catches up with its target, per second
export const SPIN_FACTOR_MIN = 0.3;   // each leaf gets a random spin factor in this range, and a random direction
export const SPIN_FACTOR_MAX = 1.0;
