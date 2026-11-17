// A tiny test helper written by us, so the tests need no library.
// It works both in Node (node tests/math.test.js) and in the browser (tests/index.html).

const results = [];

// Run one test. A test passes if its function finishes without throwing.
export function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true, message: '' });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'assertion failed');
  }
}

// Two numbers are "close" if they differ by no more than the tolerance.
// Needed because floating point math is not exact (0.1 + 0.2 is not exactly 0.3).
export function assertClose(actual, expected, tolerance = 1e-9, label = 'value') {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

// Compare two lists of numbers (points, matrices, colors) item by item.
export function assertAllClose(actual, expected, tolerance = 1e-9, label = 'list') {
  assert(actual.length === expected.length,
    `${label}: expected ${expected.length} numbers, got ${actual.length}`);
  for (let i = 0; i < expected.length; i++) {
    assertClose(actual[i], expected[i], tolerance, `${label}[${i}]`);
  }
}

export function assertAllFinite(values, label = 'list') {
  for (let i = 0; i < values.length; i++) {
    assert(Number.isFinite(values[i]), `${label}[${i}] is not a finite number: ${values[i]}`);
  }
}

export function getResults() {
  return results;
}

// Print every result to the console and return how many tests failed.
export function report() {
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log('PASS  ' + r.name);
    } else {
      failed++;
      console.log('FAIL  ' + r.name + '\n      ' + r.message);
    }
  }
  console.log(`\n${results.length - failed} of ${results.length} tests passed`);
  return failed;
}
