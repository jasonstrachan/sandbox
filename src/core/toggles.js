export function createToggleBar(root) {
  const entries = new Map();
  let changeHandler = () => {};

  function mount(defs = [], onChange = () => {}) {
    changeHandler = onChange;
    if (!root) return;
    root.innerHTML = '';
    entries.clear();

    defs.forEach((def) => {
      const toggle = normalizeToggle(def);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stage-toggle-button';
      button.dataset.key = toggle.key;
      updateButton(button, toggle);
      button.addEventListener('click', () => {
        toggle.value = !toggle.value;
        updateButton(button, toggle);
        changeHandler(toggle.key, toggle.value);
      });
      root.appendChild(button);
      entries.set(toggle.key, { button, toggle });
    });
  }

  function setState(key, value) {
    if (!entries.has(key)) return;
    const entry = entries.get(key);
    entry.toggle.value = Boolean(value);
    updateButton(entry.button, entry.toggle);
  }

  function destroy() {
    if (!root) return;
    root.innerHTML = '';
    entries.clear();
  }

  return { mount, setState, destroy };
}

function normalizeToggle(def = {}) {
  if (!def.key) throw new Error('toggle requires key');
  return {
    key: def.key,
    label: def.label || def.key,
    hint: def.hint || def.title || def.label || def.key,
    value: Boolean(def.value),
  };
}

function updateButton(button, toggle) {
  const stateText = toggle.value ? 'ON' : 'OFF';
  button.textContent = toggle.label;
  button.setAttribute('aria-pressed', toggle.value ? 'true' : 'false');
  const hint = toggle.hint || toggle.label;
  button.setAttribute('aria-label', `${hint} ${stateText}`);
  button.title = `${hint} (${stateText})`;
}
