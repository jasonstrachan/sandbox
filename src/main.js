import { bootstrapPrototypeHost } from './core/host.js';
import { prototypes } from './prototypes/index.js';

const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const controlsRoot = document.getElementById('prototype-controls');
const metaRoot = document.getElementById('prototype-meta');
const seedRoot = document.getElementById('seed-controls');

bootstrapPrototypeHost({
  canvas,
  overlay,
  controlsRoot,
  metaRoot,
  seedRoot,
  prototypes,
});
