import { leafVertex, leafFragment, voidVertex, voidFragment } from './shaders.js';
import { projection, worldRect } from './math.js';
import { WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_LEAVES } from './config.js';

// Floats per leaf in the GPU buffer: x, y, angle, scale (step 4), plus fade (step 7).
export const FLOATS_PER_LEAF = 5;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Copy the leaves into one flat array, 5 numbers per leaf: [x0, y0, angle0, scale0, fade0, x1, ...].
// This is the layout the GPU reads (see the aLeaf attribute below). Pure function: no WebGL.
// Returns how many leaves were written. Leaves that do not fit in `out` are left out.
// A leaf with a missing or non-finite value is written as all zeros: scale 0 means it is not drawn,
// so one bad leaf can never break the frame. A missing fade means 1 (fully visible).
export function packLeaves(leaves, out) {
  if (!Array.isArray(leaves)) {
    return 0;
  }
  const capacity = Math.floor(out.length / FLOATS_PER_LEAF);
  const count = Math.min(leaves.length, capacity);
  for (let i = 0; i < count; i++) {
    const leaf = leaves[i];
    const o = i * FLOATS_PER_LEAF;   // where this leaf's numbers start
    const ok = leaf !== null && typeof leaf === 'object'
      && isNumber(leaf.x) && isNumber(leaf.y) && isNumber(leaf.angle) && isNumber(leaf.scale);
    out[o] = ok ? leaf.x : 0;
    out[o + 1] = ok ? leaf.y : 0;
    out[o + 2] = ok ? leaf.angle : 0;
    out[o + 3] = ok ? leaf.scale : 0;
    // Fade: 1 = solid, 0 = invisible. Kept in [0, 1]; missing or NaN counts as 1.
    const fade = ok && isNumber(leaf.fade) ? Math.min(1, Math.max(0, leaf.fade)) : 1;
    out[o + 4] = ok ? fade : 0;
  }
  return count;
}

// Compile one shader. If the GLSL has an error, throw it so we can see the message.
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);   // type is gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile error: ' + log);
  }
  return shader;
}

