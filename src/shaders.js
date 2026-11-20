// GLSL shader source code, kept in one place.
// Note: "#version 300 es" must be the very first characters of each shader string.

// Vertex shader: runs once per corner of each leaf.
// With instancing, the GPU runs the 4 corners of the leaf shape once for every leaf.
//   aPosition    one corner of the leaf shape, relative to its own center, in world units.
//                Read once per corner (the same 4 corners for every leaf).
//   aLeaf        this leaf's data: x, y (position), z (angle in radians), w (scale).
//                Read once per leaf, because its "divisor" is 1 (see renderer.js).
//   uProjection  3x3 matrix that turns world units into clip space (-1 to 1)
//   vShade       brightness for this leaf, passed on to the fragment shader
export const leafVertex = `#version 300 es
in vec2 aPosition;
in vec4 aLeaf;
uniform mat3 uProjection;
flat out float vShade;   // "flat": the same value for the whole leaf, not blended between corners

// Turn a whole number into a well-mixed number in [0, 1]. This is the "PCG hash":
// multiply, add, and shift the bits so that neighbouring inputs give unrelated outputs.
float hash01(uint n) {
  uint h = n * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  h = (h >> 22u) ^ h;
  return float(h) / 4294967295.0;   // divide by 2^32 - 1
}

void main() {
  // 1. Scale the corner around the leaf's center.
  vec2 p = aPosition * aLeaf.w;

  // 2. Rotate it. Positive angles turn counterclockwise.
  float c = cos(aLeaf.z);
  float s = sin(aLeaf.z);
  vec2 rotated = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

  // 3. Move it to the leaf's position in the world.
  vec2 world = rotated + aLeaf.xy;

  // 4. World units to clip space. The 1.0 makes the matrix's translation column apply.
  vec3 clip = uProjection * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // 5. Brightness from 0.85 to 1.15, picked from this leaf's instance number (0, 1, 2, ...).
  vShade = 0.85 + 0.30 * hash01(uint(gl_InstanceID));
}`;

// Fragment shader: runs once per pixel a leaf covers. Base orange, made darker or brighter per leaf.
export const leafFragment = `#version 300 es
precision mediump float;
flat in float vShade;
out vec4 outColor;

void main() {
  vec3 baseColor = vec3(0.85, 0.40, 0.10);    // red, green, blue
  outColor = vec4(baseColor * vShade, 1.0);   // 1.0 = fully opaque
}`;
