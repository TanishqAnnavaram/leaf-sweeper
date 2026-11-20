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

// Where the step 3 leaf starts: position in world units, velocity in world units per second,
// angle in radians, scale (1 = normal size). Frozen so no code can change it by accident.
export const LEAF_START = Object.freeze({ x: -600, y: -300, vx: 200, vy: 120, angle: 0, scale: 1 });
