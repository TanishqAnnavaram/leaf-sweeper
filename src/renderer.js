import { triangleVertex, triangleFragment } from './shaders.js';

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
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
  }
  return program;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    throw new Error('WebGL2 is not supported in this browser.');
  }

  const program = createProgram(gl, triangleVertex, triangleFragment);
  const aPosition = gl.getAttribLocation(program, 'aPosition');

  // One triangle: three corners, two numbers (x, y) each, in clip space.
  const vertices = new Float32Array([
     0.0,  0.6,   // top
    -0.6, -0.5,   // bottom left
     0.6, -0.5,   // bottom right
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
    gl.clearColor(0.11, 0.08, 0.06, 1.0);   // dark brown background
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);      // draw 3 vertices as one triangle
  }

  return { gl, render };
}
