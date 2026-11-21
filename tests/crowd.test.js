// Step 9b tests: the pile rules (cell cap and shelter) in src/crowd.js, and the wind scale in physics.
// Run with:  node tests/crowd.test.js

import { test, assert, assertClose, report } from './harness.js';
import { createCrowd, countCells, shelterLeaves, spreadLeaves } from '../src/crowd.js';
import { createLeaf, stepLeaf, createWind, leafRadius } from '../src/physics.js';
import {
  WORLD_WIDTH, WORLD_HEIGHT, CROWD_CELL, PILE_CAP, SPREAD_SPEED, SHELTER, OBSTACLES,
} from '../src/config.js';

const HW = WORLD_WIDTH / 2;
const HH = WORLD_HEIGHT / 2;
const RULES = { cap: PILE_CAP, spreadSpeed: SPREAD_SPEED, shelter: SHELTER, obstacles: OBSTACLES };

// n still leaves at one point, each with its own tint (the tint sets its fan direction).
function pile(n, x, y, extra = {}) {
  const leaves = [];
  for (let i = 0; i < n; i++) {
    leaves.push(createLeaf({ x, y, vx: 0, vy: 0, angle: 0, scale: 1, tint: (i * 0.618034) % 1, ...extra }));
  }
  return leaves;
}

// The most leaves in any one square.
function fullest(crowd, leaves) {
  countCells(crowd, leaves);
  return Math.max(...crowd.counts);
}

// Spread with no wind for `seconds` at `fps` frames per second.
function spreadFor(crowd, leaves, seconds, fps = 30) {
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    countCells(crowd, leaves);
    spreadLeaves(crowd, leaves, 1 / fps, RULES);
  }
}

// Distance from the leaves' middle that 90% of them are within.
function r90(leaves) {
  const cx = leaves.reduce((s, l) => s + l.x, 0) / leaves.length;
  const cy = leaves.reduce((s, l) => s + l.y, 0) / leaves.length;
  const d = leaves.map((l) => Math.hypot(l.x - cx, l.y - cy)).sort((a, b) => a - b);
  return d[Math.floor(0.9 * d.length)];
}

// ---------- Config ----------

test('pile rules: 16-unit squares, 8 leaves per square, spread 180 units/s, shelter 0.3', () => {
  assert(CROWD_CELL === 16 && PILE_CAP === 8, `cell ${CROWD_CELL}, cap ${PILE_CAP}`);
  assert(SPREAD_SPEED === 180 && SHELTER === 0.3, `spread ${SPREAD_SPEED}, shelter ${SHELTER}`);
});

// ---------- Counting ----------

test('the grid covers the world: 100 x 57 squares of 16 units', () => {
  const crowd = createCrowd();
  assert(crowd.cols === 100 && crowd.rows === 57, `${crowd.cols} x ${crowd.rows}`);
  assert(crowd.counts.length === 100 * 57, `counts length ${crowd.counts.length}`);
});

test('leaves are counted in the right squares', () => {
  const crowd = createCrowd();
  const leaves = [
    createLeaf({ x: -HW + 1, y: -HH + 1 }),   // bottom-left square: column 0, row 0
    createLeaf({ x: 0.5, y: 0.5 }),           // column 50, row 28 (y + 450 = 450.5, / 16 = 28.2)
    createLeaf({ x: 0.5, y: 0.5 }),
    createLeaf({ x: HW - 1, y: HH - 1 }),     // top-right square: column 99, row 56
  ];
  countCells(crowd, leaves);
  assert(crowd.counts[0] === 1, `bottom left ${crowd.counts[0]}`);
  assert(crowd.counts[28 * 100 + 50] === 2, `middle ${crowd.counts[28 * 100 + 50]}`);
  assert(crowd.counts[56 * 100 + 99] === 1, `top right ${crowd.counts[56 * 100 + 99]}`);
  assert(crowd.counts.reduce((a, b) => a + b, 0) === 4, 'total');
});

test('caught leaves and leaves with a broken position are not counted', () => {
  const crowd = createCrowd();
  const leaves = [createLeaf({ x: 10, y: 10 }), createLeaf({ x: 10, y: 10, captured: true }), createLeaf({ x: 10, y: 10 })];
  leaves[1].captured = true;
  leaves[2].x = NaN;
  countCells(crowd, leaves);
  assert(crowd.counts.reduce((a, b) => a + b, 0) === 1, `total ${crowd.counts.reduce((a, b) => a + b, 0)}`);
});

test('counting again starts from zero (no leftovers from the last frame)', () => {
  const crowd = createCrowd();
  const leaves = pile(5, 100, 100);
  countCells(crowd, leaves);
  countCells(crowd, leaves);
  assert(crowd.counts.reduce((a, b) => a + b, 0) === 5, 'counted twice');
});

test('more than MAX_LEAVES leaves still works (the arrays grow)', () => {
  const crowd = createCrowd(10);
  const leaves = pile(50, -300, 300);
  countCells(crowd, leaves);
  assert(crowd.counts.reduce((a, b) => a + b, 0) === 50, 'not all counted');
});

