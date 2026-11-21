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


// ---------- The ground (step 10b) ----------
// The ground never changes, so it is drawn ("baked") once into a texture, and every frame only draws
// that texture on one square. Baking uses a framebuffer: a target that draws into a texture instead
// of onto the screen.

// Our 3D Perlin noise (src/noise.js), the same steps in GLSL. The shuffled 0 to 255 table comes in as a
// 256 x 1 texture, uPerm (one byte per texel, read back as value / 255). Because the table and the steps
// are the same, perlin(p) here gives the same value as noise(x, y, z) in JavaScript (a test checks it).
// Included in other shaders as text, so it has no "#version" line of its own.
export const perlinGlsl = `
uniform highp sampler2D uPerm;

// perm[i] in noise.js: the table entry at i, wrapped to 0..255 (the JS table is stored twice instead).
// texelFetch reads one texel by its whole-number position, with no filtering.
int perm(int i) {
  return int(texelFetch(uPerm, ivec2(i & 255, 0), 0).r * 255.0 + 0.5);
}

// fade(t) = 6t^5 - 15t^4 + 10t^3: flat at both ends, so there are no creases at the cube edges.
float fadeCurve(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Dot product with one of 12 gradient directions, picked by the low 4 bits of the hash (as in noise.js).
float grad(int hash, float x, float y, float z) {
  int h = hash & 15;
  float u = h < 8 ? x : y;
  float v = h < 4 ? y : ((h == 12 || h == 14) ? x : z);
  return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
}

float perlin(vec3 p) {
  vec3 f = floor(p);
  // Which unit cube (wrapped to 0..255; & works on negative ints too, as in JavaScript) and where inside it.
  int X = int(f.x) & 255;
  int Y = int(f.y) & 255;
  int Z = int(f.z) & 255;
  vec3 q = p - f;
  float u = fadeCurve(q.x);
  float v = fadeCurve(q.y);
  float w = fadeCurve(q.z);
  // Hash the 8 corners of the cube.
  int A = perm(X) + Y;
  int AA = perm(A) + Z;
  int AB = perm(A + 1) + Z;
  int B = perm(X + 1) + Y;
  int BA = perm(B) + Z;
  int BB = perm(B + 1) + Z;
  // Blend the 8 corner values: along x, then y, then z. mix(a, b, t) is lerp(t, a, b) in noise.js.
  float value = mix(
    mix(mix(grad(perm(AA), q.x, q.y, q.z), grad(perm(BA), q.x - 1.0, q.y, q.z), u),
        mix(grad(perm(AB), q.x, q.y - 1.0, q.z), grad(perm(BB), q.x - 1.0, q.y - 1.0, q.z), u), v),
    mix(mix(grad(perm(AA + 1), q.x, q.y, q.z - 1.0), grad(perm(BA + 1), q.x - 1.0, q.y, q.z - 1.0), u),
        mix(grad(perm(AB + 1), q.x, q.y - 1.0, q.z - 1.0), grad(perm(BB + 1), q.x - 1.0, q.y - 1.0, q.z - 1.0), u), v),
    w);
  return clamp(value, -1.0, 1.0);
}
`;

// Bake, vertex shader: one square that covers the whole texture (corners -1 to 1 are its edges).
export const groundBakeVertex = `#version 300 es
in vec2 aCorner;
void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

// Bake, fragment shader: runs once per texel of the ground texture, only when baking.
//   uSize   the texture's size in texels (the world's size on screen, in pixels)
//   uWorld  the world's size in world units (1600 x 900)
export const groundBakeFragment = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
uniform vec2 uWorld;
out vec4 outColor;
${perlinGlsl}

// Fractal noise ("fBm", fractional Brownian motion): 4 layers ("octaves") of noise, each twice as fine
// and half as strong as the one before: big soft shapes with smaller detail on top.
// Total strength 0.5 + 0.25 + 0.125 + 0.0625 = 0.9375. Each octave also moves to another z, so the
// layers are not copies of each other.
float fbm(vec2 p, float z) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * perlin(vec3(p, z));
    p *= 2.0;
    amplitude *= 0.5;
    z += 17.0;
  }
  return sum;
}

void main() {
  // This texel's position in the world: gl_FragCoord is the texel's center in texels, (0, 0) at the
  // bottom left, which is the world's bottom left corner (-800, -450).
  vec2 world = (gl_FragCoord.xy / uSize - 0.5) * uWorld;

  // 1. Large patches, about 250 units across: dark olive grass mixed with dry yellow-green grass.
  //    The fBm here is mostly between -0.23 and 0.21 (10% and 90% of the ground, measured in JavaScript).
  vec3 olive = vec3(0.13, 0.16, 0.07);
  vec3 dry = vec3(0.24, 0.23, 0.11);
  float patches = smoothstep(-0.22, 0.22, fbm(world / 250.0, 0.5));
  vec3 color = mix(olive, dry, patches);

  // 2. Bare dirt spots: brown where a second fBm (another scale and place) is above about 0.185,
  //    which is true for about 12% of the ground. The smoothstep gives them soft edges.
  vec3 dirt = vec3(0.20, 0.14, 0.08);
  float dirtMask = smoothstep(0.16, 0.21, fbm(world / 180.0 + vec2(31.7, -12.3), 5.5));
  color = mix(color, dirt, dirtMask);

  // 3. Fine grain, about 4 units across: plus or minus 6% brightness, so it reads as grass.
  color *= 1.0 + 0.06 * perlin(vec3(world / 4.0, 7.3));

  // 4. Up to 15% darker toward the world's border, fading out 120 units inside it.
  float toBorder = min(uWorld.x * 0.5 - abs(world.x), uWorld.y * 0.5 - abs(world.y));
  color *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 120.0, toBorder));

  outColor = vec4(color, 1.0);
}`;

// Draw, vertex shader: places the baked texture on the world rectangle every frame.
//   aCorner      a corner, -1 to 1
//   uHalfWorld   half the world's size (800, 450), so the square covers the whole world
//   vUv          texture coordinate: (0, 0) at the world's bottom left, (1, 1) at its top right
export const groundVertex = `#version 300 es
in vec2 aCorner;
uniform mat3 uProjection;
uniform vec2 uHalfWorld;
out vec2 vUv;
void main() {
  vUv = aCorner * 0.5 + 0.5;
  vec3 clip = uProjection * vec3(aCorner * uHalfWorld, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

// Draw, fragment shader: read the baked ground texture.
export const groundFragment = `#version 300 es
precision mediump float;
uniform sampler2D uGround;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(uGround, vUv);
}`;
