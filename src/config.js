// Shared constants. Kept free of WebGL so the physics and the tests can import them too.

// The game world is a fixed-size rectangle measured in "world units".
// The origin (0, 0) is the center, x grows to the right, y grows up.
// So x runs from -800 to 800 and y runs from -450 to 450.
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;

// Size of a leaf at scale 1, in world units: its length (stem end to tip) and its width at the
// widest point. Step 10a made it smaller (was 40 x 24) so 1000 leaves cover less of the floor.
// The gray-box look (G key) draws a rectangle of exactly this size.
export const LEAF_WIDTH = 32;
export const LEAF_HEIGHT = 19;
// Collision radius of a scale-1 leaf: the farthest point of the leaf shape from its center.
// The tip and the stem end are the farthest points, so this is half the length (step 10a;
// before, it was half the rectangle's diagonal). Physics and the debug rings both use it.
export const LEAF_RADIUS = LEAF_WIDTH / 2;
// Step 10a: each Bézier edge of the leaf is sampled at this many points to make the triangle mesh.
export const LEAF_SEGMENTS = 12;

// Largest time step the simulation may take in one frame, in seconds.
// If a frame takes longer (a slow frame, or a hidden tab coming back), the leaf moves
// as if only 1/30 s had passed, so it can never jump far in one step.
export const MAX_DT = 1 / 30;

// Default values for createLeaf (the single moving leaf of step 3): position in world units,
// velocity in world units per second, angle in radians, scale (1 = normal size).
// Frozen so no code can change it by accident.
export const LEAF_START = Object.freeze({
  x: -600, y: -300, vx: 200, vy: 120, angle: 0, scale: 1, spin: 0, spinFactor: 0, fade: 1, tint: 0.5,
});

// Step 4: many leaves, drawn with one instanced draw call.
export const LEAF_COUNT = 1000;       // how many leaves the scene starts with
export const MAX_LEAVES = 10000;      // size of the GPU buffer; extra leaves are not drawn
export const LEAF_SEED = 20261119;    // seed for the random layout, so every reload looks the same
export const LEAF_SCALE_MIN = 0.8;    // spawned leaves get a random scale in this range
export const LEAF_SCALE_MAX = 1.2;
// Step 10a: each leaf's color ("tint", 0 to 1) comes from a third random stream with this seed offset,
// so adding colors moved no leaf and changed no spin. 104729 is just a large prime.
export const TINT_SEED_OFFSET = 104729;

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
// Step 10a: the collision radius shrank from 23.32 (half the old 40 x 24 diagonal) to 16, which alone
// would make leaves spin 1.46 times faster. To keep the tumbling of step 6 (Tanishq's choice), the
// amount is scaled by the same ratio: 0.5 * 16 / 23.32 = 0.343.
export const SPIN_AMOUNT = 0.5 * LEAF_RADIUS / (0.5 * Math.sqrt(40 * 40 + 24 * 24));
export const SPIN_RESPONSE = 4;       // how fast the spin catches up with its target, per second
export const SPIN_FACTOR_MIN = 0.3;   // each leaf gets a random spin factor in this range, and a random direction
export const SPIN_FACTOR_MAX = 1.0;

// Step 7: the void.
export const VOID_X = 0;              // the void sits at the center of the world
export const VOID_Y = 0;
export const VOID_RADIUS = 220;       // attraction radius: the pull starts here, in world units
export const CAPTURE_RADIUS = 30;     // a leaf closer than this to the center is caught
// The pull is a speed toward the center, like the wind speed: SUCTION_MAX * (1 - d / VOID_RADIUS),
// so 0 at the edge and 500 units/s at the center (more than a Gale, so the middle always wins).
export const SUCTION_MAX = 500;
export const SUCTION_SWIRL = 0.3;     // sideways (counterclockwise) part of the pull, as a fraction of it
export const CAPTURE_TIME = 0.6;      // seconds a caught leaf takes to spiral in, shrink, and fade
export const CAPTURE_TURNS = 1;       // how many times a caught leaf circles the center on the way in
export const VOID_DISC_RADIUS = 40;   // size of the dark disc drawn at the center (gray-box look)

// Step 8: mouse-aim wind. While the mouse button (or a finger) is held on the field, the wind blows
// from the cursor toward the void. Its strength grows with the cursor's distance from the void:
// Calm within AIM_CALM_RADIUS, rising in a straight line to the top speed at AIM_GALE_DISTANCE.
export const AIM_CALM_RADIUS = 40;      // world units (the size of the void's dark disc)
export const AIM_GALE_DISTANCE = 600;   // world units
// The real wind follows the aim smoothly: it turns at most WIND_TURN_RATE degrees per second, and its
// speed approaches the aim's speed with time constant WIND_BUILD_TIME (63% of the way after that time).
export const WIND_TURN_RATE = 180;      // degrees per second
export const WIND_BUILD_TIME = 0.3;     // seconds

// Step 9: obstacles. Circles that leaves bounce off: 3 rocks and 2 tree trunks, the same every round.
// Rock A and trunk B sit on the corner-to-void diagonals, so the easiest sweep is partly blocked.
// All of them stay at least OBSTACLE_WALL_GAP from the walls (so a leaf is never trapped between an
// obstacle and a wall), clear of each other, and clear of the void's ring.
export const OBSTACLES = Object.freeze([
  Object.freeze({ x: -400, y: 225, radius: 55, kind: 'rock' }),    // A: on the top-left diagonal
  Object.freeze({ x: 440, y: -247, radius: 40, kind: 'trunk' }),   // B: on the bottom-right diagonal
  Object.freeze({ x: 560, y: 120, radius: 35, kind: 'rock' }),     // C
  Object.freeze({ x: -520, y: -170, radius: 45, kind: 'trunk' }),  // D
  Object.freeze({ x: 60, y: 340, radius: 30, kind: 'rock' }),      // E: the smallest
]);
export const OBSTACLE_WALL_GAP = 60;      // world units
// When a leaf hits an obstacle, the part of its velocity pointing into it comes back reversed and
// multiplied by this ("restitution"): 0 = no bounce, 1 = a perfect bounce. Leaves are light: 0.5.
export const OBSTACLE_RESTITUTION = 0.5;
// Tunneling guard: a leaf that would move farther than this in one frame is moved in smaller steps.
// It must stay below the smallest obstacle radius plus the smallest leaf radius (30 + 0.8 * 16 = 42.8),
// so no leaf can ever jump past an obstacle's middle in one step. At default settings the fastest
// leaf moves about 38.7 units per frame, so sub-steps never happen there.
export const MAX_STEP_DISTANCE = 40;

// Step 10b: the ground texture. A fixed seed for its noise, so the ground is the same every round.
export const GROUND_SEED = 20261120;
