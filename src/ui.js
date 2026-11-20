// On-screen controls, built with Tweakpane (libs/, MIT license, loaded from our own folder, not a CDN).
// Tweakpane "binds" a slider to a property of a plain object: moving the slider changes the
// property, and the game reads the property every frame. So the game code never talks to the UI.

import { Pane } from '../libs/tweakpane-4.0.5.min.js';
import { windName } from './physics.js';

// settings: { bearing, speed, friction, topSpeed, gustStrength, gustSize, spinAmount }.
// The sliders change these values in place.
// Adds a read-only `strength` property (Calm, Breeze, Wind, Gale) that the panel displays.
export function createControls(settings) {
  const pane = new Pane({ title: 'Wind' });   // appears in the top right corner of the page

  settings.strength = windName(settings.speed, settings.topSpeed);

  // Temporary direction slider: the compass dial replaces it in step 8.
  pane.addBinding(settings, 'bearing', { label: 'direction', min: 0, max: 360, step: 1 });

  // The speed slider's top end is the "top speed" tuning value, so this binding is rebuilt
  // when that value changes. `index` keeps it in the same place in the panel.
  let speedBinding = null;
  function addSpeedSlider() {
    if (speedBinding) {
      speedBinding.dispose();
    }
    settings.speed = Math.min(settings.speed, settings.topSpeed);   // keep the value inside the new range
    speedBinding = pane.addBinding(settings, 'speed', {
      label: 'speed', min: 0, max: settings.topSpeed, step: 1, index: 1,
    });
  }
  addSpeedSlider();

  // Shows the wind's name. Read-only: it refreshes itself a few times per second.
  pane.addBinding(settings, 'strength', { label: '', readonly: true });

  // Tuning values, closed by default, for adjusting the feel of the game.
  const tuning = pane.addFolder({ title: 'Tuning', expanded: false });
  tuning.addBinding(settings, 'friction', { label: 'friction', min: 0.2, max: 5, step: 0.1 });
  const topSpeed = tuning.addBinding(settings, 'topSpeed', { label: 'top speed', min: 50, max: 800, step: 10 });
  topSpeed.on('change', addSpeedSlider);
  // Step 6: gusts and tumbling. Gust strength 0 gives the even wind of step 5.
  tuning.addBinding(settings, 'gustStrength', { label: 'gusts', min: 0, max: 1, step: 0.05 });
  tuning.addBinding(settings, 'gustSize', { label: 'gust size', min: 100, max: 800, step: 10 });
  tuning.addBinding(settings, 'spinAmount', { label: 'spin', min: 0, max: 2, step: 0.05 });

  // Any change: update the name shown under the speed slider.
  pane.on('change', () => {
    settings.strength = windName(settings.speed, settings.topSpeed);
  });

  return pane;
}
