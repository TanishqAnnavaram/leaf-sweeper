// The leaf shape (step 10a). Pure math, no WebGL, so it can be tested in Node.
//
// The outline is two cubic Bézier curves, the upper and lower edge of the blade, mirrored across the
// midrib (the center line). A short thin stem sticks out behind the blade. To draw it, each edge is
// sampled at a few points, and the points are joined into one triangle strip:
//
//   stem end    blade samples, base to tip                 tip
//            U0 ---- U1 ---- U2 ---- ...  U(n-1)
//       S <   |  \    |  \    |             |   \
//            L0 ---- L1 ---- L2 ---- ...  L(n-1) --- T
//
// The strip goes S, U0, L0, U1, L1, ..., T: each new vertex makes a triangle with the two before it.
// The stem is the thin triangle from the stem end S to the blade base (U0, L0), so it tapers to a point.
// (A square stem end would stick out past the collision radius: its corner is farther than half the length.)
// This works because each edge is a single curve from base to tip, so above any point on the midrib
// there is exactly one upper and one lower edge point.

import { LEAF_WIDTH, LEAF_HEIGHT, LEAF_SEGMENTS } from './config.js';

// Each vertex has 3 numbers:
//   x, y    position in world units at scale 1, with the leaf's center at (0, 0), pointing along +x
//   along   0 at the stem end, 1 at the tip (= x / length + 0.5), for the veins and the stem color
// (A 4th number, +1 on the upper edge and -1 on the lower, was tried for the midrib and dropped: blended
// across the strip's triangles, its zero line zigzags wherever the width changes. The shader now uses
// |y| divided by the half-width instead, which is exact.)
export const FLOATS_PER_VERTEX = 3;

// The shape, in fractions of the length (x, from -0.5 at the stem end to 0.5 at the tip) and of the
// width (y). Changing these numbers changes every leaf.
const BLADE_BASE = -0.34;   // where the stem meets the blade: the stem is 16% of the length
const STEM_HALF = 0.045;    // half the stem's thickness where it meets the blade: 0.86 world units at width 19
// Control points of the upper edge. P0 is where the blade starts (just wider than the stem), P3 is the tip.
// P1 pulls the edge sharply outward near the base (a rounded base), P2 pulls it in toward a pointed tip.
const UPPER_EDGE = [
  [BLADE_BASE, STEM_HALF],
  [-0.30, 0.78],
  [0.22, 0.52],
  [0.5, 0],
];
const MAX_SEGMENTS = 64;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// A point on the cubic Bézier curve with control points p0, p1, p2, p3 (each [x, y]), at t from 0 to 1:
//   B(t) = (1-t)^3 p0 + 3 (1-t)^2 t p1 + 3 (1-t) t^2 p2 + t^3 p3
// The curve starts at p0 (t = 0) heading toward p1, and ends at p3 (t = 1) arriving from p2.
// The four weights always add up to 1, so the curve stays inside the shape the control points make.
export function bezier(p0, p1, p2, p3, t) {
  const s = isNumber(t) ? Math.min(1, Math.max(0, t)) : 0;
  const u = 1 - s;
  const w0 = u * u * u;
  const w1 = 3 * u * u * s;
  const w2 = 3 * u * s * s;
  const w3 = s * s * s;
  return [
    w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
  ];
}

// Build the leaf's triangle strip: { vertices: Float32Array, count } with FLOATS_PER_VERTEX numbers
// per vertex. length and width are in world units; segments is how many points each edge is sampled at.
// Bad values fall back to the defaults from config.js. The vertex count is 1 + 2 * segments + 1.
export function buildLeafMesh(length = LEAF_WIDTH, width = LEAF_HEIGHT, segments = LEAF_SEGMENTS) {
  const L = isNumber(length) && length > 0 ? length : LEAF_WIDTH;
  const W = isNumber(width) && width > 0 ? width : LEAF_HEIGHT;
  const n = isNumber(segments) && segments >= 2 ? Math.min(MAX_SEGMENTS, Math.floor(segments)) : LEAF_SEGMENTS;

  // Sample the upper edge at t = 0, 1/n, ..., (n-1)/n. The tip (t = 1) is added once, at the end.
  const samples = [];
  for (let k = 0; k < n; k++) {
    samples.push(bezier(UPPER_EDGE[0], UPPER_EDGE[1], UPPER_EDGE[2], UPPER_EDGE[3], k / n));
  }
  // The control points only roughly set the width, so scale the blade's y values to make its widest
  // sample exactly half the width. Then the leaf fills its box exactly: no guessing.
  const widest = Math.max(...samples.map((p) => p[1]));
  const yScale = widest > 0 ? 0.5 / widest : 1;

  const count = 1 + 2 * n + 1;
  const vertices = new Float32Array(count * FLOATS_PER_VERTEX);
  let o = 0;
  function put(fx, fy) {
    vertices[o++] = fx * L;
    vertices[o++] = fy * W;
    vertices[o++] = fx + 0.5;   // along: 0 at the stem end (fx = -0.5), 1 at the tip (fx = 0.5)
  }
  put(-0.5, 0);                 // the stem end, one point on the center line
  for (const [fx, fy] of samples) {
    put(fx, fy * yScale);       // upper edge
    put(fx, -fy * yScale);      // lower edge, the mirror image
  }
  put(0.5, 0);                  // the tip
  return { vertices, count };
}

// The gray-box leaf (G key): a plain length x width rectangle as a 4-corner triangle strip,
// in the same vertex format as the leaf mesh.
export function buildRectMesh(length = LEAF_WIDTH, width = LEAF_HEIGHT) {
  const L = isNumber(length) && length > 0 ? length : LEAF_WIDTH;
  const W = isNumber(width) && width > 0 ? width : LEAF_HEIGHT;
  const hx = L / 2;
  const hy = W / 2;
  const vertices = new Float32Array([
    -hx, -hy, 0,   // bottom left
     hx, -hy, 1,   // bottom right
    -hx,  hy, 0,   // top left
     hx,  hy, 1,   // top right
  ]);
  return { vertices, count: 4 };
}
