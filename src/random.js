// A seeded random number generator, written by us. No WebGL here.
//
// Math.random() gives a different sequence on every page load and cannot be seeded.
// With a seed, the same seed always gives the same numbers, so the leaf layout is the same
// on every reload and any bug we see can be seen again.
//
// The method is "mulberry32": a 32-bit counter that is stirred with multiplies, shifts and XORs.
// It is tiny and fast, and its numbers are well spread, which is all a game layout needs.
// (It is not safe for passwords or security: never use it for that.)

export function createRandom(seed) {
  // Turn any seed into a whole number from 0 to 2^32 - 1. A bad seed (NaN, Infinity, text) acts like 0.
  let state = (typeof seed === 'number' && Number.isFinite(seed)) ? Math.floor(seed) >>> 0 : 0;

  // Each call returns the next number in [0, 1).
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;              // step the counter (">>> 0" keeps it a 32-bit whole number)
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);            // Math.imul: 32-bit multiply, like C's int multiply
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;    // divide by 2^32: a value from 0 up to (not including) 1
  };
}
