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
```

run the math, physics, and game loop tests. With the local server running, http://localhost:8000/tests/ runs all of them plus the rendering tests in the browser.

## Controls

- `P`: pause and unpause the simulation.

In the browser console, `leafDebug.setLeaf({ x, y, vx, vy, angle, scale })`, `leafDebug.getLeaf()`, and `leafDebug.reset()` move, read, and relaunch the leaf.

## Structure

```
index.html        page and canvas
style.css         layout and look
src/main.js       start-up, pause key, debug handle
src/loop.js       game loop with a clamped time step (no WebGL)
src/physics.js    leaf movement and world edges (no WebGL)
src/renderer.js   WebGL setup and drawing
src/shaders.js    GLSL shader code
src/math.js       our own 3x3 matrix math (no WebGL)
src/config.js     shared constants (world size, leaf size, time step, start values)
tests/            test helper, math, physics, loop, and rendering tests
libs/             third-party libraries (none yet)
```

## Build status

- [x] Step 0: project skeleton, canvas clears to a color
- [x] Step 1: shader helpers and one hard-coded triangle
- [x] Step 2: world-to-screen mapping, one leaf quad with position, rotation, scale
- [x] Step 3: game loop with a time step, one leaf at constant velocity
- [ ] Step 4 onward: see the build order