// Link a vertex shader and a fragment shader into one program the GPU can run.
function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  let fragmentShader;
  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  } catch (err) {
    gl.deleteShader(vertexShader);   // do not leave the first shader behind
    throw err;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  // Once linked, the program holds its own copy of the compiled code,
  // so the two shader objects are no longer needed and can be freed.
  gl.detachShader(program, vertexShader);
  gl.detachShader(program, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link error: ' + log);
  }
  return program;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    throw new Error('WebGL2 is not supported in this browser.');
  }

  const program = createProgram(gl, leafVertex, leafFragment);
  const aPosition = gl.getAttribLocation(program, 'aPosition');
  const aLeaf = gl.getAttribLocation(program, 'aLeaf');
  const aFade = gl.getAttribLocation(program, 'aFade');
  const uProjection = gl.getUniformLocation(program, 'uProjection');

  // The leaf shape: a rectangle centered on (0, 0), in world units.
  // Four corners in "triangle strip" order: each new corner makes a triangle with the two before it,
  // so 4 corners give the 2 triangles of a rectangle.
  const hw = LEAF_WIDTH / 2;
  const hh = LEAF_HEIGHT / 2;
  const vertices = new Float32Array([
    -hw, -hh,   // bottom left
     hw, -hh,   // bottom right
    -hw,  hh,   // top left
     hw,  hh,   // top right
  ]);

  // A VAO remembers how both buffers are laid out, so drawing later is one bind.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // Buffer 1: the leaf shape, shared by every leaf.
  const shapeBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);   // STATIC = never changes
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);  // 2 floats per corner

  // Buffer 2: per-leaf data, 5 floats per leaf. Made once at full size (MAX_LEAVES leaves = 200 KB),
  // then refilled every frame. DYNAMIC = "we will change this often", a hint for the driver.
  const leafData = new Float32Array(MAX_LEAVES * FLOATS_PER_LEAF);
  const leafBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, leafData.byteLength, gl.DYNAMIC_DRAW);
  // Each leaf's 5 floats sit side by side, so the "stride" (bytes from one leaf to the next) is 5 * 4 = 20.
  // aLeaf reads the first 4 floats (offset 0) as a vec4, aFade the 5th float (offset 16 bytes).
  const stride = FLOATS_PER_LEAF * 4;
  gl.enableVertexAttribArray(aLeaf);
  gl.vertexAttribPointer(aLeaf, 4, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aFade);
  gl.vertexAttribPointer(aFade, 1, gl.FLOAT, false, stride, 16);
  // The key lines for instancing: divisor 1 means "move to the next leaf's values once per leaf (instance)",
  // instead of once per corner (divisor 0, the default, as for aPosition).
  gl.vertexAttribDivisor(aLeaf, 1);
  gl.vertexAttribDivisor(aFade, 1);
  gl.bindVertexArray(null);


  // ---------- The void (step 7): a dark disc and a faint ring, drawn with their own small shader ----------
  // One square that covers the ring, drawn as 2 triangles. The fragment shader decides, pixel by pixel,
  // whether the pixel is in the disc, on the ring, or neither (then it draws nothing there).
  const voidProgram = createProgram(gl, voidVertex, voidFragment);
  const vCorner = gl.getAttribLocation(voidProgram, 'aCorner');
  const vProjection = gl.getUniformLocation(voidProgram, 'uProjection');
  const vCenter = gl.getUniformLocation(voidProgram, 'uCenter');
  const vHalfSize = gl.getUniformLocation(voidProgram, 'uHalfSize');
  const vDiscRadius = gl.getUniformLocation(voidProgram, 'uDiscRadius');
  const vRingRadius = gl.getUniformLocation(voidProgram, 'uRingRadius');

  const voidVao = gl.createVertexArray();
  gl.bindVertexArray(voidVao);
  const voidBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, voidBuffer);
  // A square from -1 to 1, in triangle strip order. The vertex shader scales it to the void's size.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(vCorner);
  gl.vertexAttribPointer(vCorner, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  let voidSettings = null;   // null = do not draw the void (the default, so older tests see only ground)

  // Show the void at (x, y) with a dark disc of discRadius and a ring at ringRadius (world units),
  // or hide it with null. Any missing or bad number hides it instead of drawing something broken.
  function setVoid(settings) {
    const ok = settings && isNumber(settings.x) && isNumber(settings.y)
      && isNumber(settings.discRadius) && settings.discRadius >= 0
      && isNumber(settings.ringRadius) && settings.ringRadius >= 0;
    voidSettings = ok
      ? { x: settings.x, y: settings.y, discRadius: settings.discRadius, ringRadius: settings.ringRadius }
      : null;
  }

  function drawVoid(proj) {
    if (!voidSettings) {
      return;
    }
    const v = voidSettings;
    // Half the square's size: big enough for the ring plus its soft edge (4 world units).
    const halfSize = Math.max(v.discRadius, v.ringRadius) + 4;
    gl.useProgram(voidProgram);
    gl.uniformMatrix3fv(vProjection, false, proj);
    gl.uniform2f(vCenter, v.x, v.y);
    gl.uniform1f(vHalfSize, halfSize);
    gl.uniform1f(vDiscRadius, v.discRadius);
    gl.uniform1f(vRingRadius, v.ringRadius);
    gl.bindVertexArray(voidVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  let leafCount = 0;          // how many leaves are packed in leafData
  let warnedTooMany = false;  // warn only once if someone asks for more than MAX_LEAVES

  // Give the renderer the leaves to draw. The values are copied right away, so changing the
  // leaves afterwards has no effect until setLeaves is called again (the game loop does it every frame).
  function setLeaves(leaves) {
    leafCount = packLeaves(leaves, leafData);
    if (Array.isArray(leaves) && leaves.length > MAX_LEAVES && !warnedTooMany) {
      warnedTooMany = true;
      console.warn(`Only the first ${MAX_LEAVES} of ${leaves.length} leaves are drawn (MAX_LEAVES).`);
    }
  }

  // Match the canvas's real pixel size to the screen, so it stays sharp on high-resolution displays.
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render() {
    resize();

    // Paint the whole canvas with the bar color first.
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.05, 0.035, 0.03, 1.0);   // near-black brown bars
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Then paint the ground only inside the world's rectangle.
    // The scissor test limits clearing (and drawing) to a rectangle of pixels.
    const rect = worldRect(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height);
    if (rect.width < 1 || rect.height < 1) {
      return;   // canvas has no size (for example a minimized window): nothing to draw
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height));
    gl.clearColor(0.11, 0.08, 0.06, 1.0);    // dark brown ground
    gl.clear(gl.COLOR_BUFFER_BIT);

    const proj = projection(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height);

    // Blending, so fading leaves (and the void's soft edges) mix with what is already drawn:
    //   color = source * sourceAlpha + destination * (1 - sourceAlpha)
    // The canvas's own alpha is kept at 1 (factors ZERO, ONE for alpha), otherwise the page would
    // show through the canvas wherever a leaf is half faded.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

    // The void first, so the leaves are drawn on top of it.
    drawVoid(proj);

    if (leafCount === 0) {
      return;   // no leaves to draw
    }

    // Send this frame's leaf data to the GPU. Only the part in use is copied:
    // bufferSubData(target, byte offset in the buffer, source array, first element, element count).
    gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, leafData, 0, leafCount * FLOATS_PER_LEAF);

    // Draw every leaf with ONE call. The scissor stays on, so a leaf can never be drawn over the bars.
    gl.useProgram(program);
    gl.uniformMatrix3fv(uProjection, false, proj);
    gl.bindVertexArray(vao);
    // 4 corners as a strip = 2 triangles per leaf, repeated for leafCount leaves.
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, leafCount);
    gl.bindVertexArray(null);
  }

  return { gl, render, setLeaves, setVoid };
}