// ---------- Shelter ----------

test('shelter: in a square of 20 leaves, the 8 drawn last get full wind, the other 12 get 0.3', () => {
  const crowd = createCrowd();
  const leaves = pile(20, -300, 300);
  countCells(crowd, leaves);
  shelterLeaves(crowd, leaves, RULES);
  leaves.forEach((l, i) => {
    const expected = i >= 12 ? 1 : 0.3;
    assert(l.windScale === expected, `leaf ${i}: ${l.windScale}`);
  });
});

test('shelter: a square at or under the cap gives every leaf full wind', () => {
  const crowd = createCrowd();
  const leaves = pile(8, -300, 300);
  countCells(crowd, leaves);
  shelterLeaves(crowd, leaves, RULES);
  assert(leaves.every((l) => l.windScale === 1), 'a leaf was sheltered');
});

test('shelter: squares are separate (a full square does not shelter its neighbour)', () => {
  const crowd = createCrowd();
  const leaves = [...pile(20, -300, 300), ...pile(3, -300 + CROWD_CELL, 300)];
  countCells(crowd, leaves);
  shelterLeaves(crowd, leaves, RULES);
  assert(leaves.slice(20).every((l) => l.windScale === 1), 'the small square was sheltered');
});

test('shelter: a caught leaf always gets full wind (it ignores the rules)', () => {
  const crowd = createCrowd();
  const leaves = pile(20, -300, 300);
  leaves[0].captured = true;
  countCells(crowd, leaves);
  shelterLeaves(crowd, leaves, RULES);
  assert(leaves[0].windScale === 1, `caught leaf ${leaves[0].windScale}`);
});

test('shelter: a bad shelter value counts as the default 0.3, and is kept in [0, 1]', () => {
  const crowd = createCrowd();
  for (const [value, expected] of [[NaN, SHELTER], [-1, 0], [2, 1]]) {
    const leaves = pile(20, -300, 300);
    countCells(crowd, leaves);
    shelterLeaves(crowd, leaves, { ...RULES, shelter: value });
    assert(leaves[0].windScale === expected, `shelter ${value}: ${leaves[0].windScale}`);
  }
});

// ---------- Wind scale in physics ----------

test('physics: a sheltered leaf (windScale 0.3) heads toward 0.3 times the wind speed', () => {
  const wind = createWind({ bearing: 90, speed: 400, friction: 1.5 });
  const leaf = createLeaf({ x: -600, y: 0, vx: 0, vy: 0, angle: 0, scale: 1 });
  leaf.windScale = 0.3;
  for (let i = 0; i < 180; i++) stepLeaf(leaf, 1 / 60, wind);   // 3 s: 99% of the way there
  assertClose(leaf.vx, 120, 2, 'vx');
});

test('physics: the void pull is never reduced by shelter', () => {
  const wind = createWind({ speed: 0, friction: 1.5, suction: 500, voidRadius: 220 });
  const a = createLeaf({ x: 150, y: 0, vx: 0, vy: 0 });
  const b = createLeaf({ x: 150, y: 0, vx: 0, vy: 0 });
  b.windScale = 0;
  stepLeaf(a, 1 / 30, wind);
  stepLeaf(b, 1 / 30, wind);
  assert(a.vx === b.vx && a.vy === b.vy && a.vx < 0, `full (${a.vx}, ${a.vy}), sheltered (${b.vx}, ${b.vy})`);
});

test('physics: a missing or broken windScale counts as 1, and it is kept in [0, 1]', () => {
  const wind = createWind({ bearing: 90, speed: 400, friction: 1.5 });
  const plain = createLeaf({ x: -600, y: 0, vx: 0, vy: 0 });
  stepLeaf(plain, 1 / 30, wind);
  for (const [scale, same] of [[NaN, true], [undefined, true], [5, true], [-1, false]]) {
    const leaf = createLeaf({ x: -600, y: 0, vx: 0, vy: 0 });
    leaf.windScale = scale;
    stepLeaf(leaf, 1 / 30, wind);
    if (same) assert(leaf.vx === plain.vx, `windScale ${scale}: vx ${leaf.vx} vs ${plain.vx}`);
    else assert(leaf.vx === 0, `windScale ${scale}: vx ${leaf.vx} (should be 0)`);
  }
});

// ---------- Spreading ----------

test('a 1000-leaf single-point pile spreads until no square is over the cap within 3 s (no wind)', () => {
  const crowd = createCrowd();
  const leaves = pile(1000, -200, -250);
  spreadFor(crowd, leaves, 3);
  const most = fullest(crowd, leaves);
  assert(most <= PILE_CAP, `fullest square has ${most} leaves`);
});

test('a square at or under the cap is not moved', () => {
  const crowd = createCrowd();
  const leaves = pile(8, -300, 300);
  spreadFor(crowd, leaves, 1);
  assert(leaves.every((l) => l.x === -300 && l.y === 300), 'a leaf moved');
});

