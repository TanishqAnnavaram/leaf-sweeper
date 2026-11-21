// Rendering tests (steps 2 to 10b). These need a real browser with WebGL2, so they only run from tests/index.html.
// Each test draws into a hidden-size canvas, then reads pixels back and checks their color.
// Steps 2 to 9 test the gray-box look (orange rectangles), which the G key still shows, so they use
// createGrayRenderer. The step 10a tests check the new leaf shape and colors, the 10b tests the ground.

import { test, assert } from './harness.js';
import { createRenderer, createProgram, createNoiseTexture } from '../src/renderer.js';
import { perlinGlsl } from '../src/shaders.js';
import { createNoise, noiseTable } from '../src/noise.js';
import { projection, transformPoint } from '../src/math.js';
import { WORLD_WIDTH, WORLD_HEIGHT, MAX_LEAVES, LEAF_WIDTH, LEAF_HEIGHT, GROUND_SEED } from '../src/config.js';
import { buildLeafMesh, FLOATS_PER_VERTEX } from '../src/leafmesh.js';
import { createLeaf, stepLeaf, spawnLeaves, createWind } from '../src/physics.js';
import { createLoop } from '../src/loop.js';

const ORANGE = [217, 102, 26];   // base leaf color (0.85, 0.40, 0.10) as 0-255 values
const GROUND = [28, 20, 15];     // ground color (0.11, 0.08, 0.06)
const BAR = [13, 9, 8];          // bar color (0.05, 0.035, 0.03)

// Make a canvas of a given CSS size and add it to the page so it has a real layout size.
// Browsers keep only about 16 WebGL contexts alive, so first release the canvases of earlier tests.
function makeCanvas(cssWidth, cssHeight) {
  const holder = document.querySelector('#canvases');
  for (const old of holder.querySelectorAll('canvas')) {
    const gl = old.getContext('webgl2');   // returns the context the canvas already has
    const lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();          // frees the GPU memory right away
    old.remove();
  }
  const canvas = document.createElement('canvas');
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.style.display = 'block';
  document.querySelector('#canvases').appendChild(canvas);
  return canvas;
}

// A renderer showing the gray-box look (G key): orange rectangles, as in steps 2 to 9.
function createGrayRenderer(canvas) {
  const renderer = createRenderer(canvas);
  renderer.setGrayBox(true);
  return renderer;
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

// Step 4: each leaf's brightness is the base orange times a shade from 0.85 to 1.15,
// so a leaf pixel is "the base orange, made a bit darker or brighter".
function assertLeafColor(actual, label) {
  const k = actual[0] / ORANGE[0];   // how much brighter or darker than the base this pixel is
  const ok = k >= 0.83 && k <= 1.17
    && Math.abs(actual[1] - ORANGE[1] * k) <= 4
    && Math.abs(actual[2] - ORANGE[2] * k) <= 4;
  assert(ok, `${label}: expected a shade of (${ORANGE}), got (${actual})`);
}

// Draw with the given leaf values and return a helper that samples pixels.
function draw(cssWidth, cssHeight, leaf) {
  const canvas = makeCanvas(cssWidth, cssHeight);
  const renderer = createGrayRenderer(canvas);
  renderer.setLeaves([leaf]);
  renderer.render();
  return {
    renderer,
    canvas,
    at: (x, y) => pixelAtWorld(renderer, canvas, x, y),
  };
}

test('render: leaf at (0, 0) paints the center orange', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  assertLeafColor(d.at(0, 0), 'center');
});

test('render: the gray-box leaf is 32 x 19 world units', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  assertLeafColor(d.at(13, 0), 'inside right edge');
  assertLeafColor(d.at(-13, 0), 'inside left edge');
  assertColor(d.at(20, 0), GROUND, 'outside right edge');
  assertLeafColor(d.at(0, 7), 'inside top edge');
  assertColor(d.at(0, 13), GROUND, 'outside top edge');
});

test('render: leaf moved to (400, 0) appears there and not at the center', () => {
  const d = draw(800, 450, { x: 400, y: 0, angle: 0, scale: 1 });
  assertLeafColor(d.at(400, 0), 'new position');
  assertColor(d.at(0, 0), GROUND, 'old position');
});

test('render: positive y moves the leaf up the screen', () => {
  const d = draw(800, 450, { x: 0, y: 300, angle: 0, scale: 1 });
  assertLeafColor(d.at(0, 300), 'new position');
  // Check directly in pixels too: world y = 300 must be in the top half of the canvas.
  const gl = d.renderer.gl;
  const out = new Uint8Array(4);
  const topRow = Math.floor(d.canvas.height * (0.5 + 300 / 900));   // counted from the bottom
  gl.readPixels(Math.floor(d.canvas.width / 2), topRow, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  assertLeafColor([out[0], out[1], out[2]], 'top half pixel');
});

test('render: leaf rotated 90 degrees has its long side vertical', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: Math.PI / 2, scale: 1 });
  assertLeafColor(d.at(0, 13), 'along the long side, now vertical');
  assertColor(d.at(13, 0), GROUND, 'where the long side used to be');
});

