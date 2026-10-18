// On-device face matching for check-in, using face-api (MIT, github.com/vladmandic/face-api).
// The selfie is turned into 128 numbers on the phone and compared with the employee's reference.
// The library and models (about 8 MB) load only when someone checks in, then the browser caches them.
window.AllurusFace = (function () {
  'use strict';
  const BASE = 'js/vendor/face/';
  // Euclidean distance between face descriptors: the same person is usually well under 0.5.
  const MATCH = 0.5, WEAK = 0.6;
  let ready = null;

  function load() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const go = async () => {
        try {
          const fa = window.faceapi;
          // Use the phone's GPU (WebGL), or the CPU when that isn't available. The WASM backend isn't bundled.
          if (!(await fa.tf.setBackend('webgl').catch(() => false))) await fa.tf.setBackend('cpu');
          await fa.tf.ready();
          await Promise.all([
            fa.nets.tinyFaceDetector.loadFromUri(BASE),
            fa.nets.faceLandmark68Net.loadFromUri(BASE),
            fa.nets.faceRecognitionNet.loadFromUri(BASE),
          ]);
          resolve(fa);
        } catch (e) { ready = null; reject(e); }
      };
      if (window.faceapi) { go(); return; }
      const s = document.createElement('script');
      s.src = BASE + 'face-api.js?v=1.7.15';
      s.onload = go;
      s.onerror = () => { ready = null; reject(new Error('The face check could not load.')); };
      document.head.appendChild(s);
    });
    return ready;
  }

  // Copy any image, canvas or video frame onto a canvas, optionally rotated about a point and brightened.
  function toCanvas(src, { angle = 0, cx = 0, cy = 0, filter = '' } = {}) {
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    const k = Math.min(1, 720 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    if (filter) ctx.filter = filter;
    if (angle) { ctx.translate(cx * k, cy * k); ctx.rotate(angle); ctx.translate(-cx * k, -cy * k); }
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  const centre = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

  async function detect(fa, c, inputSize) {
    return fa.detectAllFaces(c, new fa.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.3 })).withFaceLandmarks().withFaceDescriptors();
  }

  // Every face found in an image, canvas or video frame. Dim photos get a second, brightened look,
  // and a tilted face is levelled at the eyes before its descriptor is taken.
  async function describe(source) {
    const fa = await load();
    let base = toCanvas(source);
    let found = await detect(fa, base, 416);
    if (!found.length) found = await detect(fa, base, 608);
    if (!found.length) { base = toCanvas(source, { filter: 'brightness(1.6) contrast(1.15)' }); found = await detect(fa, base, 512); }
    const out = [];
    for (const f of found) {
      let best = f;
      const l = centre(f.landmarks.getLeftEye()), r = centre(f.landmarks.getRightEye());
      const angle = Math.atan2(r.y - l.y, r.x - l.x);
      if (found.length === 1 && Math.abs(angle) > 0.05) {
        const level = toCanvas(base, { angle: -angle, cx: (l.x + r.x) / 2, cy: (l.y + r.y) / 2 });
        const again = await detect(fa, level, 416);
        if (again.length) best = again.sort((a, b) => b.detection.score - a.detection.score)[0];
      }
      out.push({ descriptor: Array.from(best.descriptor, (v) => +v.toFixed(5)), score: f.detection.score });
    }
    return out;
  }

  const distance = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
  const verdict = (d) => (d <= MATCH ? 'match' : d <= WEAK ? 'weak' : 'mismatch');
  const similarity = (d) => Math.max(0, Math.min(100, Math.round((1 - d) * 100)));

  return { load, describe, distance, verdict, similarity, MATCH, WEAK };
})();
