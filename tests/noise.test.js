// Step 6 Perlin noise tests. Run with:  node tests/noise.test.js

import { test, assert, assertClose, report } from './harness.js';
import { createNoise } from '../src/noise.js';

test('the same seed gives the same values', () => {
  const a = createNoise(7);
  const b = createNoise(7);
  for (let i = 0; i < 200; i++) {
    const x = i * 0.37, y = i * 0.11 - 3, z = i * 0.05;
    assert(a(x, y, z) === b(x, y, z), `differs at (${x}, ${y}, ${z})`);
  }
});

test('different seeds give different values', () => {
  const a = createNoise(1);
  const b = createNoise(2);
  let differ = 0;
  for (let i = 0; i < 100; i++) if (a(i * 0.37, i * 0.21, 0.5) !== b(i * 0.37, i * 0.21, 0.5)) differ++;
  assert(differ > 90, `only ${differ} of 100 values differ`);
});

test('values stay in [-1, 1] over 100,000 samples', () => {
  const noise = createNoise(3);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 100000; i++) {
    const v = noise(i * 0.0731, i * 0.0137 - 50, i * 0.0019);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert(min >= -1 && max <= 1, `range ${min} to ${max}`);
  assert(max - min > 1, `range too small: ${min} to ${max}`);
});

test('the average is close to 0', () => {
  const noise = createNoise(4);
  let sum = 0;
  const n = 100000;
  for (let i = 0; i < n; i++) sum += noise(i * 0.0731, i * 0.0137, i * 0.0011);
  assert(Math.abs(sum / n) < 0.05, `mean ${sum / n}`);
});

test('it is 0 at whole-number grid points (a Perlin property)', () => {
  const noise = createNoise(5);
  for (const [x, y, z] of [[0, 0, 0], [1, 2, 3], [-4, 7, 0], [100, -100, 12]]) {
    assertClose(noise(x, y, z), 0, 1e-12, `(${x}, ${y}, ${z})`);
  }
});

test('it is smooth: a tiny move gives a tiny change', () => {
  const noise = createNoise(6);
  for (let i = 0; i < 1000; i++) {
    const x = i * 0.173, y = i * 0.071, z = i * 0.013;
    const change = Math.abs(noise(x + 1e-4, y, z) - noise(x, y, z));
    assert(change < 1e-3, `jump of ${change} at (${x}, ${y}, ${z})`);
  }
});

test('it is not constant', () => {
  const noise = createNoise(8);
  const values = new Set();
  for (let i = 0; i < 100; i++) values.add(noise(i * 0.31 + 0.5, i * 0.17 + 0.5, 0.5));
  assert(values.size > 90, `only ${values.size} different values`);
});

test('NaN or Infinity input gives 0', () => {
  const noise = createNoise(9);
  for (const [x, y, z] of [[NaN, 0, 0], [0, Infinity, 0], [0, 0, -Infinity], [undefined, 1, 1]]) {
    assert(noise(x, y, z) === 0, `(${x}, ${y}, ${z}) gave ${noise(x, y, z)}`);
  }
});

test('huge and negative coordinates still give finite values in range', () => {
  const noise = createNoise(10);
  for (const [x, y, z] of [[1e9 + 0.5, -1e9 + 0.25, 3.7], [-12345.6, -0.5, -99.9], [1e20, 1e20, 1e20]]) {
    const v = noise(x, y, z);
    assert(Number.isFinite(v) && v >= -1 && v <= 1, `(${x}, ${y}, ${z}) gave ${v}`);
  }
});

test('a bad seed acts like seed 0', () => {
  const zero = createNoise(0);
  for (const seed of [NaN, undefined, 'abc']) {
    assert(createNoise(seed)(1.5, 2.5, 0.5) === zero(1.5, 2.5, 0.5), `seed ${seed}`);
  }
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
