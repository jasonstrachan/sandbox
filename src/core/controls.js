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

    defs.forEach((def) => {
      const control = normalizeControl(def);
      const wrapper = document.createElement('label');
      wrapper.className = 'control-row';
      wrapper.dataset.key = control.key;

      const title = document.createElement('span');
      title.className = 'control-label';
      title.textContent = control.label;
      wrapper.appendChild(title);

      const input = renderControl(control);
      const readout = createValueReadout(control);
      if (readout) {
        readout.textContent = formatControlValue(control, control.value);
      }
      const inputContainer = document.createElement('div');
      inputContainer.className = 'control-input';
      inputContainer.appendChild(input);
      if (readout) inputContainer.appendChild(readout);
      inputs.set(control.key, { input, readout, control });

      input.addEventListener('input', (event) => {
        const value = readValue(control.type, event.target);
        if (readout) {
          readout.textContent = formatControlValue(control, value);
        }
        onChange(control.key, value);
      });

      wrapper.appendChild(inputContainer);
      root.appendChild(wrapper);
    });
  }

  function update(key, value) {
    const entry = inputs.get(key);
    if (!entry) return;
    const { input, readout, control } = entry;

    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else {
      input.value = value;
    }
    if (readout) {
      readout.textContent = formatControlValue(control, value);
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
  if (typeof min === 'number') input.min = min;
  if (typeof max === 'number') input.max = max;
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

function createValueReadout(control) {
  if (control.type !== 'range') return null;
  const span = document.createElement('span');
  span.className = 'control-value';
  return span;
}

function formatControlValue(control, value) {
  if (value == null || Number.isNaN(value)) return '';
  if (typeof value !== 'number') return String(value);
  const precision = resolvePrecision(control.step);
  return value.toFixed(precision);
}

function resolvePrecision(step) {
  if (!Number.isFinite(step)) return 2;
  const str = step.toString();
  if (str.includes('e')) {
    const [, exp] = str.split('e-');
    return Math.max(Number(exp) || 0, 0);
  }
  const decimal = str.split('.')[1];
  return decimal ? decimal.length : 0;
}