test('render: leaf rotated 45 degrees counterclockwise', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: Math.PI / 4, scale: 1 });
  assertLeafColor(d.at(9, 9), 'up-right diagonal (the long side)');
  assertColor(d.at(-9, 9), GROUND, 'up-left diagonal');
});

test('render: scale 2 doubles the leaf', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 2 });
  assertLeafColor(d.at(28, 0), 'inside the doubled leaf');
  assertColor(d.at(36, 0), GROUND, 'outside the doubled leaf');
});

test('render: scale 0 draws nothing', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 0 });
  assertColor(d.at(0, 0), GROUND, 'center');
});

test('render: setLeaves replaces the previous leaves', () => {
  const d = draw(800, 450, { x: 200, y: 100, angle: 0, scale: 1 });
  d.renderer.setLeaves([{ x: -200, y: 100, angle: 0, scale: 1 }]);
  d.renderer.render();
  assertLeafColor(d.at(-200, 100), 'new leaf');
  assertColor(d.at(200, 100), GROUND, 'old leaf is gone');
});

test('render: a leaf with NaN or Infinity is not drawn, the others still are', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  d.renderer.setLeaves([
    { x: 100, y: 0, angle: 0, scale: NaN },
    { x: -100, y: Infinity, angle: 0, scale: 1 },
    { x: 300, y: 0, angle: 0, scale: 1 },
  ]);
  d.renderer.render();
  assertColor(d.at(100, 0), GROUND, 'NaN scale leaf');
  assertColor(d.at(-100, 0), GROUND, 'Infinity y leaf');
  assertColor(d.at(0, 0), GROUND, 'a bad leaf is not moved to the center either');
  assertLeafColor(d.at(300, 0), 'good leaf');
  assert(d.renderer.gl.getError() === d.renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

test('render: setLeaves with a non-list draws no leaves and does not throw', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  d.renderer.setLeaves(undefined);
  d.renderer.render();
  assertColor(d.at(0, 0), GROUND, 'center');
});

test('render: wide window has bars at the sides, ground in the middle', () => {
  const d = draw(1000, 300, { x: 0, y: 0, angle: 0, scale: 1 });
  // World is 533 px wide inside a 1000 px canvas. World x = -1500 is in the left bar.
  assertColor(d.at(-1500, 0), BAR, 'left bar');
  assertColor(d.at(1500, 0), BAR, 'right bar');
  assertColor(d.at(-700, 0), GROUND, 'ground inside the world');
  assertLeafColor(d.at(0, 0), 'leaf');
});

test('render: tall window has bars at the top and bottom', () => {
  const d = draw(400, 600, { x: 0, y: 0, angle: 0, scale: 1 });
  assertColor(d.at(0, 1000), BAR, 'top bar');
  assertColor(d.at(0, -1000), BAR, 'bottom bar');
  assertColor(d.at(0, 400), GROUND, 'ground inside the world');
  assertLeafColor(d.at(0, 0), 'leaf');
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

// ---------- Step 3: the game loop drives the drawing ----------

test('render: the loop moves the leaf on screen between frames', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const leaf = createLeaf({ x: -200, y: 0, vx: 600, vy: 0, angle: 0, scale: 1 });
  const loop = createLoop({
    update: (dt) => stepLeaf(leaf, dt),
    render() { renderer.setLeaves([leaf]); renderer.render(); },
  });
  const at = (x, y) => pixelAtWorld(renderer, canvas, x, y);

  loop.tick(0);   // first frame: dt 0, leaf drawn at its start
  assertLeafColor(at(-200, 0), 'first frame, leaf at x = -200');
  assertColor(at(-140, 0), GROUND, 'first frame, x = -140 is still empty');

  // Three 30 Hz frames: 3 * (1/30 s) * 600 units/s = 60 units to the right.
  for (let i = 1; i <= 3; i++) loop.tick(i * (1000 / 30));
  assertLeafColor(at(-140, 0), 'after 3 frames, leaf at x = -140');
  assertColor(at(-200, 0), GROUND, 'after 3 frames, old spot is empty');
  assert(renderer.gl.getError() === renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

// ---------- Step 4: instancing ----------

// Count the draw calls a renderer makes, by wrapping the two WebGL draw functions on its context.
function countDraws(gl) {
  const counts = { instanced: 0, plain: 0, lastInstances: null };
  const instanced = gl.drawArraysInstanced.bind(gl);
  const plain = gl.drawArrays.bind(gl);
  gl.drawArraysInstanced = (...args) => {
    counts.instanced++;
    counts.lastInstances = args[3];   // the 4th argument is the number of instances
    return instanced(...args);
  };
  gl.drawArrays = (...args) => {
    counts.plain++;
    return plain(...args);
  };
  return counts;
}

// Read the whole canvas once, then look up pixels from memory (much faster than 1000 readPixels calls).
function readAll(renderer, canvas) {
  const gl = renderer.gl;
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const p = projection(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height);
  return (x, y) => {
    const [clipX, clipY] = transformPoint(p, x, y);
    const px = Math.min(canvas.width - 1, Math.floor((clipX * 0.5 + 0.5) * canvas.width));
    const py = Math.min(canvas.height - 1, Math.floor((clipY * 0.5 + 0.5) * canvas.height));
    const i = (py * canvas.width + px) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
}

test('render: two leaves in one call, empty ground between them', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const counts = countDraws(renderer.gl);
  renderer.setLeaves([
    { x: -300, y: 0, angle: 0, scale: 1 },
    { x: 300, y: 0, angle: 0, scale: 1 },
  ]);
  renderer.render();
  assertLeafColor(pixelAtWorld(renderer, canvas, -300, 0), 'left leaf');
  assertLeafColor(pixelAtWorld(renderer, canvas, 300, 0), 'right leaf');
  assertColor(pixelAtWorld(renderer, canvas, 0, 0), GROUND, 'between them');
  assert(counts.instanced === 1 && counts.plain === 0,
    `draw calls: ${counts.instanced} instanced, ${counts.plain} plain`);
  assert(counts.lastInstances === 2, `instance count ${counts.lastInstances}`);
});

test('render: 1000 leaves, every leaf center is leaf colored, one draw call', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const counts = countDraws(renderer.gl);
  const leaves = spawnLeaves(1000, 11);
  renderer.setLeaves(leaves);
  renderer.render();
  const at = readAll(renderer, canvas);
  for (let i = 0; i < leaves.length; i++) {
    const { x, y } = leaves[i];
    assertLeafColor(at(x, y), `leaf ${i} at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }
  assert(counts.instanced === 1 && counts.plain === 0,
    `draw calls: ${counts.instanced} instanced, ${counts.plain} plain`);
  assert(counts.lastInstances === 1000, `instance count ${counts.lastInstances}`);
  assert(renderer.gl.getError() === renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

test('render: leaves get different shades (from the instance number)', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const leaves = [];
  for (let i = 0; i < 10; i++) leaves.push({ x: -675 + i * 150, y: 0, angle: 0, scale: 1 });
  renderer.setLeaves(leaves);
  renderer.render();
  const at = readAll(renderer, canvas);
  const reds = new Set(leaves.map((leaf) => at(leaf.x, leaf.y)[0]));
  assert(reds.size >= 5, `only ${reds.size} different shades among 10 leaves`);
});

test('render: the same leaf list gives the same shades every frame', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const leaves = spawnLeaves(20, 3);
  const { x, y } = leaves[19];
  renderer.setLeaves(leaves);
  renderer.render();
  const first = pixelAtWorld(renderer, canvas, x, y);
  renderer.render();
  const second = pixelAtWorld(renderer, canvas, x, y);
  assertColor(second, first, 'shade changed between frames');
});

test('render: 0 leaves draws only ground and makes no draw call', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const counts = countDraws(renderer.gl);
  renderer.setLeaves([]);
  renderer.render();
  assertColor(pixelAtWorld(renderer, canvas, 0, 0), GROUND, 'center');
  assert(counts.instanced === 0 && counts.plain === 0, 'a draw call was made');
  assert(renderer.gl.getError() === renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

test('render: more than MAX_LEAVES draws MAX_LEAVES, warns once, no WebGL error', () => {
  const canvas = makeCanvas(400, 225);
  const renderer = createGrayRenderer(canvas);
  const counts = countDraws(renderer.gl);
  const leaves = [];
  for (let i = 0; i < MAX_LEAVES + 50; i++) leaves.push({ x: 0, y: 0, angle: 0, scale: 0.1 });
  const originalWarn = console.warn;
  let warnings = 0;
  console.warn = () => { warnings++; };   // count the warning and keep the test page console clean
  try {
    renderer.setLeaves(leaves);
    renderer.render();
    renderer.setLeaves(leaves);   // a second time must not warn again
  } finally {
    console.warn = originalWarn;
  }
  assert(counts.lastInstances === MAX_LEAVES, `instance count ${counts.lastInstances}`);
  assert(warnings === 1, `warned ${warnings} times`);
  assert(renderer.gl.getError() === renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

// ---------- Step 5: wind ----------

test('render: wind blowing right moves a leaf right on screen', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const leaf = createLeaf({ x: -200, y: 0, vx: 0, vy: 0, angle: 0, scale: 1 });
  const wind = createWind({ bearing: 90, speed: 400, friction: 1.5 });
  const loop = createLoop({
    update: (dt) => stepLeaf(leaf, dt, wind),
    render() { renderer.setLeaves([leaf]); renderer.render(); },
  });
  for (let i = 0; i <= 30; i++) loop.tick(i * (1000 / 30));   // 1 s at 30 Hz
  // From rest, 1 s of wind moves it 400 * (1 - (1 - e^-1.5) / 1.5), about 193 units.
  assert(leaf.x > -200 + 150, `leaf only reached x = ${leaf.x}`);
  assertLeafColor(pixelAtWorld(renderer, canvas, leaf.x, 0), 'leaf at its new position');
  assertColor(pixelAtWorld(renderer, canvas, -200, 0), GROUND, 'old position is empty');
});

// ---------- Step 7: the void and fading ----------

const VOID = { x: 0, y: 0, discRadius: 40, ringRadius: 220 };

function drawWithVoid(leaves, voidSettings = VOID) {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const counts = countDraws(renderer.gl);
  renderer.setVoid(voidSettings);
  renderer.setLeaves(leaves);
  renderer.render();
  return { canvas, renderer, counts, at: (x, y) => pixelAtWorld(renderer, canvas, x, y) };
}

function brightness(c) {
  return c[0] + c[1] + c[2];
}

test('render: the void disc is dark at the center, ground between disc and ring', () => {
  const d = drawWithVoid([]);
  assert(brightness(d.at(0, 0)) < brightness(GROUND) - 20, `center (${d.at(0, 0)}) is not darker than the ground`);
  assert(brightness(d.at(30, 0)) < brightness(GROUND) - 20, `inside the disc (${d.at(30, 0)})`);
  assertColor(d.at(120, 0), GROUND, 'between the disc and the ring');
  assertColor(d.at(400, 0), GROUND, 'outside the ring');
});

test('render: the ring shows at radius 220', () => {
  const d = drawWithVoid([]);
  let brightest = 0;
  for (let r = 214; r <= 226; r += 1) brightest = Math.max(brightest, brightness(d.at(r, 0)));
  assert(brightest > brightness(GROUND) + 15, `ring not visible: brightest ${brightest}`);
});

test('render: leaves draw over the void', () => {
  const d = drawWithVoid([{ x: 0, y: 0, angle: 0, scale: 1, fade: 1 }]);
  assertLeafColor(d.at(0, 0), 'leaf over the void');
});

test('render: void plus leaves is one plain draw call and one instanced call', () => {
  const d = drawWithVoid([{ x: 300, y: 0, angle: 0, scale: 1 }]);
  assert(d.counts.instanced === 1 && d.counts.plain === 1,
    `draw calls: ${d.counts.instanced} instanced, ${d.counts.plain} plain`);
  assert(d.renderer.gl.getError() === d.renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

test('render: setVoid(null) hides the void', () => {
  const d = drawWithVoid([], null);
  assertColor(d.at(0, 0), GROUND, 'center');
  assert(d.counts.plain === 0, 'drew the void anyway');
});

test('render: a leaf at fade 0.5 is halfway between leaf and ground', () => {
  const d = drawWithVoid([{ x: 300, y: 0, angle: 0, scale: 1, fade: 0.5 }], null);
  const c = d.at(300, 0);
  // Blended color = 0.5 * leaf + 0.5 * ground, and the leaf is the base orange times a shade k.
  const k = (2 * c[0] - GROUND[0]) / ORANGE[0];
  const ok = k >= 0.83 && k <= 1.17
    && Math.abs(c[1] - (0.5 * ORANGE[1] * k + 0.5 * GROUND[1])) <= 4
    && Math.abs(c[2] - (0.5 * ORANGE[2] * k + 0.5 * GROUND[2])) <= 4;
  assert(ok, `pixel (${c}) is not halfway between a leaf shade and the ground`);
});

test('render: a leaf at fade 0 is invisible', () => {
  const d = drawWithVoid([{ x: 300, y: 0, angle: 0, scale: 1, fade: 0 }], null);
  assertColor(d.at(300, 0), GROUND, 'faded leaf');
});

test('render: blending never makes the canvas see-through (alpha stays 255)', () => {
  const d = drawWithVoid([{ x: 300, y: 0, angle: 0, scale: 1, fade: 0.5 }]);
  const gl = d.renderer.gl;
  for (const [x, y] of [[300, 0], [0, 0], [220, 0]]) {
    const p = transformPoint(projection(WORLD_WIDTH, WORLD_HEIGHT, d.canvas.width, d.canvas.height), x, y);
    const px = Math.floor((p[0] * 0.5 + 0.5) * d.canvas.width);
    const py = Math.floor((p[1] * 0.5 + 0.5) * d.canvas.height);
    const out = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    assert(out[3] === 255, `alpha ${out[3]} at (${x}, ${y})`);
  }
});

test('render: a bad void setting hides the void instead of failing', () => {
  const d = drawWithVoid([], { x: NaN, y: 0, discRadius: 40, ringRadius: 220 });
  assertColor(d.at(0, 0), GROUND, 'center');
  assert(d.renderer.gl.getError() === d.renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

// ---------- Step 9: obstacles and debug rings ----------

const TEST_OBSTACLES = [
  { x: -300, y: 0, radius: 50, kind: 'rock' },
  { x: 300, y: 0, radius: 50, kind: 'trunk' },
];

function drawObstacles({ leaves = [], obstacles = TEST_OBSTACLES, debug = false } = {}) {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const counts = countDraws(renderer.gl);
  renderer.setObstacles(obstacles);
  renderer.setDebug(debug);
  renderer.setLeaves(leaves);
  renderer.render();
  return { canvas, renderer, counts, at: (x, y) => pixelAtWorld(renderer, canvas, x, y) };
}

test('render: a rock is grey and a trunk is brown at their centers', () => {
  const d = drawObstacles();
  const rock = d.at(-300, 0);
  const trunk = d.at(300, 0);
  const grey = Math.max(...rock) - Math.min(...rock) < 25 && rock[0] > GROUND[0] + 30;
  assert(grey, `rock center (${rock}) is not a grey brighter than the ground`);
  const brown = trunk[0] > trunk[1] && trunk[1] > trunk[2] && trunk[0] > GROUND[0] + 20 && trunk[0] < 160;
  assert(brown, `trunk center (${trunk}) is not brown`);
  assertColor(d.at(0, 0), GROUND, 'ground between them');
  assertColor(d.at(-300, 70), GROUND, 'just outside the rock');
});

test('render: all obstacles are one instanced draw call (plus one for the leaves)', () => {
  const d = drawObstacles({ leaves: [{ x: 0, y: 200, angle: 0, scale: 1 }] });
  assert(d.counts.instanced === 2 && d.counts.plain === 0,
    `draw calls: ${d.counts.instanced} instanced, ${d.counts.plain} plain`);
});

test('render: obstacles are drawn over leaves', () => {
  const d = drawObstacles({ leaves: [{ x: -300, y: 0, angle: 0, scale: 1 }] });
  const c = d.at(-300, 0);
  assert(Math.max(...c) - Math.min(...c) < 25, `center (${c}) shows the leaf, not the rock`);
});

test('render: debug off draws no outlines, debug on adds the rings', () => {
  const leaf = { x: 0, y: 200, angle: 0, scale: 1 };
  const off = drawObstacles({ leaves: [leaf], debug: false });
  const on = drawObstacles({ leaves: [leaf], debug: true });
  assert(off.counts.instanced === 2, `debug off: ${off.counts.instanced} instanced calls`);
  assert(on.counts.instanced === 4, `debug on: ${on.counts.instanced} instanced calls (obstacle and leaf rings)`);
  // A point just outside the rock's edge: ground without debug, ring color with debug.
  const edgeOff = off.at(-300 + 50.5, 0);
  const edgeOn = on.at(-300 + 50.5, 0);
  assert(brightness(edgeOn) > brightness(edgeOff) + 40, `ring not visible at the rock edge: off (${edgeOff}), on (${edgeOn})`);
  // The leaf's collision ring, 16 units from its center (step 10a: half the leaf's length).
  let ring = 0;
  for (let r = 14; r <= 18; r += 0.5) ring = Math.max(ring, brightness(on.at(0, 200 + r)));
  assert(ring > brightness(GROUND) + 40, `leaf ring not visible (brightest ${ring})`);
});

test('render: no obstacles draws none, bad obstacles are skipped', () => {
  const d = drawObstacles({ obstacles: [{ x: NaN, y: 0, radius: 50 }, { x: 0, y: 0, radius: -1 }, null] });
  assert(d.counts.instanced === 0, `drew ${d.counts.instanced} instanced calls`);
  assertColor(d.at(0, 0), GROUND, 'center');
  assert(d.renderer.gl.getError() === d.renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

test('render: obstacles and debug rings make no WebGL errors', () => {
  const d = drawObstacles({ leaves: spawnLeaves(1000, 3), debug: true });
  assert(d.renderer.gl.getError() === d.renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

// ---------- Step 10a: Bézier leaf shape and autumn colors ----------

const MESH = buildLeafMesh();

// Half the leaf's width at distance x along its length (scale 1), read from the mesh's upper edge.
// The upper edge points are the odd vertices before the tip (vertex 0 is the stem end, on the center
// line); between them the edge is a straight line.
function halfWidthAt(x) {
  const pts = [[-LEAF_WIDTH / 2, 0]];   // the stem end
  for (let k = 1; k < MESH.count - 1; k += 2) {
    pts.push([MESH.vertices[k * FLOATS_PER_VERTEX], MESH.vertices[k * FLOATS_PER_VERTEX + 1]]);
  }
  pts.push([LEAF_WIDTH / 2, 0]);   // the tip
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) {
      return x1 > x0 ? y0 + ((x - x0) / (x1 - x0)) * (y1 - y0) : Math.max(y0, y1);
    }
  }
  return 0;
}

// Draw leaves with the new look (the default) on a 1600 x 900 canvas: 1 pixel per world unit.
// Step 10b: the ground is no longer one color, so a first frame with no leaves is read back, and
// d.ground(x, y) gives the empty ground at any point. The draw counts start after that frame.
function drawLeafLook(leaves, { grayBox = false, debug = false } = {}) {
  const canvas = makeCanvas(1600, 900);
  const renderer = createRenderer(canvas);
  if (grayBox) renderer.setGrayBox(true);
  renderer.setDebug(debug);
  renderer.setLeaves([]);
  renderer.render();
  const ground = readAll(renderer, canvas);
  const counts = countDraws(renderer.gl);
  renderer.setLeaves(leaves);
  renderer.render();
  return { canvas, renderer, counts, ground, at: (x, y) => pixelAtWorld(renderer, canvas, x, y) };
}

// A warm autumn color: red is the strongest channel and clearly brighter than the ground.
function isWarm(c) {
  return c[0] > c[1] && c[0] > c[2] && c[0] > GROUND[0] + 60;
}

test('render 10a: every tint gives a warm autumn color on the blade', () => {
  const tints = [0, 0.2, 0.4, 0.6, 0.8, 0.99];
  const leaves = tints.map((tint, i) => ({ x: -625 + i * 250, y: 0, angle: 0, scale: 4, tint }));
  const d = drawLeafLook(leaves);
  const off = 4 * 0.5 * halfWidthAt(0);   // halfway between the midrib and the edge, at the middle
  leaves.forEach((leaf, i) => {
    for (const c of [d.at(leaf.x, off), d.at(leaf.x, -off)]) {
      assert(isWarm(c), `tint ${tints[i]}: (${c}) is not a warm autumn color`);
    }
  });
});

test('render 10a: the drawn shape follows the mesh (inside the edge is leaf, outside is ground)', () => {
  const d = drawLeafLook([{ x: 0, y: 0, angle: 0, scale: 4, tint: 0.5 }]);
  for (const along of [0.3, 0.5, 0.7, 0.85]) {
    const x = (along - 0.5) * LEAF_WIDTH;   // scale 1 units
    const hw = halfWidthAt(x);
    const inside = d.at(4 * x, 4 * hw * 0.6);
    assert(isWarm(inside), `along ${along}: inside the edge is not leaf (${inside})`);
    assertColor(d.at(4 * x, 4 * hw + 3), d.ground(4 * x, 4 * hw + 3), `along ${along}: just outside the edge`);
    assertColor(d.at(4 * x, -(4 * hw + 3)), d.ground(4 * x, -(4 * hw + 3)), `along ${along}: just outside the lower edge`);
  }
});

test('render 10a: the corners of the old rectangle are now ground', () => {
  const d = drawLeafLook([{ x: 0, y: 0, angle: 0, scale: 4, tint: 0.5 }]);
  const cx = 4 * LEAF_WIDTH * 0.45;
  const cy = 4 * LEAF_HEIGHT * 0.45;
  for (const [x, y] of [[cx, cy], [-cx, cy], [cx, -cy], [-cx, -cy]]) {
    assertColor(d.at(x, y), d.ground(x, y), `corner (${x}, ${y})`);
  }
});

test('render 10a: the stem is drawn (not ground) and so is the narrow part near the tip', () => {
  const d = drawLeafLook([{ x: 0, y: 0, angle: 0, scale: 4, tint: 0.5 }]);
  const stemX = 4 * (-LEAF_WIDTH / 2 + 3);   // 3 units in from the stem end, on the center line
  const stem = d.at(stemX, 0);
  assert(Math.abs(brightness(stem) - brightness(d.ground(stemX, 0))) > 30, `stem (${stem}) looks like ground`);
  const tipX = 4 * LEAF_WIDTH * 0.42;
  const nearTip = d.at(tipX, 0);
  assert(brightness(nearTip) > brightness(d.ground(tipX, 0)) + 60, `near the tip (${nearTip}) looks like ground`);
});

test('render 10a: two tints give clearly different colors', () => {
  const d = drawLeafLook([
    { x: -300, y: 0, angle: 0, scale: 4, tint: 0.05 },
    { x: 300, y: 0, angle: 0, scale: 4, tint: 0.65 },
  ]);
  const off = 4 * 0.5 * halfWidthAt(0);
  const a = d.at(-300, off);
  const b = d.at(300, off);
  const diff = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  assert(diff > 60, `tint 0.05 (${a}) and tint 0.65 (${b}) differ by only ${diff}`);
});

test('render 10a: a leaf keeps its color when the leaf before it is removed (no color jump)', () => {
  const a = { x: -300, y: 0, angle: 0, scale: 4, tint: 0.1 };
  const b = { x: 300, y: 0, angle: 0, scale: 4, tint: 0.7 };
  const d = drawLeafLook([a, b]);
  const off = 4 * 0.5 * halfWidthAt(0);
  const before = d.at(300, off);
  d.renderer.setLeaves([b]);   // b is now leaf 0 instead of leaf 1, as after a swap-and-pop
  d.renderer.render();
  assertColor(d.at(300, off), before, 'leaf b after a was removed');
});

test('render 10a: the midrib is lighter than the blade beside it', () => {
  const d = drawLeafLook([{ x: 0, y: 0, angle: 0, scale: 4, tint: 0.5 }]);
  const x = 4 * 0.05 * LEAF_WIDTH;   // a little past the middle
  const hw = 4 * halfWidthAt(x / 4);
  const midrib = brightness(d.at(x, 0));
  const blade = Math.min(...[0.3, 0.45, 0.6].map((k) => brightness(d.at(x, hw * k))));
  assert(midrib > blade + 10, `midrib ${midrib}, blade ${blade}`);
});

test('render 10a: fade still works (0 is invisible, 0.5 is between leaf and ground)', () => {
  const off = 4 * 0.5 * halfWidthAt(0);
  const solid = drawLeafLook([{ x: 0, y: 0, angle: 0, scale: 4, tint: 0.5, fade: 1 }]).at(0, off);
  const halfLook = drawLeafLook([{ x: 0, y: 0, angle: 0, scale: 4, tint: 0.5, fade: 0.5 }]);
  const half = halfLook.at(0, off);
  const ground = halfLook.ground(0, off);
  const goneLook = drawLeafLook([{ x: 0, y: 0, angle: 0, scale: 4, tint: 0.5, fade: 0 }]);
  assertColor(goneLook.at(0, off), goneLook.ground(0, off), 'fade 0');
  for (let i = 0; i < 3; i++) {
    assert(Math.abs(half[i] - (solid[i] + ground[i]) / 2) <= 4,
      `fade 0.5 (${half}) is not halfway between (${solid}) and the ground`);
  }
});

test('render 10a: G (setGrayBox) switches between the rectangle and the leaf shape', () => {
  const leaf = { x: 0, y: 0, angle: 0, scale: 4, tint: 0.5 };
  const corner = [4 * LEAF_WIDTH * 0.45, 4 * LEAF_HEIGHT * 0.45];
  const gray = drawLeafLook([leaf], { grayBox: true });
  assertLeafColor(gray.at(...corner), 'gray-box: the rectangle corner');
  gray.renderer.setGrayBox(false);
  gray.renderer.setLeaves([]);
  gray.renderer.render();
  const ground = gray.at(...corner);   // the new look's ground there, with no leaf
  gray.renderer.setLeaves([leaf]);
  gray.renderer.render();
  assertColor(gray.at(...corner), ground, 'back to the new look: the corner is ground');
});

test('render 10a: 1000 leaves are still one draw call (plus one for the ground), and every leaf center is warm', () => {
  const leaves = spawnLeaves(1000, 11);
  const d = drawLeafLook(leaves);
  const at = readAll(d.renderer, d.canvas);
  let cold = 0;
  for (const leaf of leaves) if (!isWarm(at(leaf.x, leaf.y))) cold++;
  assert(cold === 0, `${cold} leaf centers are not a warm color`);
  assert(d.counts.instanced === 1 && d.counts.plain === 1,
    `draw calls: ${d.counts.instanced} instanced, ${d.counts.plain} plain`);
  assert(d.counts.lastInstances === 1000, `instance count ${d.counts.lastInstances}`);
});

test('render 10a: the debug ring sits at the tight radius (16), not the old one (23.3)', () => {
  const d = drawLeafLook([{ x: 0, y: 200, angle: 0, scale: 1, tint: 0.5 }], { debug: true });
  let ring = 0;
  // How much brighter than the empty ground the ring makes a pixel.
  for (let r = 14; r <= 18; r += 0.5) ring = Math.max(ring, brightness(d.at(0, 200 + r)) - brightness(d.ground(0, 200 + r)));
  assert(ring > 40, `ring not visible near 16 (at most ${ring} brighter than the ground)`);
  for (let r = 21; r <= 25; r += 1) assertColor(d.at(0, 200 + r), d.ground(0, 200 + r), `r = ${r}`);
});

test('render 10a: no WebGL errors in either look', () => {
  const leaves = spawnLeaves(200, 5);
  for (const grayBox of [false, true]) {
    const d = drawLeafLook(leaves, { grayBox, debug: true });
    assert(d.renderer.gl.getError() === d.renderer.gl.NO_ERROR, `gl.getError() reported a problem (gray-box ${grayBox})`);
  }
});

// ---------- Step 10b: the ground texture ----------

// A full-world canvas with the new look and nothing on it: only the ground (and bars).
function drawGround(cssWidth = 800, cssHeight = 450) {
  const canvas = makeCanvas(cssWidth, cssHeight);
  const renderer = createRenderer(canvas);
  const counts = countDraws(renderer.gl);
  renderer.setLeaves([]);
  renderer.render();
  return { canvas, renderer, counts, at: (x, y) => pixelAtWorld(renderer, canvas, x, y) };
}

// 400 ground samples on a 20 x 20 grid over the world (inside the border).
function groundSamples(d) {
  const at = readAll(d.renderer, d.canvas);
  const out = [];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) out.push(at(-760 + i * 80, -430 + j * 45));
  }
  return out;
}

test('render 10b: the GPU noise matches our JavaScript noise (50 points, within 0.01)', () => {
  // A small program that writes perlin(point) for 50 points into a 50 x 1 canvas, one point per pixel,
  // stored as (noise + 1) / 2 in the red channel (8 bits: steps of 0.008 in noise units).
  const canvas = document.createElement('canvas');
  canvas.width = 50;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2');
  const points = [];
  for (let i = 0; i < 50; i++) points.push([(i * 13.37) % 97 - 48.5, (i * 7.91) % 61 - 30.2, (i * 0.731) % 11]);
  const program = createProgram(gl,
    `#version 300 es
    in vec2 aCorner;
    void main() { gl_Position = vec4(aCorner, 0.0, 1.0); }`,
    `#version 300 es
    precision highp float;
    precision highp int;
    ${perlinGlsl}
    uniform vec3 uPoints[50];
    out vec4 outColor;
    void main() {
      float n = perlin(uPoints[int(gl_FragCoord.x)]);
      outColor = vec4((n + 1.0) * 0.5, 0.0, 0.0, 1.0);
    }`);
  gl.useProgram(program);
  const permTexture = createNoiseTexture(gl, noiseTable(GROUND_SEED));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, permTexture);
  gl.uniform1i(gl.getUniformLocation(program, 'uPerm'), 0);
  gl.uniform3fv(gl.getUniformLocation(program, 'uPoints'), new Float32Array(points.flat()));
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, 50, 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const pixels = new Uint8Array(50 * 4);
  gl.readPixels(0, 0, 50, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const noise = createNoise(GROUND_SEED);
  let worst = 0;
  points.forEach((p, i) => {
    const gpu = (pixels[i * 4] / 255) * 2 - 1;
    worst = Math.max(worst, Math.abs(gpu - noise(...p)));
  });
  assert(worst <= 0.01, `largest difference ${worst.toFixed(4)}`);
  assert(gl.getError() === gl.NO_ERROR, 'gl.getError() reported a problem');
  const lose = gl.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();
});

test('render 10b: the ground is not flat (400 samples vary clearly)', () => {
  const samples = groundSamples(drawGround()).map(brightness);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length);
  const range = Math.max(...samples) - Math.min(...samples);
  assert(range > 20 && sd > 4, `range ${range}, standard deviation ${sd.toFixed(1)}`);
});

test('render 10b: the ground is green to brown (blue lowest, not grey, more green than red on average)', () => {
  const samples = groundSamples(drawGround());
  let red = 0, green = 0;
  for (const c of samples) {
    assert(c[2] <= c[0] && c[2] <= c[1], `(${c}): blue is not the lowest channel`);
    assert(Math.max(...c) - Math.min(...c) >= 8, `(${c}) is grey`);
    red += c[0];
    green += c[1];
  }
  assert(green > red, `average red ${(red / 400).toFixed(1)}, green ${(green / 400).toFixed(1)}`);
});

test('render 10b: the ground is darker than the darkest leaf color, so leaves stand out', () => {
  // The darkest leaf body color: crimson (0.62, 0.11, 0.09) at the lowest brightness 0.92.
  const darkestLeaf = (0.62 + 0.11 + 0.09) * 0.92 * 255;
  const brightest = Math.max(...groundSamples(drawGround()).map(brightness));
  assert(brightest < darkestLeaf - 15, `brightest ground ${brightest}, darkest leaf ${darkestLeaf.toFixed(0)}`);
});

test('render 10b: the ground is darker at the world border than 150 units inside it', () => {
  const d = drawGround(1600, 900);
  const at = readAll(d.renderer, d.canvas);
  let edge = 0, inner = 0, n = 0;
  for (let x = -780; x <= 780; x += 10) {
    for (const s of [1, -1]) {
      edge += brightness(at(x * 0.99, s * 447));
      inner += brightness(at(x * 0.8, s * 297));
      n++;
    }
  }
  for (let y = -430; y <= 430; y += 10) {
    for (const s of [1, -1]) {
      edge += brightness(at(s * 797, y * 0.99));
      inner += brightness(at(s * 647, y * 0.65));
      n++;
    }
  }
  assert(edge / n < 0.95 * (inner / n), `border average ${(edge / n).toFixed(1)}, inside ${(inner / n).toFixed(1)}`);
});

test('render 10b: the same ground every frame and on a new renderer', () => {
  const a = drawGround();
  const first = groundSamples(a);
  a.renderer.render();
  const second = groundSamples(a);
  const b = drawGround();
  const fresh = groundSamples(b);
  first.forEach((c, i) => {
    assertColor(second[i], c, `sample ${i}, second frame`);
    assertColor(fresh[i], c, `sample ${i}, new renderer`);
  });
});

test('render 10b: the ground is baked once, and again only when the size changes', () => {
  const d = drawGround(800, 450);
  assert(d.renderer.groundBakes() === 1, `bakes after the first frame: ${d.renderer.groundBakes()}`);
  d.renderer.render();
  d.renderer.render();
  assert(d.renderer.groundBakes() === 1, `bakes after 3 frames: ${d.renderer.groundBakes()}`);
  d.canvas.style.width = '640px';
  d.canvas.style.height = '360px';
  d.renderer.render();
  d.renderer.render();
  assert(d.renderer.groundBakes() === 2, `bakes after a resize and 2 frames: ${d.renderer.groundBakes()}`);
});

test('render 10b: each frame draws the ground with one plain draw call (the bake adds one, once)', () => {
  const d = drawGround();
  assert(d.counts.plain === 2 && d.counts.instanced === 0, `first frame: ${d.counts.plain} plain, ${d.counts.instanced} instanced`);
  d.renderer.render();
  assert(d.counts.plain === 3, `second frame added ${d.counts.plain - 2} plain calls`);
});

test('render 10b: the bars outside the world stay flat', () => {
  const d = drawGround(1000, 300);
  assertColor(d.at(-1500, 0), BAR, 'left bar');
  assertColor(d.at(1500, 0), BAR, 'right bar');
});

test('render 10b: G brings back the flat ground, with no bake and no ground draw call', () => {
  const canvas = makeCanvas(800, 450);
  const renderer = createGrayRenderer(canvas);
  const counts = countDraws(renderer.gl);
  renderer.setLeaves([]);
  renderer.render();
  for (const [x, y] of [[-700, 400], [0, 0], [500, -300]]) {
    assertColor(pixelAtWorld(renderer, canvas, x, y), GROUND, `(${x}, ${y})`);
  }
  assert(counts.plain === 0 && renderer.groundBakes() === 0, `${counts.plain} plain calls, ${renderer.groundBakes()} bakes`);
});

test('render 10b: no WebGL errors with the ground, leaves, void, obstacles, and debug rings', () => {
  const d = drawLeafLook(spawnLeaves(300, 4), { debug: true });
  d.renderer.setVoid(VOID);
  d.renderer.setObstacles(TEST_OBSTACLES);
  d.renderer.render();
  assert(d.renderer.gl.getError() === d.renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});
