// Our own 2D matrix math. No WebGL in this file, so it can be tested alone (tests/math.test.js).
//
// A 2D transform is stored as a 3x3 matrix in a plain array of 9 numbers.
// The order is "column-major", which is what WebGL expects: the first 3 numbers are the
// first column, the next 3 the second column, the last 3 the third column.
//
//   | m[0]  m[3]  m[6] |        | a  c  tx |
//   | m[1]  m[4]  m[7] |   =    | b  d  ty |
//   | m[2]  m[5]  m[8] |        | 0  0  1  |
//
// The third column (tx, ty) is the translation. That is why 2D needs a 3x3 matrix:
// a 2x2 matrix can rotate and scale, but it cannot move a point.

export function identity() {
  return [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ];
}

// Move by (tx, ty).
export function translation(tx, ty) {
  return [
    1, 0, 0,
    0, 1, 0,
    tx, ty, 1,
  ];
}

// Rotate by an angle in radians. Positive angles turn counterclockwise (because y is up).
//   x' = x*cos - y*sin
//   y' = x*sin + y*cos
export function rotation(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    c, s, 0,
    -s, c, 0,
    0, 0, 1,
  ];
}

// Stretch by sx along x and sy along y.
export function scaling(sx, sy) {
  return [
    sx, 0, 0,
    0, sy, 0,
    0, 0, 1,
  ];
}

// Matrix product a * b. The result applies b first, then a.
// Entry (row r, column c) of the result = row r of a  dot  column c of b.
export function multiply(a, b) {
  const out = new Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] =
        a[0 * 3 + r] * b[c * 3 + 0] +
        a[1 * 3 + r] * b[c * 3 + 1] +
        a[2 * 3 + r] * b[c * 3 + 2];
    }
  }
  return out;
}

// Apply a matrix to the point (x, y). Returns [x', y'].
export function transformPoint(m, x, y) {
  return [
    m[0] * x + m[3] * y + m[6],
    m[1] * x + m[4] * y + m[7],
  ];
}

// How many pixels one world unit covers, using the "contain" rule:
// the whole world must fit inside the view, so we take the smaller of the two ratios.
// Returns 0 for any size that is zero, negative or not a number, so callers never divide by zero.
export function fitScale(worldWidth, worldHeight, viewWidth, viewHeight) {
  const sizes = [worldWidth, worldHeight, viewWidth, viewHeight];
  for (const size of sizes) {
    if (!Number.isFinite(size) || size <= 0) {
      return 0;
    }
  }
  return Math.min(viewWidth / worldWidth, viewHeight / worldHeight);
}

// World units -> clip space (-1 to 1 on both axes), for the vertex shader.
// A world point x is  x * s  pixels from the canvas center. Half the canvas is 1 clip unit,
// so  xClip = x * s / (canvasWidth / 2) = x * 2s / canvasWidth.  Same for y.
// The world origin is the canvas center and y is up in both spaces, so no move or flip is needed.
export function projection(worldWidth, worldHeight, canvasWidth, canvasHeight) {
  const s = fitScale(worldWidth, worldHeight, canvasWidth, canvasHeight);
  if (s === 0) {
    return scaling(0, 0);   // nothing visible, but every number stays finite
  }
  return scaling((2 * s) / canvasWidth, (2 * s) / canvasHeight);
}

// The rectangle of the canvas that the world covers, in pixels. Everything outside it is a bar.
// Because the world is centered, the bars on opposite sides are equal.
export function worldRect(worldWidth, worldHeight, canvasWidth, canvasHeight) {
  const s = fitScale(worldWidth, worldHeight, canvasWidth, canvasHeight);
  const width = worldWidth * s;
  const height = worldHeight * s;
  if (s === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

// World position -> screen position in CSS pixels (origin top-left, y down), as the browser measures.
export function worldToScreen(x, y, worldWidth, worldHeight, viewWidth, viewHeight) {
  const s = fitScale(worldWidth, worldHeight, viewWidth, viewHeight);
  if (s === 0) {
    return [0, 0];
  }
  return [
    viewWidth / 2 + x * s,
    viewHeight / 2 - y * s,    // minus: screen y grows down, world y grows up
  ];
}

// Screen position in CSS pixels (for example a mouse event) -> world position.
// This is worldToScreen solved for x and y.
export function screenToWorld(screenX, screenY, worldWidth, worldHeight, viewWidth, viewHeight) {
  const s = fitScale(worldWidth, worldHeight, viewWidth, viewHeight);
  if (s === 0) {
    return [0, 0];
  }
  return [
    (screenX - viewWidth / 2) / s,
    (viewHeight / 2 - screenY) / s,
  ];
}

// The transform for one leaf: scale it, then rotate it, then move it to (x, y).
// The vertex shader in shaders.js does the same three steps on the GPU.
// This copy exists so the tests can check the math without a GPU.
export function leafMatrix(x, y, angle, scale) {
  return multiply(translation(x, y), multiply(rotation(angle), scaling(scale, scale)));
}
