// Face counting for selfie check-in: confidence, size, shape and overlap filters on one still frame.
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('../js/face.js');
const F = window.AllurusFace;
const det = (score, x, y, w, h = w * 1.2) => ({ score, box: { x, y, width: w, height: h } });

test('one face with many overlapping boxes counts once', () => {
  const dets = [det(0.92, 200, 150, 300), det(0.85, 210, 160, 290), det(0.7, 190, 140, 310)];
  assert.equal(F.filterFaces(dets, 720).length, 1);
});
test('hundreds of weak or tiny boxes on a plain background are ignored', () => {
  const noise = Array.from({ length: 226 }, (_, i) => det(i % 2 ? 0.35 : 0.8, (i * 13) % 700, (i * 7) % 700, 20));
  assert.equal(F.filterFaces([det(0.9, 220, 160, 280), ...noise], 720).length, 1);
});
test('extreme aspect ratios are not faces', () => {
  assert.equal(F.filterFaces([det(0.9, 100, 100, 300, 40), det(0.9, 100, 100, 120, 600)], 720).length, 0);
});
test('two separate people are two faces', () => {
  assert.equal(F.filterFaces([det(0.9, 20, 100, 200), det(0.88, 450, 100, 200)], 720).length, 2);
});
test('no detections means no face', () => {
  assert.equal(F.filterFaces([], 720).length, 0);
});
