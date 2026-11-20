// GLSL shader source code, kept in one place.
// Note: "#version 300 es" must be the very first characters of each shader string.

// Vertex shader: runs once per corner of each leaf.
// With instancing, the GPU runs the 4 corners of the leaf shape once for every leaf.
//   aPosition    one corner of the leaf shape, relative to its own center, in world units.
//                Read once per corner (the same 4 corners for every leaf).
//   aLeaf        this leaf's data: x, y (position), z (angle in radians), w (scale).
//                Read once per leaf, because its "divisor" is 1 (see renderer.js).
//   aFade        this leaf's fade, 1 = solid, 0 = invisible (step 7). Also read once per leaf.
//   uProjection  3x3 matrix that turns world units into clip space (-1 to 1)
//   vShade       brightness for this leaf, passed on to the fragment shader
export const leafVertex = `#version 300 es
in vec2 aPosition;
in vec4 aLeaf;
in float aFade;
uniform mat3 uProjection;
flat out float vShade;
flat out float vFade;   // "flat": the same value for the whole leaf, not blended between corners

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
  vFade = aFade;
}`;

// Fragment shader: runs once per pixel a leaf covers. Base orange, made darker or brighter per leaf.
export const leafFragment = `#version 300 es
precision mediump float;
flat in float vShade;
flat in float vFade;
out vec4 outColor;

void main() {
  vec3 baseColor = vec3(0.85, 0.40, 0.10);    // red, green, blue
  outColor = vec4(baseColor * vShade, vFade);   // alpha = fade: 1 solid, 0 invisible (blending is on)
}`;

// ---------- The void (step 7, gray-box look; the swirl shader replaces it in step 10) ----------

// Vertex shader: places one square around the void.
//   aCorner     a corner of the square, from -1 to 1
//   uCenter     the void's center, world units
//   uHalfSize   half the square's width, world units
//   vLocal      this point's offset from the center in world units, blended across the square
export const voidVertex = `#version 300 es
in vec2 aCorner;
uniform mat3 uProjection;
uniform vec2 uCenter;
uniform float uHalfSize;
out vec2 vLocal;

void main() {
  vLocal = aCorner * uHalfSize;
  vec3 clip = uProjection * vec3(uCenter + vLocal, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

// Fragment shader: for each pixel of the square, d = distance from the void's center.
//   d < disc radius            dark disc, a little lighter toward its edge
//   d close to ring radius     faint ring, 2 world units wide
//   anything else              nothing (alpha 0, so the ground shows)
// fwidth(d) is how much d changes from one pixel to the next. Using it as the width of the
// smoothstep gives edges about one pixel soft at any zoom, instead of jagged "stair steps".
export const voidFragment = `#version 300 es
precision highp float;   // distances up to about 224 units: mediump could blur the 2-unit ring
in vec2 vLocal;
uniform float uDiscRadius;
uniform float uRingRadius;
out vec4 outColor;

void main() {
  float d = length(vLocal);
  float aa = max(fwidth(d), 0.001);

  // Disc: 1 inside, 0 outside, with a soft one-pixel edge.
  float disc = 1.0 - smoothstep(uDiscRadius - aa, uDiscRadius + aa, d);
  vec3 discColor = mix(vec3(0.02, 0.012, 0.01), vec3(0.07, 0.045, 0.035), d / max(uDiscRadius, 0.001));

  // Ring: 1 within 1 world unit of the ring radius, fading out over one more pixel.
  float ring = 1.0 - smoothstep(1.0, 1.0 + aa, abs(d - uRingRadius));
  vec3 ringColor = vec3(0.32, 0.23, 0.16);

  // The disc wins where both overlap. The ring is drawn half see-through, so it stays faint.
  float alpha = max(disc, ring * 0.5);
  vec3 color = disc > 0.0 ? discColor : ringColor;
  if (alpha <= 0.0) {
    discard;   // outside both: leave the ground as it is
  }
  outColor = vec4(color, alpha);
}`;

