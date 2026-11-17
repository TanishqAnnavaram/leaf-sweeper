// GLSL shader source code, kept in one place.
// Note: "#version 300 es" must be the very first characters of each shader string.

// Vertex shader: runs once per corner (vertex) of the leaf.
// It takes a corner of the leaf shape and places it in the world, then on the screen.
//   aPosition    one corner of the leaf, relative to the leaf's own center, in world units
//   uLeaf        this leaf's data: x, y (position), z (angle in radians), w (scale)
//   uProjection  3x3 matrix that turns world units into clip space (-1 to 1)
export const leafVertex = `#version 300 es
in vec2 aPosition;
uniform vec4 uLeaf;
uniform mat3 uProjection;

void main() {
  // 1. Scale the corner around the leaf's center.
  vec2 p = aPosition * uLeaf.w;

  // 2. Rotate it. Positive angles turn counterclockwise.
  float c = cos(uLeaf.z);
  float s = sin(uLeaf.z);
  vec2 rotated = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

  // 3. Move it to the leaf's position in the world.
  vec2 world = rotated + uLeaf.xy;

  // 4. World units to clip space. The 1.0 makes the matrix's translation column apply.
  vec3 clip = uProjection * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

// Fragment shader: runs once per pixel the leaf covers. Here it paints them all orange.
export const leafFragment = `#version 300 es
precision mediump float;
out vec4 outColor;

void main() {
  outColor = vec4(0.85, 0.40, 0.10, 1.0);  // red, green, blue, opacity
}`;
