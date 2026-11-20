// 3D Perlin noise ("improved noise", Ken Perlin, 2002), written by us. No WebGL here.
//
// What it is: a smooth random function noise(x, y, z) with values from -1 to 1. Nearby inputs give
// nearby outputs, so it looks like soft hills instead of TV static. We use x and y for the position
// on the ground and z for time, so the gust pattern also changes smoothly over time.
//
// How it works, in four steps:
//   1. Space is cut into unit cubes. Each cube corner gets a pseudo-random "gradient" direction,
//      looked up from a shuffled table of 0 to 255 (the shuffle comes from our seeded random numbers).
//   2. For the input point, each of the 8 corners of its cube gives a value: the dot product of the
//      corner's gradient with the vector from that corner to the point.
//   3. The 8 values are blended together, weighted by how close the point is to each corner.
//   4. The blend weights go through a "fade" curve 6t^5 - 15t^4 + 10t^3, which is flat at both ends,
//      so there are no visible creases at the cube edges.
// At a corner itself the vector to the point is zero, so the noise is exactly 0 at whole numbers.

import { createRandom } from './random.js';

// fade(t) = 6t^5 - 15t^4 + 10t^3: goes from 0 to 1 with zero slope and zero curvature at both ends.
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Linear blend: a when t = 0, b when t = 1.
function lerp(t, a, b) {
  return a + t * (b - a);
}

// Dot product of the point (x, y, z) with one of 12 gradient directions, picked by the low 4 bits
// of the hash. The 12 directions point to the middles of a cube's 12 edges, e.g. (1, 1, 0), (-1, 0, 1).
// (16 cases map onto those 12; this is Perlin's own trick to avoid a slow % 12.)
function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

// Make a noise function from a seed. The same seed always gives the same noise.
export function createNoise(seed) {
  const random = createRandom(seed);   // a bad seed (NaN, text) already acts like 0 in createRandom

  // The numbers 0 to 255 in a random order (a Fisher-Yates shuffle), stored twice in a row
  // so that perm[i + 1] never needs a wrap-around check.
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  return function noise(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return 0;   // a bad input never becomes NaN
    }
    // Which unit cube the point is in (wrapped to 0..255), and where inside it (0 to 1 on each axis).
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);

    // Hash the 8 corners of the cube.
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;

    // Blend the 8 corner values: first along x, then y, then z.
    const value = lerp(w,
      lerp(v,
        lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
        lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))),
      lerp(v,
        lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))));

    // The result is already about -1 to 1; the clamp makes the range a promise the physics can rely on.
    return Math.max(-1, Math.min(1, value));
  };
}
