import { leafVertex, leafFragment } from './shaders.js';
import { projection, worldRect } from './math.js';
import { WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT, MAX_LEAVES } from './config.js';

const FLOATS_PER_LEAF = 4;   // x, y, angle, scale

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Copy the leaves into one flat array, 4 numbers per leaf: [x0, y0, angle0, scale0, x1, y1, ...].
// This is the layout the GPU reads (see the aLeaf attribute below). Pure function: no WebGL.
// Returns how many leaves were written. Leaves that do not fit in `out` are left out.
// A leaf with a missing or non-finite value is written as all zeros: scale 0 means it is not drawn,
// so one bad leaf can never break the frame.
export function packLeaves(leaves, out) {
  if (!Array.isArray(leaves)) {
    return 0;
  }
  const capacity = Math.floor(out.length / FLOATS_PER_LEAF);
  const count = Math.min(leaves.length, capacity);
  for (let i = 0; i < count; i++) {
    const leaf = leaves[i];
    const o = i * FLOATS_PER_LEAF;   // where this leaf's 4 numbers start
    const ok = leaf !== null && typeof leaf === 'object'
      && isNumber(leaf.x) && isNumber(leaf.y) && isNumber(leaf.angle) && isNumber(leaf.scale);
    out[o] = ok ? leaf.x : 0;
    out[o + 1] = ok ? leaf.y : 0;
    out[o + 2] = ok ? leaf.angle : 0;
    out[o + 3] = ok ? leaf.scale : 0;
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

  // Buffer 2: per-leaf data, 4 floats per leaf. Made once at full size (MAX_LEAVES leaves = 160 KB),
  // then refilled every frame. DYNAMIC = "we will change this often", a hint for the driver.
  const leafData = new Float32Array(MAX_LEAVES * FLOATS_PER_LEAF);
  const leafBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, leafData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aLeaf);
  gl.vertexAttribPointer(aLeaf, 4, gl.FLOAT, false, 0, 0);   // 4 floats per leaf, read as one vec4
  // The key line for instancing: divisor 1 means "move to the next 4 floats once per leaf (instance)",
  // instead of once per corner (divisor 0, the default, as for aPosition).
  gl.vertexAttribDivisor(aLeaf, 1);
  gl.bindVertexArray(null);

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

    if (leafCount === 0) {
      return;   // nothing to draw
    }

    // Send this frame's leaf data to the GPU. Only the part in use is copied:
    // bufferSubData(target, byte offset in the buffer, source array, first element, element count).
    gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, leafData, 0, leafCount * FLOATS_PER_LEAF);

    // Draw every leaf with ONE call. The scissor stays on, so a leaf can never be drawn over the bars.
    gl.useProgram(program);
    gl.uniformMatrix3fv(uProjection, false,
      projection(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height));
    gl.bindVertexArray(vao);
    // 4 corners as a strip = 2 triangles per leaf, repeated for leafCount leaves.
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, leafCount);
    gl.bindVertexArray(null);
  }

  return { gl, render, setLeaves };
}