test('the push goes toward the emptier side', () => {
  // 20 leaves in a square with 30 leaves in the square to its left and nothing to its right.
  const crowd = createCrowd();
  const target = pile(20, -300 + 8, 300 + 8);
  const left = pile(30, -300 - 8, 300 + 8);
  const leaves = [...left, ...target];
  countCells(crowd, leaves);
  spreadLeaves(crowd, leaves, 1 / 30, RULES);
  const meanDx = target.reduce((s, l) => s + (l.x - (-300 + 8)), 0) / target.length;
  assert(meanDx > 0, `the leaves moved ${meanDx.toFixed(2)} units on average (should be to the right)`);
});

test('spreading is about the same at 30 and 60 frames per second', () => {
  const a = pile(400, -200, -250);
  const b = pile(400, -200, -250);
  spreadFor(createCrowd(), a, 1, 30);
  spreadFor(createCrowd(), b, 1, 60);
  const ra = r90(a);
  const rb = r90(b);
  assert(Math.abs(ra - rb) / Math.max(ra, rb) < 0.15, `30 fps: ${ra.toFixed(1)}, 60 fps: ${rb.toFixed(1)}`);
});

test('a caught leaf is not pushed', () => {
  const crowd = createCrowd();
  const leaves = pile(30, -300, 300);
  leaves[0].captured = true;
  spreadFor(crowd, leaves, 0.5);
  assert(leaves[0].x === -300 && leaves[0].y === 300, `caught leaf moved to (${leaves[0].x}, ${leaves[0].y})`);
});

test('spreading never pushes a leaf out of the world (pile in a corner)', () => {
  const crowd = createCrowd();
  const r = leafRadius(1);
  const leaves = pile(300, HW - r, HH - r);
  spreadFor(crowd, leaves, 2);
  for (const l of leaves) {
    assert(Math.abs(l.x) <= HW - r + 1e-9 && Math.abs(l.y) <= HH - r + 1e-9, `leaf at (${l.x}, ${l.y})`);
  }
});

test('spreading never pushes a leaf into a rock (pile against rock A)', () => {
  const crowd = createCrowd();
  const rock = OBSTACLES[0];
  const r = leafRadius(1);
  const leaves = pile(300, rock.x + rock.radius + r, rock.y);
  spreadFor(crowd, leaves, 2);
  for (const l of leaves) {
    const gap = Math.hypot(l.x - rock.x, l.y - rock.y) - (rock.radius + r);
    assert(gap >= -1e-9, `leaf ${gap.toFixed(3)} inside the rock`);
  }
});

test('broken input: NaN leaves stay out, others stay finite, an empty or missing list does nothing', () => {
  const crowd = createCrowd();
  const leaves = pile(30, -300, 300);
  leaves[3].x = NaN;
  spreadFor(crowd, leaves, 0.5);
  leaves.forEach((l, i) => {
    if (i !== 3) assert(Number.isFinite(l.x) && Number.isFinite(l.y), `leaf ${i} became (${l.x}, ${l.y})`);
  });
  for (const bad of [[], undefined, null]) {
    countCells(crowd, bad);
    shelterLeaves(crowd, bad, RULES);
    spreadLeaves(crowd, bad, 1 / 30, RULES);
  }
  spreadLeaves(crowd, pile(30, 0, 0), NaN, RULES);   // a bad dt moves nothing and does not throw
});

test('a bad dt moves nothing, and a huge dt is clamped to 1/30 s', () => {
  const crowd = createCrowd();
  const still = pile(30, -300, 300);
  countCells(crowd, still);
  spreadLeaves(crowd, still, -1, RULES);
  assert(still.every((l) => l.x === -300 && l.y === 300), 'a negative dt moved a leaf');
  const a = pile(30, -300, 300);
  const b = pile(30, -300, 300);
  countCells(crowd, a);
  spreadLeaves(crowd, a, 5, RULES);
  countCells(crowd, b);
  spreadLeaves(crowd, b, 1 / 30, RULES);
  assert(a.every((l, i) => l.x === b[i].x && l.y === b[i].y), 'dt 5 was not clamped');
});

test('it stays fast with every leaf on one spot: one frame of 1000 leaves under 2 ms (median of 30)', () => {
  const crowd = createCrowd();
  const times = [];
  for (let k = 0; k < 30; k++) {
    const leaves = pile(1000, 700, -400);
    const t0 = performance.now();
    countCells(crowd, leaves);
    shelterLeaves(crowd, leaves, RULES);
    countCells(crowd, leaves);
    spreadLeaves(crowd, leaves, 1 / 30, RULES);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert(times[15] < 2, `median ${times[15].toFixed(3)} ms`);
  console.log(`  one frame, 1000 leaves on one spot: median ${times[15].toFixed(3)} ms`);
});

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.exitCode = report() > 0 ? 1 : 0;
}
