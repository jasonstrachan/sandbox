import { bootstrapPrototypeHost } from './core/host.js';
import { prototypes } from './prototypes/index.js';

const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('canvas'));
const overlay = /** @type {HTMLCanvasElement | null} */ (document.getElementById('overlay'));
const controlsRoot = /** @type {HTMLElement | null} */ (document.getElementById('prototype-controls'));
const metaRoot = /** @type {HTMLElement | null} */ (document.getElementById('prototype-meta'));
const seedRoot = /** @type {HTMLElement | null} */ (document.getElementById('seed-controls'));
const picker = /** @type {HTMLSelectElement | null} */ (document.getElementById('prototype-picker'));

if (!canvas || !controlsRoot) {
  throw new Error('Prototype host roots are missing from the DOM');
}

const initialPrototypeId = getInitialPrototypeId();

const host = bootstrapPrototypeHost({
  canvas,
  overlay,
  controlsRoot,
  metaRoot,
  seedRoot,
  prototypes,
  initialPrototypeId,
});

initPrototypePicker(picker, prototypes, initialPrototypeId, host.loadPrototype);

function getInitialPrototypeId() {
  const fallback = prototypes[0]?.id ?? null;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('prototype') || fallback;
  } catch {
    return fallback;
  }
}

function initPrototypePicker(element, defs, initialId, loadPrototype) {
  if (!(element instanceof HTMLSelectElement)) return;
  element.innerHTML = '';
  defs.forEach((proto) => {
    const option = document.createElement('option');
    option.value = proto.id;
    option.textContent = proto.title || proto.id;
    element.appendChild(option);
  });

  const defaultId = initialId ?? defs[0]?.id ?? '';
  if (defaultId) {
    element.value = defaultId;
  }

  element.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const nextId = target.value;
    if (!nextId || typeof loadPrototype !== 'function') return;
    updatePrototypeQuery(nextId);
    try {
      const maybePromise = loadPrototype(nextId);
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch((error) => {
          console.error('Failed to load prototype', error);
        });
      }
    } catch (error) {
      console.error('Failed to load prototype', error);
    }
  });
}

function updatePrototypeQuery(id) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const params = new URLSearchParams(window.location.search);
  if (id) {
    params.set('prototype', id);
  } else {
    params.delete('prototype');
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next);
}
