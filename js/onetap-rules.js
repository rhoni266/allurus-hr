// One-tap selfie check-in: the pure rules (no DOM), unit tested in tests/onetap.test.js.
// Staff tap Check in (or Check out) once. The location check and the camera start together, and the punch is saved
// the moment the place is inside the zone and a face has been steady for HOLD_MS. Nothing here saves anything: it only
// decides what the screen should say and when to take the photo.
window.AllurusOneTap = (function () {
  'use strict';
  const HOLD_MS = 700;        // a face must be seen steadily this long before the photo is taken
  const NO_FACE_MS = 8000;    // no steady face after this long: offer a manual photo
  const DOUBLE_MS = 60000;    // a second punch of the same type inside this is refused
  const MOVE = 0.35;          // a face box may move this fraction of its own width between looks and still be "steady"

  // In or out is decided by the day's record: someone who is in and not out punches out; anyone else punches in. A second
  // session after a check-out is a new "in", so several sessions a day alternate in, out, in, out.
  function nextKind(rec) {
    if (rec && rec.s === 'leave') return 'in';
    return rec && rec.in && !rec.out ? 'out' : 'in';
  }

  // Tracks whether one face has been in view, not jumping about, for long enough. look(now, box) is called every time the
  // detector runs: box is { x, y, width, height } or null when no single face is seen. Returns the milliseconds it has been steady.
  function steadyTracker(move = MOVE) {
    let since = null, last = null;
    return {
      look(now, box) {
        if (!box) { since = null; last = null; return 0; }
        if (last) {
          const dx = Math.abs((box.x + box.width / 2) - (last.x + last.width / 2)), dy = Math.abs((box.y + box.height / 2) - (last.y + last.height / 2));
          if (dx > move * last.width || dy > move * last.width) since = null;
        }
        if (since == null) since = now;
        last = box;
        return now - since;
      },
      reset() { since = null; last = null; },
    };
  }

  /**
   * What to do now. loc: 'pending' | 'ok' | 'outside' | 'denied' | 'error'. camera: 'pending' | 'ok' | 'denied'.
   * steadyMs: how long a face has been steady. cameraAt: when the camera became ready (ms), now: ms.
   * Returns { action: 'punch' | 'wait' | 'manual' | 'blocked', status }. A punch needs the place AND the face.
   * status is one of: locating, loc-ok, face-wait, face-ok, no-face, outside, loc-denied, loc-error, cam-denied.
   */
  function decide({ loc, camera, steadyMs = 0, cameraAt = null, now = 0 }) {
    if (camera === 'denied') return { action: 'blocked', status: 'cam-denied' };
    if (loc === 'denied') return { action: 'blocked', status: 'loc-denied' };
    if (loc === 'error') return { action: 'blocked', status: 'loc-error' };
    if (loc === 'outside') return { action: 'blocked', status: 'outside' };
    if (loc === 'ok' && camera === 'ok' && steadyMs >= HOLD_MS) return { action: 'punch', status: 'face-ok' };
    if (loc === 'ok' && camera === 'ok' && cameraAt != null && now - cameraAt >= NO_FACE_MS && steadyMs < HOLD_MS) return { action: 'manual', status: 'no-face' };
    if (loc !== 'ok') return { action: 'wait', status: 'locating' };
    return { action: 'wait', status: steadyMs > 0 ? 'face-ok' : camera === 'ok' ? 'face-wait' : 'loc-ok' };
  }

  // No double punch: extra taps while a punch is being made are ignored, and a second punch of the same type inside a minute is refused.
  function guard() {
    let busy = false, last = null;
    return {
      tryStart(kind, now) {
        if (busy) return { ok: false, why: 'busy' };
        if (last && last.kind === kind && now - last.at < DOUBLE_MS) return { ok: false, why: 'again' };
        busy = true; return { ok: true };
      },
      saved(kind, now) { last = { kind, at: now }; busy = false; },
      failed() { busy = false; },
      get busy() { return busy; },
    };
  }

  return { HOLD_MS, NO_FACE_MS, DOUBLE_MS, MOVE, nextKind, steadyTracker, decide, guard };
})();
