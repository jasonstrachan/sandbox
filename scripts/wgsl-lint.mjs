#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { STRATIFIED_SHADER, GROUND_SHADER } from '../src/stratified/wgsl/renderer.js';
import { DECAY_SHADER, STAMP_SHADER } from '../src/stratified/wgsl/strata.js';

const SHADERS = [
  { name: 'renderer-main', source: STRATIFIED_SHADER },
  { name: 'renderer-ground', source: GROUND_SHADER },
  { name: 'strata-decay', source: DECAY_SHADER },
  { name: 'strata-stamp', source: STAMP_SHADER },
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgsl-lint-'));
const files = SHADERS.map(({ name, source }) => {
  const file = path.join(tmpDir, `${name}.wgsl`);
  fs.writeFileSync(file, source.trimStart());
  return { name, file };
});

function detectTool() {
  const candidates = [
    { cmd: 'wgsl_analyzer', args: (file) => ['check', file], label: 'wgsl_analyzer' },
    { cmd: 'wgsl-analyzer', args: (file) => ['check', file], label: 'wgsl-analyzer' },
    { cmd: 'naga', args: (file) => [file], label: 'naga' },
  ];
  for (const tool of candidates) {
    const probe = spawnSync(tool.cmd, ['--version'], { stdio: 'ignore' });
    if (probe.status === 0) {
      return tool;
    }
  }
  return null;
}

const tool = detectTool();

if (!tool) {
  console.warn('[wgsl-lint] No wgsl_analyzer or naga binary found. Install one and rerun `npm run lint:wgsl`.');
  process.exit(0);
}

let hadError = false;
for (const { name, file } of files) {
  const result = spawnSync(tool.cmd, tool.args(file), { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[wgsl-lint] ${tool.label} reported an issue in ${name}.`);
    hadError = true;
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });

if (hadError) {
  process.exit(1);
}
