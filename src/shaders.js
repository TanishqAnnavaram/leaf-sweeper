// GLSL shader source code, kept in one place.
// Note: "#version 300 es" must be the very first characters of each shader string.

// Vertex shader: runs once per corner (vertex). Here it passes the position straight through.
// Positions are in "clip space": x and y both run from -1 to 1.
export const triangleVertex = `#version 300 es
in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// Fragment shader: runs once per pixel the triangle covers. Here it paints them all orange.
export const triangleFragment = `#version 300 es
precision mediump float;
out vec4 outColor;

void main() {
  outColor = vec4(0.85, 0.40, 0.10, 1.0);  // red, green, blue, opacity
}`;
