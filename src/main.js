import { bootstrapPrototypeHost } from './core/host.js';
import { prototypes } from './prototypes/index.js';

const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const picker = document.getElementById('prototype-picker');
const controlsRoot = document.getElementById('prototype-controls');
const metaRoot = document.getElementById('prototype-meta');
const togglesRoot = document.getElementById('stage-toggles');

bootstrapPrototypeHost({
  canvas,
  overlay,
  picker,
  controlsRoot,
  metaRoot,
  togglesRoot,
  prototypes,
});
