import { createRenderer } from './renderer.js';

const canvas = document.querySelector('#game');
const errorBox = document.querySelector('#error');

try {
  const renderer = createRenderer(canvas);
  renderer.render();
  window.addEventListener('resize', renderer.render);   // redraw when the window changes size

  // Debug handle for step 2: move and spin the leaf from the browser console. For example:
  //   leafDebug.setLeaf({ x: 400, y: 200 })
  //   leafDebug.setLeaf({ angle: Math.PI / 4, scale: 3 })
  //   leafDebug.getLeaf()
  window.leafDebug = {
    setLeaf(values) {
      renderer.setLeaf(values);
      renderer.render();          // there is no game loop yet, so redraw right away
      return renderer.getLeaf();
    },
    getLeaf: renderer.getLeaf,
  };
} catch (err) {
  // Show the problem on the page as well as in the console.
  errorBox.textContent = err.message;
  errorBox.hidden = false;
  console.error(err);
}
