import { leafVertex, leafFragment } from './shaders.js';
import { projection, worldRect } from './math.js';
import { WORLD_WIDTH, WORLD_HEIGHT, LEAF_WIDTH, LEAF_HEIGHT } from './config.js';

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
  const uLeaf = gl.getUniformLocation(program, 'uLeaf');
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

  // A VAO remembers how the buffer is laid out, so drawing later is one bind.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);   // STATIC = never changes

  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);  // 2 floats per vertex
  gl.bindVertexArray(null);

  // The one leaf's data: position in world units, angle in radians, scale (1 = normal size).
  const leaf = { x: 0, y: 0, angle: 0, scale: 1 };

  // Change any of the leaf's values. Values that are missing or not finite numbers are ignored,
  // so a bad value (NaN, Infinity, a string) can never reach the GPU.
  function setLeaf(values) {
    if (!values) {
      return;
    }
    for (const key of ['x', 'y', 'angle', 'scale']) {
      const value = values[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        leaf[key] = value;
      }
    }
  }

  function getLeaf() {
    return { ...leaf };   // a copy, so outside code cannot change the leaf by accident
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

    // Draw the leaf. The scissor stays on, so a leaf can never be drawn over the bars.
    gl.useProgram(program);
    gl.uniformMatrix3fv(uProjection, false,
      projection(WORLD_WIDTH, WORLD_HEIGHT, canvas.width, canvas.height));
    gl.uniform4f(uLeaf, leaf.x, leaf.y, leaf.angle, leaf.scale);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);   // 4 corners as a strip = 2 triangles
    gl.bindVertexArray(null);
  }

  return { gl, render, setLeaf, getLeaf };
}
