// Step 10a tests: the leaf shape (Bézier curves turned into a triangle strip).
// Run with:  node tests/leafmesh.test.js   (src/leafmesh.js is pure: no WebGL is needed)

import { test, assert, assertClose, report } from './harness.js';
import { bezier, buildLeafMesh, buildRectMesh, FLOATS_PER_VERTEX } from '../src/leafmesh.js';
import { LEAF_WIDTH, LEAF_HEIGHT, LEAF_RADIUS, LEAF_SEGMENTS } from '../src/config.js';

const TOL = 1e-9;

// Vertex k of a mesh as { x, y, along }.
function vertex(mesh, k) {
  const o = k * FLOATS_PER_VERTEX;
  const v = mesh.vertices;
  return { x: v[o], y: v[o + 1], along: v[o + 2] };
}

// Signed area of the triangle (a, b, c): positive when the corners go counterclockwise.
function signedArea(a, b, c) {
  return 0.5 * ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
}

// The triangles of a strip: triangle i uses vertices i, i+1, i+2. Every second triangle has its
// corners in the opposite order, so its sign is flipped back to compare windings.
function stripTriangles(mesh) {
  const out = [];
  for (let i = 0; i + 2 < mesh.count; i++) {
    const s = signedArea(vertex(mesh, i), vertex(mesh, i + 1), vertex(mesh, i + 2));
    out.push(i % 2 === 0 ? s : -s);
  }
  return out;
}

// ---------- Config ----------

test('leaf size is 32 x 19, collision radius 16 (half the length), 12 segments per edge', () => {
  assert(LEAF_WIDTH === 32 && LEAF_HEIGHT === 19, `${LEAF_WIDTH} x ${LEAF_HEIGHT}`);
  assert(LEAF_RADIUS === LEAF_WIDTH / 2, `LEAF_RADIUS ${LEAF_RADIUS}`);
  assert(LEAF_SEGMENTS === 12, `LEAF_SEGMENTS ${LEAF_SEGMENTS}`);
  assert(FLOATS_PER_VERTEX === 3, `FLOATS_PER_VERTEX ${FLOATS_PER_VERTEX}`);
});

// ---------- The Bézier formula ----------

const P0 = [0, 0], P1 = [1, 2], P2 = [3, 2], P3 = [4, 0];

test('bezier starts at P0 and ends at P3', () => {
  const a = bezier(P0, P1, P2, P3, 0);
  const b = bezier(P0, P1, P2, P3, 1);
  assert(a[0] === 0 && a[1] === 0, `t = 0 gave (${a})`);
  assert(b[0] === 4 && b[1] === 0, `t = 1 gave (${b})`);
});

test('bezier at t = 0.5 is (P0 + 3 P1 + 3 P2 + P3) / 8', () => {
  const m = bezier(P0, P1, P2, P3, 0.5);
  assertClose(m[0], (0 + 3 + 9 + 4) / 8, TOL, 'x');
  assertClose(m[1], (0 + 6 + 6 + 0) / 8, TOL, 'y');
});

test('bezier keeps t inside [0, 1] and treats a bad t as 0', () => {
  const below = bezier(P0, P1, P2, P3, -1);
  const above = bezier(P0, P1, P2, P3, 2);
  const bad = bezier(P0, P1, P2, P3, NaN);
  assert(below[0] === 0 && above[0] === 4 && bad[0] === 0, `got ${below}, ${above}, ${bad}`);
});

// ---------- The leaf mesh ----------

const mesh = buildLeafMesh();

test('mesh has 1 stem-end point, 2 per sample along the blade, and 1 tip: 26 for 12 segments', () => {
  assert(mesh.count === 1 + 2 * LEAF_SEGMENTS + 1, `count ${mesh.count}`);
  assert(mesh.vertices.length === mesh.count * FLOATS_PER_VERTEX, `length ${mesh.vertices.length}`);
  assert(mesh.vertices instanceof Float32Array, 'not a Float32Array');
});

