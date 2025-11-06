const CONTROL_RENDERERS = {
  range: createRangeInput,
  number: createNumberInput,
  checkbox: createCheckbox,
  color: createColorInput,
  select: createSelect,
  toggle: createToggleButton,
  action: createActionButton,
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

      const { element, input } = renderControl(control);
      input.dataset.controlType = control.type;
      inputs.set(control.key, input);

      input.addEventListener('input', (event) => {
        const value = readValue(control.type, event.target);
        syncInputDisplay(input, value);
        onChange(control.key, value);
      });

      syncInputDisplay(input);
      wrapper.appendChild(element);
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

    const controlType = input.dataset.controlType || input.type;
    if (controlType === 'checkbox') {
      input.checked = Boolean(value);
    } else if (controlType === 'toggle') {
      setToggleButtonState(input, Boolean(value));
    } else {
      input.value = value;
    }

    syncInputDisplay(input, value);
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
    onLabel: def.onLabel,
    offLabel: def.offLabel,
    actionLabel: def.actionLabel,
    devOnly: Boolean(def.devOnly),
  };
}


function renderControl(control) {
  const renderer = CONTROL_RENDERERS[control.type];
  if (!renderer) throw new Error(`unsupported control type: ${control.type}`);
  return renderer(control);
}

function createRangeInput({ min, max, step, value }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'control-range';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  const display = document.createElement('span');
  display.className = 'control-value';
  input.__controlValueLabel = display;
  input.__controlPrecision = getStepPrecision(step);
  wrapper.appendChild(input);
  wrapper.appendChild(display);
  return { element: wrapper, input };
}

function createNumberInput({ min, max, step, value }) {
  const input = document.createElement('input');
  input.type = 'number';
  if (typeof min === 'number') input.min = String(min);
  if (typeof max === 'number') input.max = String(max);
  input.step = step;
  input.value = value;
  return { element: input, input };
}

function createCheckbox({ value }) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(value);
  return { element: input, input };
}

function createColorInput({ value = '#ffffff' }) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  return { element: input, input };
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
  return { element: select, input: select };
}

function readValue(type, input) {
  if (type === 'checkbox') return input.checked;
  if (type === 'toggle') return input.dataset.state === 'on';
  if (type === 'action') return Number(input.value) || 0;
  if (type === 'number' || type === 'range') return Number(input.value);
  return input.value;
}

function createToggleButton({ value = false, onLabel = 'On', offLabel = 'Off' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control-toggle';
  button.dataset.onLabel = onLabel;
  button.dataset.offLabel = offLabel;
  setToggleButtonState(button, Boolean(value));

  button.addEventListener('click', () => {
    const next = !(button.dataset.state === 'on');
    setToggleButtonState(button, next);
    button.dispatchEvent(new Event('input', { bubbles: true }));
  });

  return { element: button, input: button };
}

function createActionButton({ actionLabel = 'Run' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control-action';
  button.textContent = actionLabel;
  button.value = '0';
  button.addEventListener('click', () => {
    const activations = Number(button.value) || 0;
    button.value = String(activations + 1);
    button.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { element: button, input: button };
}

function setToggleButtonState(button, state) {
  const onLabel = button.dataset.onLabel || 'On';
  const offLabel = button.dataset.offLabel || 'Off';
  button.dataset.state = state ? 'on' : 'off';
  button.value = state ? 'true' : 'false';
  button.setAttribute('aria-pressed', String(state));
  button.textContent = state ? onLabel : offLabel;
}

function syncInputDisplay(input, explicitValue) {
  const label = input?.__controlValueLabel;
  if (!label) return;
  const precision = typeof input.__controlPrecision === 'number' ? input.__controlPrecision : getStepPrecision(input.step);
  label.textContent = formatControlValue(explicitValue ?? input.value, precision);
}

function getStepPrecision(step) {
  if (typeof step !== 'number') return 2;
  const parts = step.toString().split('.');
  return parts[1]?.length ?? 0;
}

function formatControlValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return value != null ? String(value) : '';
  }
  const digits = Math.min(6, Math.max(0, precision));
  return num.toFixed(digits);
}
