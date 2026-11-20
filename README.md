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
```

run the tests that need no browser. With the local server running, http://localhost:8000/tests/ runs all of them plus the rendering tests in the browser.

## Controls

- Wind panel (top right): direction (0 = up, 90 = right) and speed (Calm to Gale). The Tuning folder changes the ground friction, the top wind speed, the gust strength and size, and how much leaves spin.
- `P`: pause and unpause the simulation.
- `F`: hide and show the FPS counter.

In the browser console, `leafDebug.spawn(5000)` replaces the leaves with 5000 new ones (up to 10,000), `leafDebug.reset()` goes back to the normal 1000, `leafDebug.count()` gives the number of leaves, and `leafDebug.getLeaf(0)` shows one leaf's values. `leafDebug.wind` holds the live wind settings and `leafDebug.gusts` the gust time and drift.

## Structure

```
index.html        page and canvas
style.css         layout and look
src/main.js       start-up, keys, FPS display, debug handle
src/ui.js         wind control panel (Tweakpane)
src/loop.js       game loop with a clamped time step (no WebGL)
src/physics.js    leaf movement, wind and drag, gusts, tumbling, world edges, spawning leaves (no WebGL)
src/noise.js      our own 3D Perlin noise for the gusts (no WebGL)
src/random.js     seeded random numbers (no WebGL)
src/fps.js        FPS counter (no WebGL)
src/renderer.js   WebGL setup and instanced drawing
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
- [ ] Step 7 onward: see the build order
