// Step 4 seeded random number tests. Run with:  node tests/random.test.js

import { test, assert, report } from './harness.js';
import { createRandom } from '../src/random.js';

function take(random, n) {
  const values = [];
  for (let i = 0; i < n; i++) values.push(random());
  return values;
}

test('the same seed gives the same sequence', () => {
  const a = take(createRandom(42), 100);
  const b = take(createRandom(42), 100);
  assert(a.every((v, i) => v === b[i]), 'sequences differ');
});

test('different seeds give different sequences', () => {
  const a = take(createRandom(1), 20);
  const b = take(createRandom(2), 20);
  assert(a.some((v, i) => v !== b[i]), 'sequences are the same');
});

test('values are always in [0, 1)', () => {
  for (const v of take(createRandom(7), 100000)) {
    assert(v >= 0 && v < 1, `value ${v} out of range`);
  }
});

test('the values are not all the same', () => {
  const values = take(createRandom(3), 100);
  assert(new Set(values).size > 90, 'too many repeated values');
});

test('the average of 10,000 values is close to 0.5', () => {
  const values = take(createRandom(99), 10000);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  assert(Math.abs(mean - 0.5) < 0.02, `mean ${mean}`);
});

test('seeds of 0, negative, and decimal numbers still give valid values', () => {
  for (const seed of [0, -1, -123456, 1.5, 4294967296 + 5]) {
    for (const v of take(createRandom(seed), 50)) {
      assert(Number.isFinite(v) && v >= 0 && v < 1, `seed ${seed}: value ${v}`);
    }
  }
});

test('a NaN, Infinity, or missing seed acts like seed 0', () => {
  const zero = take(createRandom(0), 10);
  for (const seed of [NaN, Infinity, undefined, 'abc']) {
    const values = take(createRandom(seed), 10);
    assert(values.every((v, i) => v === zero[i]), `seed ${seed} did not act like 0`);
  }
});

test('two generators do not share state', () => {
  const a = createRandom(5);
  const b = createRandom(5);
  a(); a(); a();
  assert(b() === createRandom(5)(), 'using one generator changed the other');
});

// In Node, print the results and set the exit code. In the browser, tests/index.html shows them.
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
