const CONTROL_RENDERERS = {
  range: createRangeInput,
  number: createNumberInput,
  checkbox: createCheckbox,
  color: createColorInput,
  select: createSelect,
};

export function createControlPanel(root) {
  if (!root) throw new Error('controls root missing');

  const inputs = new Map();

  function renderControlGroup(list, container, onChange) {
    list.forEach((control) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'control-row';
      wrapper.dataset.key = control.key;

      const title = document.createElement('span');
      title.textContent = control.label;
      wrapper.appendChild(title);

      const input = renderControl(control);
      inputs.set(control.key, input);

      input.addEventListener('input', (event) => {
        const value = readValue(control.type, event.target);
        onChange(control.key, value);
      });

      wrapper.appendChild(input);
      container.appendChild(wrapper);
    });
  }

  function mount(defs = [], onChange = () => {}) {
    root.innerHTML = '';
    inputs.clear();

    if (!defs.length) {
      const empty = document.createElement('p');
      empty.className = 'control-empty';
      empty.textContent = 'No exposed controls for this prototype.';
      root.appendChild(empty);
      return;
    }

    const controls = defs.map(normalizeControl);
    renderControlGroup(controls, root, onChange);
  }

  function update(key, value) {
    const input = inputs.get(key);
    if (!input) return;

    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  return { mount, update };
}

function normalizeControl(def) {
  if (!def?.key) throw new Error('control requires key');
  return {
    type: def.type || 'range',
    key: def.key,
    label: def.label || def.key,
    min: def.min ?? 0,
    max: def.max ?? 1,
    step: def.step ?? 0.01,
    value: def.value ?? def.defaultValue ?? 0,
    options: def.options || [],
    devOnly: Boolean(def.devOnly),
  };
}


function renderControl(control) {
  const renderer = CONTROL_RENDERERS[control.type];
  if (!renderer) throw new Error(`unsupported control type: ${control.type}`);
  return renderer(control);
}

function createRangeInput({ min, max, step, value }) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  return input;
}

function createNumberInput({ min, max, step, value }) {
  const input = document.createElement('input');
  input.type = 'number';
  if (typeof min === 'number') input.min = String(min);
  if (typeof max === 'number') input.max = String(max);
  input.step = step;
  input.value = value;
  return input;
}

function createCheckbox({ value }) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(value);
  return input;
}

function createColorInput({ value = '#ffffff' }) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  return input;
}

function createSelect({ options = [], value }) {
  const select = document.createElement('select');
  options.forEach((option) => {
    const opt = document.createElement('option');
    if (typeof option === 'string') {
      opt.value = option;
      opt.textContent = option;
    } else {
      opt.value = option.value;
      opt.textContent = option.label;
    }
    select.appendChild(opt);
  });

  if (value !== undefined) select.value = value;
  return select;
}

function readValue(type, input) {
  if (type === 'checkbox') return input.checked;
  if (type === 'number' || type === 'range') return Number(input.value);
  return input.value;
}