test('every value is a finite number', () => {
  assert(Array.from(mesh.vertices).every(Number.isFinite), 'NaN or Infinity in the mesh');
});

test('the leaf fits its box: length 32 (stem end to tip), width 19 at the widest point', () => {
  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (let k = 0; k < mesh.count; k++) {
    const v = vertex(mesh, k);
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, Math.abs(v.y));
  }
  assertClose(minX, -LEAF_WIDTH / 2, 1e-5, 'stem end x');
  assertClose(maxX, LEAF_WIDTH / 2, 1e-5, 'tip x');
  assertClose(maxY, LEAF_HEIGHT / 2, 1e-4, 'half width');
});

test('no vertex is farther from the center than LEAF_RADIUS, and the tip is right at it', () => {
  let far = 0;
  for (let k = 0; k < mesh.count; k++) {
    const v = vertex(mesh, k);
    far = Math.max(far, Math.hypot(v.x, v.y));
  }
  assert(far <= LEAF_RADIUS + 1e-5, `farthest vertex ${far}`);
  assertClose(far, LEAF_RADIUS, 1e-5, 'farthest vertex');
});

test('between the stem end and the tip, the strip is pairs of mirrored edge points: same x, upper y then the opposite y', () => {
  for (let k = 1; k + 1 < mesh.count - 1; k += 2) {
    const up = vertex(mesh, k);
    const down = vertex(mesh, k + 1);
    assert(up.x === down.x && up.y === -down.y, `pair at ${k}: (${up.x}, ${up.y}) and (${down.x}, ${down.y})`);
    assert(up.y > 0, `pair at ${k}: upper point y ${up.y}`);
  }
});

test('the last vertex is the tip: (16, 0), along 1; the first is the stem end: (-16, 0), along 0', () => {
  const tip = vertex(mesh, mesh.count - 1);
  assertClose(tip.x, LEAF_WIDTH / 2, 1e-5, 'tip x');
  assert(tip.y === 0, `tip y ${tip.y}`);
  assertClose(tip.along, 1, 1e-6, 'tip along');
  const stem = vertex(mesh, 0);
  assertClose(stem.x, -LEAF_WIDTH / 2, 1e-5, 'stem x');
  assert(stem.y === 0, `stem y ${stem.y}`);
  assertClose(stem.along, 0, 1e-6, 'stem along');
});

test('along runs from 0 at the stem end to 1 at the tip: along = x / length + 0.5', () => {
  for (let k = 0; k < mesh.count; k++) {
    const v = vertex(mesh, k);
    assertClose(v.along, v.x / LEAF_WIDTH + 0.5, 1e-6, `vertex ${k}`);
  }
});

test('x never goes backward along the strip (each vertex is at or past the one two before it)', () => {
  for (let k = 2; k < mesh.count; k++) {
    assert(vertex(mesh, k).x >= vertex(mesh, k - 2).x, `vertex ${k} is behind vertex ${k - 2}`);
  }
});

test('the stem is thin: where it meets the blade it is much narrower than the blade', () => {
  const stem = Math.abs(vertex(mesh, 1).y);
  assert(stem > 0 && stem < LEAF_HEIGHT * 0.1, `stem half width ${stem}`);
});

test('every triangle has the same winding and a real area (none flipped or flat)', () => {
  const tris = stripTriangles(mesh);
  assert(tris.length === mesh.count - 2, `${tris.length} triangles`);
  const sign = Math.sign(tris[0]);
  tris.forEach((a, i) => {
    assert(Math.sign(a) === sign, `triangle ${i} is flipped`);
    assert(Math.abs(a) > 1e-3, `triangle ${i} has area ${a}`);
  });
});

