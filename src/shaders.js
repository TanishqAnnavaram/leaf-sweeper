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



// ---------- Circles: obstacles and debug rings (step 9) ----------
// One small program draws many circles with one instanced call. Each circle is a square
// (2 triangles) around it; the fragment shader keeps only the pixels inside (or on the outline).

// Vertex shader.
//   aCorner      a corner of the square, from -1 to 1 (the same 4 corners for every circle)
//   aCircle      this circle's data, read once per circle (divisor 1):
//                  obstacles: (x, y, radius, kind)        kind 0 = rock, 1 = trunk
//                  leaves:    (x, y, angle, scale)        the leaf buffer, read as-is for debug rings
//   uLeafRadius  0 for obstacles; for leaf rings, the radius of a scale-1 leaf, so radius = scale * it
//   vLocal       this pixel's offset from the circle's center, in world units
export const circleVertex = `#version 300 es
in vec2 aCorner;
in vec4 aCircle;
uniform mat3 uProjection;
uniform float uLeafRadius;
out vec2 vLocal;
flat out float vRadius;
flat out float vKind;

void main() {
  float radius = uLeafRadius > 0.0 ? abs(aCircle.w) * uLeafRadius : aCircle.z;
  float extent = radius + 3.0;             // half the square: a little bigger than the circle, for the soft edge
  vLocal = aCorner * extent;
  vRadius = radius;
  vKind = uLeafRadius > 0.0 ? 0.0 : aCircle.w;
  vec3 clip = uProjection * vec3(aCircle.xy + vLocal, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

// Fragment shader.
//   uOutline 0: a filled circle. Rocks are grey and a bit darker toward the edge (a hint of a rounded
//               top); trunks are brown with faint growth rings, from a sine of the distance.
//   uOutline 1: only a thin ring at the radius, in uOutlineColor (debug view).
// fwidth(d) = how much the distance changes between neighbouring pixels: about one pixel in world
// units, used as the width of the soft edge so edges look smooth at any zoom.
export const circleFragment = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vRadius;
flat in float vKind;
uniform float uOutline;
uniform vec4 uOutlineColor;
out vec4 outColor;

void main() {
  float d = length(vLocal);
  float aa = max(fwidth(d), 0.001);
  if (uOutline > 0.5) {
    // Ring about 1.5 pixels wide, centred on the radius.
    float ring = 1.0 - smoothstep(0.75 * aa, 1.75 * aa, abs(d - vRadius));
    if (ring <= 0.0) {
      discard;
    }
    outColor = vec4(uOutlineColor.rgb, uOutlineColor.a * ring);
    return;
  }
  float inside = 1.0 - smoothstep(vRadius - aa, vRadius + aa, d);
  if (inside <= 0.0) {
    discard;
  }
  float t = d / max(vRadius, 0.001);       // 0 at the center, 1 at the edge
  vec3 color;
  if (vKind < 0.5) {
    color = mix(vec3(0.50, 0.49, 0.47), vec3(0.33, 0.32, 0.31), t * t);   // rock
  } else {
    float rings = 0.5 + 0.5 * sin(d * 0.9);                                 // trunk growth rings
    color = mix(vec3(0.42, 0.28, 0.16), vec3(0.34, 0.22, 0.12), rings * 0.6);
    color = mix(color, vec3(0.24, 0.15, 0.08), smoothstep(0.85, 1.0, t)); // darker bark edge
  }
  outColor = vec4(color, inside);
}`;
