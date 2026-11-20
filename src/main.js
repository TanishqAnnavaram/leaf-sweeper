import { createRenderer } from './renderer.js';
import { createLeaf, setLeafValues, stepLeaf } from './physics.js';
import { createLoop } from './loop.js';

const canvas = document.querySelector('#game');
const errorBox = document.querySelector('#error');
const pausedLabel = document.querySelector('#paused');

// Show a problem on the page as well as in the console.
function showError(err) {
  errorBox.textContent = err.message;
  errorBox.hidden = false;
  console.error(err);
}

try {
  const renderer = createRenderer(canvas);
  const leaf = createLeaf();   // starts at (-600, -300), moving up and to the right

  // Every frame: move the leaf (unless paused), then draw it.
  // The loop also redraws after a window resize, because render() checks the canvas size each frame.
  const loop = createLoop({
    update(dt) {
      stepLeaf(leaf, dt);
    },
    render() {
      renderer.setLeaf(leaf);
      renderer.render();
    },
    onError: showError,
  });

  // P pauses and unpauses. e.repeat is true while the key is held down, so holding P toggles only once.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && !e.repeat) {
      pausedLabel.hidden = !loop.togglePaused();
    }
  });

  loop.start();

  // Debug handle for the browser console. For example:
  //   leafDebug.setLeaf({ x: 400, y: 200, vx: -150, vy: 0 })
  //   leafDebug.setLeaf({ angle: Math.PI / 4, scale: 3 })
  //   leafDebug.getLeaf()
  //   leafDebug.reset()      relaunch from the start values
  window.leafDebug = {
    setLeaf(values) {
      setLeafValues(leaf, values);
      return { ...leaf };
    },
    getLeaf() {
      return { ...leaf };   // a copy, so the console cannot change the leaf by accident
    },
    reset() {
      setLeafValues(leaf, createLeaf());
      return { ...leaf };
    },
  };
} catch (err) {
  showError(err);
}
