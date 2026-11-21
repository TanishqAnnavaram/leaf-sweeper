import {
  leafVertex, leafFragment, voidVertex, voidFragment, circleVertex, circleFragment,
  groundBakeVertex, groundBakeFragment, groundVertex, groundFragment,
} from './shaders.js';
import { projection, worldRect } from './math.js';
import { WORLD_WIDTH, WORLD_HEIGHT, LEAF_RADIUS, MAX_LEAVES, GROUND_SEED } from './config.js';
import { noiseTable } from './noise.js';
import { buildLeafMesh, buildRectMesh, FLOATS_PER_VERTEX } from './leafmesh.js';

// Floats per leaf in the GPU buffer: x, y, angle, scale (step 4), fade (step 7), tint (step 10a).
export const FLOATS_PER_LEAF = 6;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Copy the leaves into one flat array, 6 numbers per leaf: [x0, y0, angle0, scale0, fade0, tint0, x1, ...].
// This is the layout the GPU reads (see the aLeaf attribute below). Pure function: no WebGL.
// Returns how many leaves were written. Leaves that do not fit in `out` are left out.
// A leaf with a missing or non-finite value is written as all zeros: scale 0 means it is not drawn,
// so one bad leaf can never break the frame. A missing fade means 1 (fully visible), a missing tint 0.5.
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
    // Tint: the leaf's color, 0 to 1. Kept in [0, 1]; missing or NaN counts as 0.5 (the middle color).
    const tint = ok && isNumber(leaf.tint) ? Math.min(1, Math.max(0, leaf.tint)) : 0.5;
    out[o + 5] = ok ? tint : 0;
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
// Exported for the tests (step 10b checks the GPU noise with a small program of its own).
export function createProgram(gl, vertexSource, fragmentSource) {
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

// Step 10b: send the noise's shuffled 0 to 255 table (noiseTable in noise.js) to the GPU as a 256 x 1
// texture with one byte per texel (format R8: red only). NEAREST: never blend neighbouring entries, they
// are table entries, not colors. The shader reads entry i with texelFetch, as value / 255.
export function createNoiseTexture(gl, table) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);   // rows of 1-byte texels are not padded to 4 bytes
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, table);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    throw new Error('WebGL2 is not supported in this browser.');
  }

  const program = createProgram(gl, leafVertex, leafFragment);
  const aPosition = gl.getAttribLocation(program, 'aPosition');
  const aAlong = gl.getAttribLocation(program, 'aAlong');
  const aLeaf = gl.getAttribLocation(program, 'aLeaf');
  const aFade = gl.getAttribLocation(program, 'aFade');
  const aTint = gl.getAttribLocation(program, 'aTint');
  const uProjection = gl.getUniformLocation(program, 'uProjection');
  const uGrayBox = gl.getUniformLocation(program, 'uGrayBox');

  // Per-leaf data, 6 floats per leaf. Made once at full size (MAX_LEAVES leaves = 240 KB),
  // then refilled every frame. DYNAMIC = "we will change this often", a hint for the driver.
  const leafData = new Float32Array(MAX_LEAVES * FLOATS_PER_LEAF);
  const leafBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, leafData.byteLength, gl.DYNAMIC_DRAW);

  // Turn on one attribute and say where its numbers are. A location of -1 means the shader does not
  // use that input, so there is nothing to set up.
  function attribute(location, size, stride, offset, divisor) {
    if (location < 0) {
      return;
    }
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(location, divisor);
  }

  // One VAO per leaf shape. A VAO remembers how both buffers are laid out, so drawing later is one bind.
  //   Buffer 1: the shape (mesh), shared by every leaf. 3 floats per vertex: x, y, along,
  //             so the "stride" (bytes from one vertex to the next) is 12. Divisor 0: once per vertex.
  //   Buffer 2: the per-leaf data. Each leaf's 6 floats sit side by side: stride 6 * 4 = 24 bytes.
  //             aLeaf reads floats 0 to 3 as a vec4, aFade float 4 (byte 16), aTint float 5 (byte 20).
  //             Divisor 1, the key line for instancing: move to the next leaf's values once per leaf
  //             (instance), instead of once per vertex.
  function leafVao(mesh) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const shapeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);   // STATIC = never changes
    const vs = FLOATS_PER_VERTEX * 4;
    attribute(aPosition, 2, vs, 0, 0);
    attribute(aAlong, 1, vs, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
    const ls = FLOATS_PER_LEAF * 4;
    attribute(aLeaf, 4, ls, 0, 1);
    attribute(aFade, 1, ls, 16, 1);
    attribute(aTint, 1, ls, 20, 1);
    gl.bindVertexArray(null);
    return { vao, count: mesh.count };
  }

  // Step 10a: the Bézier leaf (26 vertices) and, for the G key, the gray-box rectangle (4 corners).
  const leafShape = leafVao(buildLeafMesh());
  const rectShape = leafVao(buildRectMesh());
  let grayBox = false;


  // ---------- The ground (step 10b): baked once into a texture, drawn as one square every frame ----------
  const bakeProgram = createProgram(gl, groundBakeVertex, groundBakeFragment);
  const bCorner = gl.getAttribLocation(bakeProgram, 'aCorner');
  const bSize = gl.getUniformLocation(bakeProgram, 'uSize');
  const bWorld = gl.getUniformLocation(bakeProgram, 'uWorld');
  const bPerm = gl.getUniformLocation(bakeProgram, 'uPerm');
  const groundProgram = createProgram(gl, groundVertex, groundFragment);
  const gCorner = gl.getAttribLocation(groundProgram, 'aCorner');
  const gProjection = gl.getUniformLocation(groundProgram, 'uProjection');
  const gHalfWorld = gl.getUniformLocation(groundProgram, 'uHalfWorld');
  const gGround = gl.getUniformLocation(groundProgram, 'uGround');

  // One square, corners -1 to 1 in triangle strip order, used by both ground programs.
  const groundSquare = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, groundSquare);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  function squareVao(location) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, groundSquare);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }
  const bakeVao = squareVao(bCorner);
  const groundVao = squareVao(gCorner);

  const permTexture = createNoiseTexture(gl, noiseTable(GROUND_SEED));
  let groundTexture = null;       // the baked ground, made on the first frame that needs it
  let groundFramebuffer = null;   // draws into groundTexture instead of onto the screen
  let bakedWidth = 0;             // the size it was baked for, in pixels
  let bakedHeight = 0;
  let bakes = 0;                  // how many times it was baked (the tests check it is not every frame)
  let groundFailed = false;       // the GPU could not draw into the texture: use the flat ground instead

  // Make sure the ground texture is baked for a world that is width x height pixels on screen.
  // Bakes only when that size changed. Returns false if baking is impossible on this GPU.
  function bakeGround(width, height) {
    if (groundFailed) {
      return false;
    }
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const w = Math.min(maxSize, Math.max(1, Math.round(width)));
    const h = Math.min(maxSize, Math.max(1, Math.round(height)));
    if (groundTexture && w === bakedWidth && h === bakedHeight) {
      return true;   // already baked at this size
    }
    if (!groundTexture) {
      groundTexture = gl.createTexture();
      groundFramebuffer = gl.createFramebuffer();
    }
    // (Re)size the texture: RGBA, 1 byte per channel, no starting data (null).
    gl.bindTexture(gl.TEXTURE_2D, groundTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // LINEAR: blend the 4 nearest texels if the square is drawn a little off the pixel grid.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Point the framebuffer at the texture: from now on, drawing while it is bound fills the texture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, groundFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, groundTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      groundFailed = true;
      console.warn('Could not bake the ground texture; drawing a flat ground instead.');
      return false;
    }

    // Draw the bake square over the whole texture, one fragment per texel.
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(bakeProgram);
    gl.uniform2f(bSize, w, h);
    gl.uniform2f(bWorld, WORLD_WIDTH, WORLD_HEIGHT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, permTexture);
    gl.uniform1i(bPerm, 0);   // the sampler reads texture unit 0
    gl.bindVertexArray(bakeVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    // Back to drawing on the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    bakedWidth = w;
    bakedHeight = h;
    bakes++;
    return true;
  }

  // Draw the baked ground on the world rectangle.
  function drawGround(proj) {
    gl.useProgram(groundProgram);
    gl.uniformMatrix3fv(gProjection, false, proj);
    gl.uniform2f(gHalfWorld, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, groundTexture);
    gl.uniform1i(gGround, 0);
    gl.bindVertexArray(groundVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

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

  // ---------- Obstacles and debug rings (step 9): one circle program, instanced ----------
  const circleProgram = createProgram(gl, circleVertex, circleFragment);
  const cCorner = gl.getAttribLocation(circleProgram, 'aCorner');
  const cCircle = gl.getAttribLocation(circleProgram, 'aCircle');
  const cProjection = gl.getUniformLocation(circleProgram, 'uProjection');
  const cLeafRadius = gl.getUniformLocation(circleProgram, 'uLeafRadius');
  const cOutline = gl.getUniformLocation(circleProgram, 'uOutline');
  const cOutlineColor = gl.getUniformLocation(circleProgram, 'uOutlineColor');

  // The square every circle is drawn in (-1 to 1, triangle strip), shared by both VAOs below.
  const squareBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  // Obstacle data: 4 floats each (x, y, radius, kind). Obstacles rarely change, so they are only
  // uploaded when setObstacles is called, not every frame.
  const MAX_OBSTACLES = 64;
  const obstacleData = new Float32Array(MAX_OBSTACLES * 4);
  const obstacleBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, obstacleBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, obstacleData.byteLength, gl.DYNAMIC_DRAW);
  let obstacleCount = 0;

  // VAO 1: circles from the obstacle buffer.
  const obstacleVao = gl.createVertexArray();
  gl.bindVertexArray(obstacleVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
  gl.enableVertexAttribArray(cCorner);
  gl.vertexAttribPointer(cCorner, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, obstacleBuffer);
  gl.enableVertexAttribArray(cCircle);
  gl.vertexAttribPointer(cCircle, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(cCircle, 1);

  // VAO 2: debug rings for the leaves, read straight from the leaf buffer (no copy):
  // the first 4 of each leaf's 5 floats are (x, y, angle, scale); the shader uses x, y and scale.
  const leafRingVao = gl.createVertexArray();
  gl.bindVertexArray(leafRingVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
  gl.enableVertexAttribArray(cCorner);
  gl.vertexAttribPointer(cCorner, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
  gl.enableVertexAttribArray(cCircle);
  gl.vertexAttribPointer(cCircle, 4, gl.FLOAT, false, FLOATS_PER_LEAF * 4, 0);
  gl.vertexAttribDivisor(cCircle, 1);
  gl.bindVertexArray(null);

  let debug = false;

  // Obstacles to draw: [{ x, y, radius, kind: 'rock' | 'trunk' }]. Broken entries are skipped.
  function setObstacles(obstacles) {
    obstacleCount = 0;
    if (Array.isArray(obstacles)) {
      for (const o of obstacles) {
        if (obstacleCount >= MAX_OBSTACLES) {
          break;
        }
        if (o && isNumber(o.x) && isNumber(o.y) && isNumber(o.radius) && o.radius > 0) {
          const i = obstacleCount * 4;
          obstacleData[i] = o.x;
          obstacleData[i + 1] = o.y;
          obstacleData[i + 2] = o.radius;
          obstacleData[i + 3] = o.kind === 'trunk' ? 1 : 0;
          obstacleCount++;
        }
      }
    }
    if (obstacleCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, obstacleBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, obstacleData, 0, obstacleCount * 4);
    }
  }

  // Debug view on or off: outlines of every obstacle's collision circle and every leaf's.
  function setDebug(on) {
    debug = Boolean(on);
  }

  // Gray-box look on or off (G key): orange rectangles as in steps 2 to 9, or the step 10a leaves.
  function setGrayBox(on) {
    grayBox = Boolean(on);
  }

  // Filled obstacles, then (in debug view) the outlines. Called after the leaves are drawn.
  function drawCircles(proj) {
    if (obstacleCount === 0 && !(debug && leafCount > 0)) {
      return;
    }
    gl.useProgram(circleProgram);
    gl.uniformMatrix3fv(cProjection, false, proj);
    if (obstacleCount > 0) {
      gl.bindVertexArray(obstacleVao);
      gl.uniform1f(cLeafRadius, 0);
      gl.uniform1f(cOutline, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, obstacleCount);
      if (debug) {
        gl.uniform1f(cOutline, 1);
        gl.uniform4f(cOutlineColor, 0.35, 0.9, 1.0, 0.9);   // cyan: obstacle collision circles
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, obstacleCount);
      }
    }
    if (debug && leafCount > 0) {
      gl.bindVertexArray(leafRingVao);
      gl.uniform1f(cLeafRadius, LEAF_RADIUS);
      gl.uniform1f(cOutline, 1);
      gl.uniform4f(cOutlineColor, 1.0, 1.0, 1.0, 0.55);   // white: leaf collision circles
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, leafCount);
    }
    gl.bindVertexArray(null);
  }

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
    const rect = worldRect(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height);
    const hasWorld = rect.width >= 1 && rect.height >= 1;

    // Step 10b: bake the ground texture first if needed (only on the first frame and after a resize),
    // because baking draws into the texture and changes the viewport, scissor, and blending.
    const texturedGround = hasWorld && !grayBox && bakeGround(rect.width, rect.height);

    // Paint the whole canvas with the bar color first.
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.05, 0.035, 0.03, 1.0);   // near-black brown bars
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Then paint the ground only inside the world's rectangle.
    // The scissor test limits clearing (and drawing) to a rectangle of pixels.
    if (!hasWorld) {
      return;   // canvas has no size (for example a minimized window): nothing to draw
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height));
    const proj = projection(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height);
    if (texturedGround) {
      drawGround(proj);                        // step 10b: the baked lawn
    } else {
      gl.clearColor(0.11, 0.08, 0.06, 1.0);    // gray-box look (G): flat dark brown ground
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Blending, so fading leaves (and the void's soft edges) mix with what is already drawn:
    //   color = source * sourceAlpha + destination * (1 - sourceAlpha)
    // The canvas's own alpha is kept at 1 (factors ZERO, ONE for alpha), otherwise the page would
    // show through the canvas wherever a leaf is half faded.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

    // The void first, so the leaves are drawn on top of it.
    drawVoid(proj);

    if (leafCount > 0) {
      drawLeaves(proj);
    }
    // Obstacles over the leaves (a leaf brushing a rock looks tucked under it), then debug rings.
    drawCircles(proj);
  }

  function drawLeaves(proj) {

    // Send this frame's leaf data to the GPU. Only the part in use is copied:
    // bufferSubData(target, byte offset in the buffer, source array, first element, element count).
    gl.bindBuffer(gl.ARRAY_BUFFER, leafBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, leafData, 0, leafCount * FLOATS_PER_LEAF);

    // Draw every leaf with ONE call. The scissor stays on, so a leaf can never be drawn over the bars.
    gl.useProgram(program);
    gl.uniformMatrix3fv(uProjection, false, proj);
    gl.uniform1f(uGrayBox, grayBox ? 1 : 0);
    const shape = grayBox ? rectShape : leafShape;
    gl.bindVertexArray(shape.vao);
    // The shape's vertices as one strip (24 triangles for the leaf, 2 for the rectangle),
    // repeated for leafCount leaves.
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, shape.count, leafCount);
    gl.bindVertexArray(null);
  }

  return {
    gl, render, setLeaves, setVoid, setObstacles, setDebug, setGrayBox,
    groundBakes: () => bakes,   // how many times the ground was baked (for tests)
  };
}
