# Leaf Sweeper

A 2D wind simulation and game built with raw WebGL2 for a computer graphics course.

## Run locally

Browsers block ES modules when a page is opened as a plain file, so use a tiny local server:

```
cd leaf-sweeper
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

## Structure

```
index.html        page and canvas
style.css         layout and look
src/main.js       start-up
src/renderer.js   WebGL setup and drawing
src/shaders.js    GLSL shader code
libs/             third-party libraries (none yet)
```

## Build status

- [x] Step 0: project skeleton, canvas clears to a color
- [x] Step 1: shader helpers and one hard-coded triangle
- [ ] Step 2 onward: see the build order
