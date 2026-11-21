// GLSL shader source code, kept in one place.
// Note: "#version 300 es" must be the very first characters of each shader string.

// Vertex shader: runs once per corner of each leaf.
// With instancing, the GPU runs every vertex of the leaf mesh once for every leaf.
//   aPosition    one vertex of the leaf shape, relative to its own center, in world units.
//                Read once per vertex (the same mesh for every leaf).
//   aAlong       0 at the stem end, 1 at the tip (step 10a)
//   aLeaf        this leaf's data: x, y (position), z (angle in radians), w (scale).
//                Read once per leaf, because its "divisor" is 1 (see renderer.js).
//   aFade        this leaf's fade, 1 = solid, 0 = invisible (step 7). Also read once per leaf.
//   aTint        this leaf's color, 0 to 1 (step 10a). Also read once per leaf.
//   uProjection  3x3 matrix that turns world units into clip space (-1 to 1)
//   uGrayBox     1 = the gray-box look of steps 2 to 9 (G key), 0 = the step 10a look
//   vColor       this leaf's base color (palette color times a brightness), passed on to the fragment shader.
//                It is the same for the whole leaf, so it is worked out here, once per vertex (26 times
//                per leaf), instead of once per pixel in the fragment shader (hundreds of times per leaf).
export const leafVertex = `#version 300 es
in vec2 aPosition;
in float aAlong;
in vec4 aLeaf;
in float aFade;
in float aTint;
uniform mat3 uProjection;
uniform float uGrayBox;
flat out vec3 vColor;   // "flat": the same value for the whole leaf, not blended between corners
flat out float vFade;
out float vY;           // not flat: blended across each triangle. The leaf's own y (scale 1, before turning)
out float vHalfWidth;   // half the leaf's width at this point: |y| at each vertex, since every vertex is on the edge
out float vAlong;

// Turn a whole number into a well-mixed number in [0, 1]. This is the "PCG hash":
// multiply, add, and shift the bits so that neighbouring inputs give unrelated outputs.
float hash01(uint n) {
  uint h = n * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  h = (h >> 22u) ^ h;
  return float(h) / 4294967295.0;   // divide by 2^32 - 1
}

// Autumn palette (step 10a): 5 colors at tint 0, 0.25, 0.5, 0.75, 1, blended in a straight line between
// neighbours, so every tint gives its own color.
vec3 palette(float t) {
  vec3 crimson   = vec3(0.62, 0.11, 0.09);
  vec3 redOrange = vec3(0.80, 0.26, 0.08);
  vec3 orange    = vec3(0.88, 0.46, 0.10);
  vec3 gold      = vec3(0.90, 0.68, 0.20);
  vec3 brown     = vec3(0.52, 0.31, 0.15);
  float s = clamp(t, 0.0, 1.0) * 4.0;   // 0 to 4: which pair of colors, and how far between them
  if (s < 1.0) return mix(crimson, redOrange, s);
  if (s < 2.0) return mix(redOrange, orange, s - 1.0);
  if (s < 3.0) return mix(orange, gold, s - 2.0);
  return mix(gold, brown, s - 3.0);
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

  // 5. Color. Gray-box: base orange, brightness 0.85 to 1.15 from this leaf's instance number
  //    (0, 1, 2, ...), as in step 4. Step 10a: the palette color for the leaf's own tint, brightness
  //    0.92 to 1.08 from the tint too, so both move with the leaf when swap-and-pop reorders the list
  //    (the instance number does not).
  if (uGrayBox > 0.5) {
    vColor = vec3(0.85, 0.40, 0.10) * (0.85 + 0.30 * hash01(uint(gl_InstanceID)));
  } else {
    float shade = 0.92 + 0.16 * hash01(uint(clamp(aTint, 0.0, 1.0) * 1000000.0));
    vColor = palette(aTint) * shade;
  }
  vFade = aFade;
  vY = aPosition.y;
  vHalfWidth = abs(aPosition.y);
  vAlong = aAlong;
}`;

// Fragment shader: runs once per pixel a leaf covers.
//   Gray-box (uGrayBox 1): base orange, darker or brighter per leaf (steps 4 to 9).
//   Step 10a: an autumn color picked by the tint, plus a midrib, side veins, a darker rim,
//   a slightly lighter stem end of the blade, and a darker stem. No lighting yet (step 10c).
export const leafFragment = `#version 300 es
precision mediump float;
flat in vec3 vColor;
flat in float vFade;
in float vY;
in float vHalfWidth;
in float vAlong;
// highp to match the vertex shader, which also reads uGrayBox: a uniform used by both shaders must
// have the same precision in both, or the program fails to link.
uniform highp float uGrayBox;
out vec4 outColor;

const float BLADE_START = 0.16;   // along value where the stem meets the blade (see leafmesh.js)

void main() {
  if (uGrayBox > 0.5) {
    outColor = vec4(vColor, vFade);   // alpha = fade: 1 solid, 0 invisible (blending is on)
    return;
  }

  vec3 base = vColor;
  // 0 on the midrib, 1 at the edge. vY and vHalfWidth are both blended straight across each triangle,
  // so |y| / halfWidth is exact on the midrib (y = 0) and on the edge (|y| = halfWidth).
  float across = clamp(abs(vY) / max(vHalfWidth, 0.0001), 0.0, 1.0);

  // A little lighter toward the stem end of the leaf, a little darker toward the tip.
  base *= mix(1.10, 0.95, vAlong);
  // Darker rim: the last 30% toward the edge gets up to 28% darker.
  base *= 1.0 - 0.28 * smoothstep(0.7, 1.0, across);

  // The stem: darker and browner than the blade.
  if (vAlong < BLADE_START) {
    outColor = vec4(mix(base, vec3(0.30, 0.18, 0.08), 0.5) * 0.85, vFade);
    return;
  }

  // Veins. fwidth(x) = how much x changes from this pixel to the next. Using it as the width of the
  // smoothstep makes a line about one pixel soft at any zoom, and makes lines too thin to show fade out
  // instead of flickering.
  float veinColorMix = 0.0;
  float inBlade = smoothstep(BLADE_START, BLADE_START + 0.04, vAlong) * (1.0 - smoothstep(0.93, 0.99, vAlong));

  // Midrib: the center line, 5% of the half-width each side.
  float aa = max(fwidth(across), 0.0001);
  float midrib = 1.0 - smoothstep(0.05, 0.05 + aa, across);
  veinColorMix = max(veinColorMix, 0.40 * midrib * inBlade);

  // Side veins: lines from the midrib toward the edge, slanting toward the tip. A vein sits wherever
  // u * 6 is a whole number, with u = along - 0.12 * across, so a vein moves tipward as it goes outward.
  float u = vAlong - 0.12 * across;
  float d = abs(fract(u * 6.0 + 0.5) - 0.5) / 6.0;   // distance to the nearest vein, in "along" units
  float aaU = max(fwidth(u), 0.0001);
  float vein = 1.0 - smoothstep(0.006, 0.006 + aaU, d);
  float veinReach = smoothstep(0.05, 0.12, across) * (1.0 - smoothstep(0.75, 0.9, across));
  veinColorMix = max(veinColorMix, 0.25 * vein * veinReach * smoothstep(0.22, 0.28, vAlong) * inBlade);

  // Veins are lighter than the blade around them.
  vec3 veinColor = min(base * 1.3 + vec3(0.05, 0.04, 0.01), vec3(1.0));
  outColor = vec4(mix(base, veinColor, veinColorMix), vFade);
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
