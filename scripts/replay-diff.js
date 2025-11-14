#!/usr/bin/env node
import fs from 'node:fs';

const [,, baselinePath, samplePath] = process.argv;
if (!baselinePath || !samplePath) {
  console.error('Usage: node scripts/replay-diff.js <baseline.json> <sample.json>');
  process.exit(1);
}

function readMap(path) {
  const raw = fs.readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

const baseline = readMap(baselinePath);
const sample = readMap(samplePath);
const diffs = [];
const frames = new Set([...Object.keys(baseline), ...Object.keys(sample)]);
frames.forEach((frame) => {
  if (baseline[frame] !== sample[frame]) {
    diffs.push({ frame: Number(frame), baseline: baseline[frame], sample: sample[frame] });
  }
});

if (!diffs.length) {
  console.log('Replay diff: no mismatches.');
} else {
  console.log(`Replay diff: ${diffs.length} mismatches`);
  diffs.slice(0, 20).forEach((diff) => {
    console.log(`#${diff.frame}: expected ${diff.baseline}, got ${diff.sample}`);
  });
}
