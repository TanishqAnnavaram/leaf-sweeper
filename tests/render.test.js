// Rendering tests (steps 2 to 5). These need a real browser with WebGL2, so they only run from tests/index.html.
// Each test draws into a hidden-size canvas, then reads pixels back and checks their color.

import { test, assert } from './harness.js';
import { createRenderer } from '../src/renderer.js';
import { projection, transformPoint } from '../src/math.js';
import { WORLD_WIDTH, WORLD_HEIGHT, MAX_LEAVES } from '../src/config.js';
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
  const renderer = createRenderer(canvas);
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

test('render: the leaf is 40 x 24 world units', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 1 });
  assertLeafColor(d.at(17, 0), 'inside right edge');
  assertLeafColor(d.at(-17, 0), 'inside left edge');
  assertColor(d.at(24, 0), GROUND, 'outside right edge');
  assertLeafColor(d.at(0, 9), 'inside top edge');
  assertColor(d.at(0, 16), GROUND, 'outside top edge');
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
  assertLeafColor(d.at(0, 17), 'along the long side, now vertical');
  assertColor(d.at(17, 0), GROUND, 'where the long side used to be');
});

test('render: leaf rotated 45 degrees counterclockwise', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: Math.PI / 4, scale: 1 });
  assertLeafColor(d.at(12, 12), 'up-right diagonal (the long side)');
  assertColor(d.at(-12, 12), GROUND, 'up-left diagonal');
});

test('render: scale 2 doubles the leaf', () => {
  const d = draw(800, 450, { x: 0, y: 0, angle: 0, scale: 2 });
  assertLeafColor(d.at(35, 0), 'inside the doubled leaf');
  assertColor(d.at(45, 0), GROUND, 'outside the doubled leaf');
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
  const renderer = createRenderer(canvas);
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
  const renderer = createRenderer(canvas);
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
  const renderer = createRenderer(canvas);
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
  const renderer = createRenderer(canvas);
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
  const renderer = createRenderer(canvas);
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
  const renderer = createRenderer(canvas);
  const counts = countDraws(renderer.gl);
  renderer.setLeaves([]);
  renderer.render();
  assertColor(pixelAtWorld(renderer, canvas, 0, 0), GROUND, 'center');
  assert(counts.instanced === 0 && counts.plain === 0, 'a draw call was made');
  assert(renderer.gl.getError() === renderer.gl.NO_ERROR, 'gl.getError() reported a problem');
});

test('render: more than MAX_LEAVES draws MAX_LEAVES, warns once, no WebGL error', () => {
  const canvas = makeCanvas(400, 225);
  const renderer = createRenderer(canvas);
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
  const renderer = createRenderer(canvas);
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
