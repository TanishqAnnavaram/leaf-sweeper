// Tests for packLeaves: copying leaves into the flat array the GPU reads.
// Step 10a layout: 6 floats per leaf, x, y, angle, scale, fade, tint.
// Run with:  node tests/pack.test.js   (packLeaves is pure: no WebGL is needed)

import { test, assert, report } from './harness.js';
import { packLeaves, FLOATS_PER_LEAF } from '../src/renderer.js';

const F = 6;   // floats per leaf

function leaf(x, y, angle, scale, fade, tint, vx = 0, vy = 0) {
  const l = { x, y, vx, vy, angle, scale };
  if (fade !== undefined) l.fade = fade;
  if (tint !== undefined) l.tint = tint;
  return l;
}

test('6 floats per leaf', () => {
  assert(FLOATS_PER_LEAF === F, `FLOATS_PER_LEAF ${FLOATS_PER_LEAF}`);
});

test('writes x, y, angle, scale, fade, tint for each leaf, in order', () => {
  const out = new Float32Array(12);
  packLeaves([leaf(1, 2, 0.5, 1.25, 0.75, 0.125), leaf(-3, 4, 1.5, 0.75, 0.25, 0.875)], out);
  const expected = [1, 2, 0.5, 1.25, 0.75, 0.125, -3, 4, 1.5, 0.75, 0.25, 0.875];
  assert(expected.every((v, i) => out[i] === v), `got ${Array.from(out)}`);
});

test('a missing fade counts as 1 (fully visible)', () => {
  const out = new Float32Array(F);
  packLeaves([leaf(1, 2, 0, 1)], out);
  assert(out[4] === 1, `fade ${out[4]}`);
});

test('fade is kept between 0 and 1, and a NaN fade becomes 1', () => {
  const out = new Float32Array(3 * F);
  packLeaves([leaf(0, 0, 0, 1, 2), leaf(0, 0, 0, 1, -1), leaf(0, 0, 0, 1, NaN)], out);
  assert(out[4] === 1 && out[F + 4] === 0 && out[2 * F + 4] === 1, `fades ${out[4]}, ${out[F + 4]}, ${out[2 * F + 4]}`);
});

test('a missing tint counts as 0.5 (the middle color)', () => {
  const out = new Float32Array(F);
  packLeaves([leaf(1, 2, 0, 1, 1)], out);
  assert(out[5] === 0.5, `tint ${out[5]}`);
});

test('tint is kept between 0 and 1, and a NaN tint becomes 0.5', () => {
  const out = new Float32Array(3 * F);
  packLeaves([leaf(0, 0, 0, 1, 1, 3), leaf(0, 0, 0, 1, 1, -2), leaf(0, 0, 0, 1, 1, NaN)], out);
  assert(out[5] === 1 && out[F + 5] === 0 && out[2 * F + 5] === 0.5, `tints ${out[5]}, ${out[F + 5]}, ${out[2 * F + 5]}`);
});

test('returns the number of leaves written', () => {
  const out = new Float32Array(10 * F);
  assert(packLeaves([leaf(0, 0, 0, 1), leaf(0, 0, 0, 1), leaf(0, 0, 0, 1)], out) === 3, 'count');
});

test('velocity is not written', () => {
  const out = new Float32Array(F);
  packLeaves([leaf(1, 2, 3, 1, 1, 0.5, 999, -999)], out);
  assert(!Array.from(out).includes(999) && !Array.from(out).includes(-999), `got ${Array.from(out)}`);
});

test('an empty list writes nothing and returns 0', () => {
  const out = new Float32Array(F).fill(7);
  assert(packLeaves([], out) === 0, 'count');
  assert(out[0] === 7, 'array was changed');
});

test('a missing or non-array list returns 0', () => {
  const out = new Float32Array(F);
  for (const bad of [undefined, null, 5, 'leaves', {}]) {
    assert(packLeaves(bad, out) === 0, `input ${bad}`);
  }
});

test('a leaf with NaN or Infinity is packed as zeros, so it is not drawn', () => {
  const out = new Float32Array(3 * F);
  packLeaves([leaf(NaN, 0, 0, 1), leaf(0, Infinity, 0, 1), leaf(0, 0, 0, NaN)], out);
  for (let i = 0; i < 3; i++) {
    assert(out[i * F + 3] === 0, `leaf ${i} scale ${out[i * F + 3]}`);
    for (let k = 0; k < F; k++) {
      assert(Number.isFinite(out[i * F + k]), `leaf ${i} value ${k} is ${out[i * F + k]}`);
    }
  }
});

test('a null or non-object entry is packed with scale 0', () => {
  const out = new Float32Array(2 * F);
  packLeaves([null, 'x'], out);
  assert(out[3] === 0 && out[F + 3] === 0, `got ${Array.from(out)}`);
});

test('more leaves than the array holds are cut at its capacity', () => {
  const out = new Float32Array(2 * F);   // room for 2 leaves
  const leaves = [leaf(1, 1, 0, 1), leaf(2, 2, 0, 1), leaf(3, 3, 0, 1)];
  assert(packLeaves(leaves, out) === 2, 'count');
  assert(out[F] === 2, 'second leaf missing');
});

test('an array with a partial slot (length not a multiple of 6) never overflows', () => {
  const out = new Float32Array(F + 4);   // room for 1 whole leaf
  assert(packLeaves([leaf(1, 1, 0, 1), leaf(2, 2, 0, 1)], out) === 1, 'count');
  assert(out[F] === 0 && out[F + 3] === 0, 'wrote into the partial slot');
});

test('packs 10,000 leaves', () => {
  const leaves = [];
  for (let i = 0; i < 10000; i++) leaves.push(leaf(i, -i, 0, 1, 0.5, 0.25));
  const out = new Float32Array(10000 * F);
  assert(packLeaves(leaves, out) === 10000, 'count');
  const o = F * 9999;
  assert(out[o] === 9999 && out[o + 1] === -9999 && out[o + 4] === 0.5 && out[o + 5] === 0.25, 'last leaf wrong');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
