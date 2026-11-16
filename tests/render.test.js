// Step 2 rendering tests. These need a real browser with WebGL2, so they only run from tests/index.html.
// Each test draws into a hidden-size canvas, then reads pixels back and checks their color.

import { test, assert } from './harness.js';
import { createRenderer } from '../src/renderer.js';
import { projection, transformPoint } from '../src/math.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../src/config.js';

const ORANGE = [217, 102, 26];   // leaf color (0.85, 0.40, 0.10) as 0-255 values
const GROUND = [28, 20, 15];     // ground color (0.11, 0.08, 0.06)
const BAR = [13, 9, 8];          // bar color (0.05, 0.035, 0.03)

// Make a canvas of a given CSS size and add it to the page so it has a real layout size.
function makeCanvas(cssWidth, cssHeight) {
  const canvas = document.createElement('canvas');
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.style.display = 'block';
  document.querySelector('#canvases').appendChild(canvas);
  return canvas;
}

// Read the color of the pixel that shows a given world position.
function pixelAtWorld(renderer, canvas, worldX, worldY) {
  const gl = renderer.gl;
  const p = projection(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height);
  const [clipX, clipY] = transformPoint(p, worldX, worldY);
  // clip space (-1..1) -> pixel index. readPixels counts y from the bottom, the same way clip space does.
  const px = Math.min(canvas.width - 1, Math.floor((clipX * 0.5 + 0.5) * canvas.width));
  const py = Math.min(canvas.height - 1, Math.floor((clipY * 0.5 + 0.5) * canvas.height));
  const out = new Uint8Array(4);
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0], out[1], out[2]];
}

function assertColor(actual, expected, label) {
  const ok = actual.every((v, i) => Math.abs(v - expected[i]) <= 3);
  assert(ok, `${label}: expected about (${expected}), got (${actual})`);
}

// Draw with the given leaf values and return a helper that samples pixels.
function draw(cssWidth, cssHeight, leaf) {
  const canvas = makeCanvas(cssWidth, cssHeight);
  const renderer = createRenderer(canvas);
  renderer.setLeaf(leaf);
  renderer.render();
  return {
    renderer,
    canvas,
    at: (x, y) => pixelAtWorld(renderer, canvas, x, y),
  };
}

test('render: leaf at (0, 0) paints the center orange', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  assertColor(d.at(0, 0), ORANGE, 'center');
});

test('render: the leaf is 40 x 24 world units', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  assertColor(d.at(17, 0), ORANGE, 'inside right edge');
  assertColor(d.at(-17, 0), ORANGE, 'inside left edge');
  assertColor(d.at(24, 0), GROUND, 'outside right edge');
  assertColor(d.at(0, 9), ORANGE, 'inside top edge');
  assertColor(d.at(0, 16), GROUND, 'outside top edge');
});

test('render: leaf moved to (400, 0) appears there and not at the center', () => {
  const d = draw(800, 450, { x: 400, y: 0, angle: 0, scale: 1 });
  assertColor(d.at(400, 0), ORANGE, 'new position');
  assertColor(d.at(0, 0), GROUND, 'old position');
});

test('render: positive y moves the leaf up the screen', () => {
  const d = draw(800, 450, { x: 0, y: 300, angle: 0, scale: 1 });
  assertColor(d.at(0, 300), ORANGE, 'new position');
  // Check directly in pixels too: world y = 300 must be in the top half of the canvas.
  const gl = d.renderer.gl;
  const out = new Uint8Array(4);
  const topRow = Math.floor(d.canvas.height * (0.5 + 300 / 900));   // counted from the bottom
  gl.readPixels(Math.floor(d.canvas.width / 2), topRow, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  assertColor([out[0], out[1], out[2]], ORANGE, 'top half pixel');
});

test('render: leaf rotated 90 degrees has its long side vertical', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: Math.PI / 2, scale: 1 });
  assertColor(d.at(0, 17), ORANGE, 'along the long side, now vertical');
  assertColor(d.at(17, 0), GROUND, 'where the long side used to be');
});

test('render: leaf rotated 45 degrees counterclockwise', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: Math.PI / 4, scale: 1 });
  assertColor(d.at(12, 12), ORANGE, 'up-right diagonal (the long side)');
  assertColor(d.at(-12, 12), GROUND, 'up-left diagonal');
});

test('render: scale 2 doubles the leaf', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 2 });
  assertColor(d.at(35, 0), ORANGE, 'inside the doubled leaf');
  assertColor(d.at(45, 0), GROUND, 'outside the doubled leaf');
});

test('render: scale 0 draws nothing', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 0 });
  assertColor(d.at(0, 0), GROUND, 'center');
});

test('render: setLeaf can change one value and keep the others', () => {
  const d = draw(800, 450, { x: 200, y: 100, angle: 0, scale: 1 });
  d.renderer.setLeaf({ x: -200 });
  d.renderer.render();
  assertColor(d.at(-200, 100), ORANGE, 'x changed, y kept');
  assertColor(d.at(200, 100), GROUND, 'old position');
});

test('render: setLeaf ignores NaN, Infinity and non-numbers', () => {
  const d = draw(800, 450, { x: 100, y: 0, angle: 0, scale: 1 });
  d.renderer.setLeaf({ x: NaN, y: Infinity, angle: 'abc', scale: undefined });
  d.renderer.setLeaf(null);
  d.renderer.render();
  assertColor(d.at(100, 0), ORANGE, 'leaf did not move');
  const leaf = d.renderer.getLeaf();
  assert(leaf.x === 100 && leaf.y === 0 && leaf.angle === 0 && leaf.scale === 1,
    'stored values changed: ' + JSON.stringify(leaf));
});

test('render: wide window has bars at the sides, ground in the middle', () => {
  const d = draw(1000, 300, { x: 0, y: 0, angle: 0, scale: 1 });
  // World is 533 px wide inside a 1000 px canvas. World x = -1500 is in the left bar.
  assertColor(d.at(-1500, 0), BAR, 'left bar');
  assertColor(d.at(1500, 0), BAR, 'right bar');
  assertColor(d.at(-700, 0), GROUND, 'ground inside the world');
  assertColor(d.at(0, 0), ORANGE, 'leaf');
});

test('render: tall window has bars at the top and bottom', () => {
  const d = draw(400, 600, { x: 0, y: 0, angle: 0, scale: 1 });
  assertColor(d.at(0, 1000), BAR, 'top bar');
  assertColor(d.at(0, -1000), BAR, 'bottom bar');
  assertColor(d.at(0, 400), GROUND, 'ground inside the world');
  assertColor(d.at(0, 0), ORANGE, 'leaf');
});

test('render: canvas pixel size follows the device pixel ratio', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  assert(d.canvas.width === Math.round(800 * dpr), `canvas width ${d.canvas.width}, dpr ${dpr}`);
  assert(d.canvas.height === Math.round(450 * dpr), `canvas height ${d.canvas.height}, dpr ${dpr}`);
});

test('render: no WebGL errors after drawing', () => {
  const d = draw(800, 450, { x: 10, y: 20, angle: 1, scale: 1.5 });
  const gl = d.renderer.gl;
  assert(gl.getError() === gl.NO_ERROR, 'gl.getError() reported a problem');
});