test('the leaf covers 50% to 75% of its box (a leaf, not a rectangle or a needle)', () => {
  const area = stripTriangles(mesh).reduce((sum, a) => sum + Math.abs(a), 0);
  const fraction = area / (LEAF_WIDTH * LEAF_HEIGHT);
  assert(fraction >= 0.5 && fraction <= 0.75, `covers ${(100 * fraction).toFixed(1)}%`);
});

test('it is leaf-shaped: widest between 30% and 60% of the way from the stem end, narrowing to the tip', () => {
  let widest = 0, widestAlong = 0;
  for (let k = 1; k + 1 < mesh.count - 1; k += 2) {
    const v = vertex(mesh, k);
    if (v.y > widest) { widest = v.y; widestAlong = v.along; }
  }
  assert(widestAlong >= 0.3 && widestAlong <= 0.6, `widest at along ${widestAlong.toFixed(2)}`);
  // After the widest point, the edge only gets narrower.
  for (let k = 3; k + 1 < mesh.count - 1; k += 2) {
    const v = vertex(mesh, k);
    if (v.along > widestAlong) {
      assert(v.y <= vertex(mesh, k - 2).y + 1e-9, `widens again at along ${v.along.toFixed(2)}`);
    }
  }
});

test('more segments give nearly the same shape (area within 2%)', () => {
  const fine = buildLeafMesh(LEAF_WIDTH, LEAF_HEIGHT, 48);
  assert(fine.count === 1 + 2 * 48 + 1, `count ${fine.count}`);
  const a = stripTriangles(mesh).reduce((s, x) => s + Math.abs(x), 0);
  const b = stripTriangles(fine).reduce((s, x) => s + Math.abs(x), 0);
  assert(Math.abs(a - b) / b < 0.02, `12 segments: ${a.toFixed(1)}, 48 segments: ${b.toFixed(1)}`);
});

test('length and width scale the mesh', () => {
  const big = buildLeafMesh(64, 38);
  for (let k = 0; k < mesh.count; k++) {
    assertClose(vertex(big, k).x, 2 * vertex(mesh, k).x, 1e-4, `x ${k}`);
    assertClose(vertex(big, k).y, 2 * vertex(mesh, k).y, 1e-4, `y ${k}`);
  }
});

test('bad length, width, or segments fall back to the defaults', () => {
  const bad = buildLeafMesh(NaN, -5, 'many');
  assert(bad.count === mesh.count, `count ${bad.count}`);
  assert(Array.from(bad.vertices).every((v, i) => v === mesh.vertices[i]), 'different from the default mesh');
  assert(buildLeafMesh(LEAF_WIDTH, LEAF_HEIGHT, 1).count === mesh.count, 'segments 1 was used');
  assert(buildLeafMesh(LEAF_WIDTH, LEAF_HEIGHT, 6.7).count === 1 + 2 * 6 + 1, 'segments 6.7 not rounded down');
  assert(buildLeafMesh(LEAF_WIDTH, LEAF_HEIGHT, 10000).count === 1 + 2 * 64 + 1, 'segments not capped at 64');
});

// ---------- The gray-box rectangle (G key) ----------

test('the gray-box mesh is the 32 x 19 rectangle as a 4-corner strip', () => {
  const rect = buildRectMesh();
  assert(rect.count === 4 && rect.vertices.length === 4 * FLOATS_PER_VERTEX, `count ${rect.count}`);
  const xs = [], ys = [];
  for (let k = 0; k < 4; k++) { xs.push(vertex(rect, k).x); ys.push(vertex(rect, k).y); }
  assert(Math.min(...xs) === -16 && Math.max(...xs) === 16, `x from ${Math.min(...xs)} to ${Math.max(...xs)}`);
  assert(Math.min(...ys) === -9.5 && Math.max(...ys) === 9.5, `y from ${Math.min(...ys)} to ${Math.max(...ys)}`);
  const area = stripTriangles(rect).reduce((s, x) => s + Math.abs(x), 0);
  assertClose(area, LEAF_WIDTH * LEAF_HEIGHT, 1e-6, 'area');
});

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
