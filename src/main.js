import { createRenderer } from './renderer.js';

const canvas = document.querySelector('#game');
const errorBox = document.querySelector('#error');

try {
  const renderer = createRenderer(canvas);
  renderer.render();
  window.addEventListener('resize', renderer.render);   // redraw when the window changes size
} catch (err) {
  // Show the problem on the page as well as in the console.
  errorBox.textContent = err.message;
  errorBox.hidden = false;
  console.error(err);
}
