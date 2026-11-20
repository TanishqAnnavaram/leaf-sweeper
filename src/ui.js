// Developer panel, built with Tweakpane (libs/, MIT license, loaded from our own folder, not a CDN).
// Since step 8 the player steers the wind with the mouse; this panel is hidden (press T) and only
// shows the live wind and the tuning values.
// Tweakpane "binds" a slider to a property of a plain object: moving the slider changes the
// property, and the game reads the property every frame. So the game code never talks to the UI.

import { Pane } from '../libs/tweakpane-4.0.5.min.js';
import { windName } from './physics.js';

// settings: { bearing, speed, friction, topSpeed, gustStrength, gustSize, spinAmount, suction,
//   voidRadius, galeDistance, turnRate, buildTime }. The tuning sliders change these values in place.
// Adds a read-only `strength` property (Calm, Breeze, Wind, Gale) that the panel displays.
export function createControls(settings) {
  const pane = new Pane({ title: 'Developer (T)' });   // appears in the top right corner of the page

  settings.strength = windName(settings.speed, settings.topSpeed);

  // The live wind, read only: the mouse control sets it every frame (step 8).
  // Read-only bindings refresh themselves a few times per second.
  pane.addBinding(settings, 'bearing', { label: 'direction', readonly: true, format: (v) => v.toFixed(0) });
  pane.addBinding(settings, 'speed', { label: 'speed', readonly: true, format: (v) => v.toFixed(0) });

  // Shows the wind's name. Read-only: it refreshes itself a few times per second.
  pane.addBinding(settings, 'strength', { label: '', readonly: true });

  // Tuning values, closed by default, for adjusting the feel of the game.
  const tuning = pane.addFolder({ title: 'Tuning', expanded: false });
  tuning.addBinding(settings, 'friction', { label: 'friction', min: 0.2, max: 5, step: 0.1 });
  tuning.addBinding(settings, 'topSpeed', { label: 'top speed', min: 50, max: 800, step: 10 });
  // Step 6: gusts and tumbling. Gust strength 0 gives the even wind of step 5.
  tuning.addBinding(settings, 'gustStrength', { label: 'gusts', min: 0, max: 1, step: 0.05 });
  tuning.addBinding(settings, 'gustSize', { label: 'gust size', min: 100, max: 800, step: 10 });
  tuning.addBinding(settings, 'spinAmount', { label: 'spin', min: 0, max: 2, step: 0.05 });
  // Step 7: the void's pull and the size of its attraction radius.
  tuning.addBinding(settings, 'suction', { label: 'suction', min: 0, max: 1000, step: 10 });
  tuning.addBinding(settings, 'voidRadius', { label: 'void radius', min: 100, max: 400, step: 10 });
  // Step 8: how the mouse control feels.
  tuning.addBinding(settings, 'galeDistance', { label: 'gale distance', min: 200, max: 900, step: 10 });
  tuning.addBinding(settings, 'turnRate', { label: 'turn rate', min: 45, max: 720, step: 15 });
  tuning.addBinding(settings, 'buildTime', { label: 'build time', min: 0, max: 1.5, step: 0.05 });


  return pane;
}
