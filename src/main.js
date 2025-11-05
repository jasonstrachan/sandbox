import { bootstrapPrototypeHost } from './core/host.js';
import { prototypes } from './prototypes/index.js';

const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('canvas'));
const overlay = /** @type {HTMLCanvasElement | null} */ (document.getElementById('overlay'));
const controlsRoot = /** @type {HTMLElement | null} */ (document.getElementById('prototype-controls'));
const metaRoot = /** @type {HTMLElement | null} */ (document.getElementById('prototype-meta'));
const seedRoot = /** @type {HTMLElement | null} */ (document.getElementById('seed-controls'));

if (!canvas || !controlsRoot) {
  throw new Error('Prototype host roots are missing from the DOM');
}

bootstrapPrototypeHost({
  canvas,
  overlay,
  controlsRoot,
  metaRoot,
  seedRoot,
  prototypes,
});
