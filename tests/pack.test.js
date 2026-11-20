// Tests for packLeaves: copying leaves into the flat array the GPU reads.
// Step 7 layout: 5 floats per leaf, x, y, angle, scale, fade.
// Run with:  node tests/pack.test.js   (packLeaves is pure: no WebGL is needed)

import { test, assert, report } from './harness.js';
import { packLeaves, FLOATS_PER_LEAF } from '../src/renderer.js';

function leaf(x, y, angle, scale, fade, vx = 0, vy = 0) {
  const l = { x, y, vx, vy, angle, scale };
  if (fade !== undefined) l.fade = fade;
  return l;
}

test('5 floats per leaf', () => {
  assert(FLOATS_PER_LEAF === 5, `FLOATS_PER_LEAF ${FLOATS_PER_LEAF}`);
});

test('writes x, y, angle, scale, fade for each leaf, in order', () => {
  const out = new Float32Array(10);
  packLeaves([leaf(1, 2, 0.5, 1.25, 0.75), leaf(-3, 4, 1.5, 0.75, 0.25)], out);
  const expected = [1, 2, 0.5, 1.25, 0.75, -3, 4, 1.5, 0.75, 0.25];
  assert(expected.every((v, i) => out[i] === v), `got ${Array.from(out)}`);
});

test('a missing fade counts as 1 (fully visible)', () => {
  const out = new Float32Array(5);
  packLeaves([leaf(1, 2, 0, 1)], out);
  assert(out[4] === 1, `fade ${out[4]}`);
});

test('fade is kept between 0 and 1, and a NaN fade becomes 1', () => {
  const out = new Float32Array(15);
  packLeaves([leaf(0, 0, 0, 1, 2), leaf(0, 0, 0, 1, -1), leaf(0, 0, 0, 1, NaN)], out);
  assert(out[4] === 1 && out[9] === 0 && out[14] === 1, `fades ${out[4]}, ${out[9]}, ${out[14]}`);
});

test('returns the number of leaves written', () => {
  const out = new Float32Array(50);
  assert(packLeaves([leaf(0, 0, 0, 1), leaf(0, 0, 0, 1), leaf(0, 0, 0, 1)], out) === 3, 'count');
});

test('velocity is not written', () => {
  const out = new Float32Array(5);
  packLeaves([leaf(1, 2, 3, 1, 1, 999, -999)], out);
  assert(!Array.from(out).includes(999) && !Array.from(out).includes(-999), `got ${Array.from(out)}`);
});

test('an empty list writes nothing and returns 0', () => {
  const out = new Float32Array(5).fill(7);
  assert(packLeaves([], out) === 0, 'count');
  assert(out[0] === 7, 'array was changed');
});

test('a missing or non-array list returns 0', () => {
  const out = new Float32Array(5);
  for (const bad of [undefined, null, 5, 'leaves', {}]) {
    assert(packLeaves(bad, out) === 0, `input ${bad}`);
  }
});

test('a leaf with NaN or Infinity is packed as zeros, so it is not drawn', () => {
  const out = new Float32Array(15);
  packLeaves([leaf(NaN, 0, 0, 1), leaf(0, Infinity, 0, 1), leaf(0, 0, 0, NaN)], out);
  for (let i = 0; i < 3; i++) {
    assert(out[i * 5 + 3] === 0, `leaf ${i} scale ${out[i * 5 + 3]}`);
    for (let k = 0; k < 5; k++) {
      assert(Number.isFinite(out[i * 5 + k]), `leaf ${i} value ${k} is ${out[i * 5 + k]}`);
    }
  }
});

test('a null or non-object entry is packed with scale 0', () => {
  const out = new Float32Array(10);
  packLeaves([null, 'x'], out);
  assert(out[3] === 0 && out[8] === 0, `got ${Array.from(out)}`);
});

test('more leaves than the array holds are cut at its capacity', () => {
  const out = new Float32Array(10);   // room for 2 leaves
  const leaves = [leaf(1, 1, 0, 1), leaf(2, 2, 0, 1), leaf(3, 3, 0, 1)];
  assert(packLeaves(leaves, out) === 2, 'count');
  assert(out[5] === 2, 'second leaf missing');
});

test('an array with a partial slot (length not a multiple of 5) never overflows', () => {
  const out = new Float32Array(8);   // room for 1 whole leaf
  assert(packLeaves([leaf(1, 1, 0, 1), leaf(2, 2, 0, 1)], out) === 1, 'count');
  assert(out[5] === 0 && out[7] === 0, 'wrote into the partial slot');
});

test('packs 10,000 leaves', () => {
  const leaves = [];
  for (let i = 0; i < 10000; i++) leaves.push(leaf(i, -i, 0, 1, 0.5));
  const out = new Float32Array(50000);
  assert(packLeaves(leaves, out) === 10000, 'count');
  assert(out[5 * 9999] === 9999 && out[5 * 9999 + 1] === -9999 && out[5 * 9999 + 4] === 0.5, 'last leaf wrong');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
