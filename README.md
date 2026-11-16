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
```

runs the math tests. With the local server running, http://localhost:8000/tests/ runs the math tests and the rendering tests in the browser.

## Structure

```
index.html        page and canvas
style.css         layout and look
src/main.js       start-up
src/renderer.js   WebGL setup and drawing
src/shaders.js    GLSL shader code
src/math.js       our own 3x3 matrix math (no WebGL)
src/config.js     shared constants (world size, leaf size)
tests/            test helper, math tests, rendering tests
libs/             third-party libraries (none yet)
```

## Build status

- [x] Step 0: project skeleton, canvas clears to a color
- [x] Step 1: shader helpers and one hard-coded triangle
- [x] Step 2: world-to-screen mapping, one leaf quad with position, rotation, scale
- [ ] Step 3 onward: see the build order
