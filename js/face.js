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

  // Which detections count as faces: confident enough, big enough to be the person holding the phone, roughly
  // face-shaped, and not overlapping a stronger one (non-maximum suppression). Pure, so it is unit-tested.
  const RULES = { minScore: 0.6, iou: 0.3, minWidth: 0.15, minAspect: 0.5, maxAspect: 2 };
  function iou(a, b) {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const inter = x * y, union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
  }
  function filterFaces(dets, imageWidth, rules = RULES) {
    const keep = [];
    const ok = dets.filter((d) => {
      const b = d.box, aspect = b.height / (b.width || 1);
      return d.score >= rules.minScore && b.width >= rules.minWidth * imageWidth && aspect >= rules.minAspect && aspect <= rules.maxAspect;
    }).sort((a, b) => b.score - a.score);
    for (const d of ok) if (!keep.some((k) => iou(k.box, d.box) > rules.iou)) keep.push(d);
    return keep;
  }

  // Detections only (boxes and scores, no landmarks yet), from this one still image.
  async function boxes(fa, c, inputSize) {
    const raw = await fa.detectAllFaces(c, new fa.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 }));
    const dets = raw.map((d) => ({ score: d.score, box: { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height } }));
    const kept = filterFaces(dets, c.width);
    console.info('[face] one capture', { image: `${c.width}×${c.height}`, inputSize, backend: fa.tf.getBackend(), raw: dets.length,
      detections: dets.slice(0, 30).map((d) => `${d.score.toFixed(2)} ${Math.round(d.box.width)}×${Math.round(d.box.height)}`), final: kept.length });
    return kept;
  }
  // Landmarks and descriptor for one accepted box, from a crop around it (so other boxes can't leak in).
  async function describeBox(fa, c, box) {
    const pad = box.width * 0.35, x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
    const w = Math.min(c.width - x, box.width + 2 * pad), h = Math.min(c.height - y, box.height + 2 * pad);
    const crop = document.createElement('canvas'); crop.width = Math.round(w); crop.height = Math.round(h);
    crop.getContext('2d').drawImage(c, x, y, w, h, 0, 0, crop.width, crop.height);
    return fa.detectSingleFace(crop, new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })).withFaceLandmarks().withFaceDescriptor();
  }
  async function detect(fa, c, inputSize) {
    let kept = await boxes(fa, c, inputSize);
    // Some phones' GPUs return garbage from WebGL (hundreds of boxes). Then redo it on the CPU, once.
    if (kept.length > 3 && fa.tf.getBackend() === 'webgl') { console.warn('[face] implausible count on WebGL, retrying on CPU'); await fa.tf.setBackend('cpu'); await fa.tf.ready(); kept = await boxes(fa, c, inputSize); }
    if (kept.length !== 1) return kept.map((d) => ({ detection: { score: d.score }, box: d.box }));
    const one = await describeBox(fa, c, kept[0].box);
    return one ? [one] : [];
  }

  // Every face found in an image, canvas or video frame. Dim photos get a second, brightened look,
  // and a tilted face is levelled at the eyes before its descriptor is taken.
  async function describe(source) {
    const fa = await load();
    let base = toCanvas(source);
    let found = await detect(fa, base, 416);
    if (!found.length) found = await detect(fa, base, 608);
    if (!found.length) { base = toCanvas(source, { filter: 'brightness(1.6) contrast(1.15)' }); found = await detect(fa, base, 512); }
    // More than one face: callers only need the count, to ask for a selfie on their own.
    if (found.length > 1) return found.map((f) => ({ descriptor: null, score: f.detection.score }));
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

  return { load, describe, distance, verdict, similarity, filterFaces, iou, RULES, MATCH, WEAK };
})();
