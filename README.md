# Leaf Sweeper

A 2D wind simulation and game built with raw WebGL2 for a computer graphics course.

## Run locally

Browsers block ES modules when a page is opened as a plain file, so use a tiny local server:

```
cd leaf-sweeper
python -m http.server 8000
```

Then open http://localhost:8000 in your browser. On macOS or Linux the command may be `python3` instead of `python`.

## Tests

```
node tests/math.test.js
node tests/physics.test.js
node tests/loop.test.js
node tests/random.test.js
node tests/fps.test.js
node tests/pack.test.js
node tests/noise.test.js
node tests/void.test.js
node tests/game.test.js
node tests/control.test.js
node tests/obstacles.test.js
node tests/leafmesh.test.js
node tests/tint.test.js
node tests/play.test.js
```

run the tests that need no browser. `play.test.js` has two scripted players (instant aim, and the real mouse-aim controls) that must each win a full game; it runs only in Node. With the local server running, http://localhost:8000/tests/ runs all of them plus the rendering tests in the browser.

## How to play

Hold the mouse button (or a finger) on the field: the wind blows from that spot toward the void, stronger the farther away you hold. Let go and the wind dies down. Blow the leaves into the dark void in the middle. Leaves inside the faint ring are pulled in; leaves that reach the center spiral in and are cleared. Rocks and tree trunks block the way; leaves bounce off them. Clear every leaf to win; your time is the score. Tip: gather leaves in a corner, then blow them diagonally through the void.

## Controls

- Hold on the field: blow from there toward the void (Calm on the void itself, a Gale 600 units or more away).
- Compass (bottom right): shows where the wind blows and how strong it is.
- Bottom bar: cleared leaves, progress, the timer (it starts with the first wind), Reset (new layout) and +100 leaves.
- `R`: reset the scene.
- `D`: show or hide the collision circles of the obstacles (cyan) and the leaves (white).
- `G`: switch to the gray-box look (plain orange rectangles on a flat ground, as before step 10) and back, to compare.
- `T`: show or hide the developer panel: the live wind and the Tuning folder (friction, top speed, gusts, spin, suction, void radius, Gale distance, turn rate, build time).
- `P`: pause and unpause the simulation.
- `F`: hide and show the FPS counter.

In the browser console, `leafDebug.spawn(5000)` replaces the leaves with 5000 new ones (up to 10,000), `leafDebug.reset()` goes back to the normal 1000, `leafDebug.count()` gives the number of leaves, and `leafDebug.getLeaf(0)` shows one leaf's values. `leafDebug.wind` holds the live wind settings, `leafDebug.aim(-800, 450)` and `leafDebug.release()` hold and let go of the "mouse" at a world point, and `leafDebug.gusts` the gust time and drift. `leafDebug.game` shows the score, `leafDebug.leaveOnly(3)` keeps 3 leaves next to the void to test the win, and `leafDebug.advance(4)` runs 4 s of the game at once.

## Structure

```
index.html        page and canvas
style.css         layout and look
src/main.js       start-up, keys, FPS display, debug handle
src/ui.js         developer panel (Tweakpane, press T)
src/loop.js       game loop with a clamped time step (no WebGL)
src/physics.js    leaf movement, wind and drag, gusts, tumbling, world edges, the void, obstacles, spawning (no WebGL)
src/noise.js      our own 3D Perlin noise for the gusts and (on the GPU) the ground (no WebGL)
src/game.js       counter, timer, win, how many leaves +100 may add (no WebGL)
src/control.js    mouse-aim wind: aim, turn limit, build-up (no WebGL)
src/random.js     seeded random numbers (no WebGL)
src/fps.js        FPS counter (no WebGL)
src/renderer.js   WebGL setup, the ground baked into a texture, instanced leaves, the void, instanced obstacles and debug rings
src/leafmesh.js   the leaf shape: Bézier edges turned into a triangle strip (no WebGL)
src/shaders.js    GLSL shader code
src/math.js       our own 3x3 matrix math (no WebGL)
src/config.js     shared constants (world size, leaf size, time step, leaf counts)
tests/            test helper, test files, and the browser test page
libs/             third-party libraries: Tweakpane 4.0.5 (MIT license)
```

## Build status

- [x] Step 0: project skeleton, canvas clears to a color
- [x] Step 1: shader helpers and one hard-coded triangle
- [x] Step 2: world-to-screen mapping, one leaf quad with position, rotation, scale
- [x] Step 3: game loop with a time step, one leaf at constant velocity
- [x] Step 4: 1000 leaves in one instanced draw call, FPS counter
- [x] Step 5: wind and ground drag on all leaves, wind panel
- [x] Step 6: noise gusts and tumbling
- [x] Step 7: the void, cleared counter, timer, win screen (first playable version)
- [x] Step 8: mouse-aim wind (hold to blow), wind compass, Reset Scene, +100 leaves
- [x] Step 9: obstacles (rocks and trunks) with bouncing, debug circles
- [x] Step 10a: Bézier leaf shape and autumn colors, gray-box look on G
- [x] Step 10b: ground texture (an autumn lawn from our own noise on the GPU, baked once)
- [ ] Step 10c onward: see the build order
