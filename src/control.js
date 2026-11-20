// Mouse-aim wind control (step 8): hold the mouse button (or a finger) on the field, and the wind
// blows from the cursor toward the void. No WebGL and no page elements here, so it is tested in Node;
// main.js turns pointer events into calls to setPointer.

import {
  VOID_X, VOID_Y, WORLD_WIDTH, WORLD_HEIGHT, MAX_DT, WIND_MAX_SPEED, WIND_START,
  AIM_CALM_RADIUS, AIM_GALE_DISTANCE, WIND_TURN_RATE, WIND_BUILD_TIME,
} from './config.js';
import { screenToWorld } from './math.js';

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Keep a bearing in [0, 360).
function wrapDegrees(degrees) {
  const d = degrees % 360;
  return d < 0 ? d + 360 : d;
}

// The settings the control reads, with safe defaults for anything missing or broken.
function readParams(params = {}) {
  return {
    topSpeed: isNumber(params.topSpeed) && params.topSpeed >= 0 ? params.topSpeed : WIND_MAX_SPEED,
    galeDistance: isNumber(params.galeDistance) ? params.galeDistance : AIM_GALE_DISTANCE,
    turnRate: isNumber(params.turnRate) && params.turnRate > 0 ? params.turnRate : WIND_TURN_RATE,
    // 0 is allowed and means "change instantly"; only negative or broken values use the default.
    buildTime: isNumber(params.buildTime) && params.buildTime >= 0 ? params.buildTime : WIND_BUILD_TIME,
  };
}

// The wind the player is asking for with the cursor at world point (x, y).
//   direction: from the cursor toward the void, as a compass bearing (0 = up, 90 = right).
//              The vector from cursor to void is (VOID_X - x, VOID_Y - y), and a compass bearing
//              uses atan2(x part, y part) (see createWind in physics.js for why x and y swap).
//   strength:  d = distance from the void
//              speed = 0                                                  if d <= calm radius
//              speed = topSpeed * (d - calm) / (galeDistance - calm)      in between
//              speed = topSpeed                                           if d >= galeDistance
// Returns { bearing, speed }, or null for a broken cursor position.
export function aimWind(x, y, params) {
  if (!isNumber(x) || !isNumber(y)) {
    return null;
  }
  const p = readParams(params);
  const dx = VOID_X - x;
  const dy = VOID_Y - y;
  const d = Math.hypot(dx, dy);
  const bearing = wrapDegrees((Math.atan2(dx, dy) * 180) / Math.PI);
  let speed = 0;
  if (d > AIM_CALM_RADIUS) {
    const span = p.galeDistance - AIM_CALM_RADIUS;
    // span <= 0 would divide by zero (or by a negative): then any distance past the calm zone is a Gale.
    const fraction = span > 0 ? Math.min(1, (d - AIM_CALM_RADIUS) / span) : 1;
    speed = p.topSpeed * fraction;
  }
  return { bearing, speed };
}

// The control's state: whether the pointer is held, where (in world units), and the real wind it
// produces (bearing and speed), which changes smoothly toward the aim.
export function createWindControl({ bearing = WIND_START.bearing } = {}) {
  return { holding: false, x: 0, y: 0, bearing: wrapDegrees(isNumber(bearing) ? bearing : 0), speed: 0 };
}

// Pointer pressed or moved (holding: true, with a world position) or released (holding: false).
// A broken position counts as released, so a bad event can never blow a strange wind.
export function setPointer(control, { holding, x, y } = {}) {
  if (holding && isNumber(x) && isNumber(y)) {
    control.holding = true;
    control.x = x;
    control.y = y;
  } else {
    control.holding = false;
  }
  return control;
}

// Move the real wind toward the aim by dt seconds. Call once per frame from the game loop's update,
// so pausing also freezes the wind.
export function stepWindControl(control, dt, params) {
  if (!isNumber(dt) || dt <= 0) {
    return control;
  }
  dt = Math.min(dt, MAX_DT);
  const p = readParams(params);

  // What the player is asking for. Not holding, or holding on the void itself: Calm, same direction.
  let targetBearing = control.bearing;
  let targetSpeed = 0;
  if (control.holding) {
    const aim = aimWind(control.x, control.y, p);
    if (aim && aim.speed > 0) {
      targetBearing = aim.bearing;
      targetSpeed = aim.speed;
    }
  }

  if (control.speed < 1 && targetSpeed > 0) {
    // Starting from (nearly) Calm: there is no wind to turn, so it starts straight in the new direction.
    control.bearing = targetBearing;
  } else {
    // Turn the short way around, at most turnRate * dt degrees this frame.
    // diff is the signed turn needed, in [-180, 180): +90 means 90 degrees clockwise.
    let diff = wrapDegrees(targetBearing - control.bearing + 180) - 180;
    if (diff === -180) {
      diff = 180;   // an exact reversal: turn clockwise, so the choice never flickers between sides
    }
    const maxTurn = p.turnRate * dt;
    control.bearing = wrapDegrees(control.bearing + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  }

  // Speed approaches the target with the same exact exponential as the drag:
  //   speed = target + (speed - target) * e^(-dt / buildTime)
  // so it never overshoots and behaves the same at any frame rate. buildTime 0 means instant.
  if (p.buildTime > 0) {
    control.speed = targetSpeed + (control.speed - targetSpeed) * Math.exp(-dt / p.buildTime);
  } else {
    control.speed = targetSpeed;
  }
  // An exponential never quite reaches 0, so snap a dying wind to exactly Calm.
  if (targetSpeed === 0 && control.speed < 0.5) {
    control.speed = 0;
  }
  return control;
}

// A pointer event's position (clientX, clientY, in CSS pixels on the page) to a world position.
// `rect` is the canvas's getBoundingClientRect(): its place and size on the page, also in CSS pixels.
// Both are CSS pixels, so the screen's pixel ratio does not matter here.
export function pointerToWorld(clientX, clientY, rect) {
  return screenToWorld(clientX - rect.left, clientY - rect.top, WORLD_WIDTH, WORLD_HEIGHT, rect.width, rect.height);
}
