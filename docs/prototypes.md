# Prototype playbook

Use `main` as the clean base. Every experiment lives on its own branch (e.g., `proto/water-caustics`). None of them have to merge back.

## Branch lifecycle

1. `git switch main && git pull`
2. `git switch -c proto/<idea>`
3. Build your sketch (leverage `src/core/*`).
4. Push when you want to share: `git push -u origin proto/<idea>`
5. Archive finished work with a tag or delete the branch.

## Prototype interface

Each file in `src/prototypes/` exports an object with:

```js
export const myPrototype = {
  id: 'unique-id',
  title: 'UI label',
  description: 'Optional longer context',
  tags: ['canvas', 'gpu'],
  background: '#05060a',
  context: '2d' | 'webgl' | 'webgl2',
  toggles: [ /* optional stage toggle descriptors */ ],
  controls: [ /* optional control descriptors */ ],
  create(env) { /* return hooks */ }
}
```

`create(env)` runs once when the prototype is selected. It should return an object with any of these hooks:

- `update({ ctx, gl, now, dt, env })` – called every animation frame.
- `onPointer(event, env)` – receives normalized pointer data (`x`, `y`, `buttons`, modifier keys).
- `onControlChange(key, value, env)` – invoked whenever a UI control changes.
- `onToggleChange(key, value, env)` – fires when a stage toggle button flips.
- `destroy()` – clean up timers, buffers, event listeners.

`env` contains:

- `canvas`, `overlay`
- `ctx` (2d context) or `gl` (WebGL/WebGL2 context)
- `overlayCtx` (2d context mirroring the overlay canvas)
- `size()` – current `{ width, height }` in device pixels
- `setBackground(color)` – convenience fill/clear helper
- `clearOverlay()` – wipes the overlay canvas
- `isPaused()` – returns whether the stage pause toggle is active
- `getToggleState(key)` – reads the current on/off state for a stage toggle

## Controls

Control descriptors power the panel on the left. Supported types:

| type     | fields                                 |
|----------|----------------------------------------|
| `range`  | `min`, `max`, `step`, `value`          |
| `number` | `min`, `max`, `step`, `value`          |
| `checkbox` | `value` (boolean)                    |
| `color`  | `value` hex string                     |
| `select` | `options` (array of strings or `{ label, value }`) |

When the user changes a control, `onControlChange(key, value)` fires.

## Stage toggles

Add lightweight, text-only toggles to the stage overlay by attaching a `toggles` array to your prototype definition. Each entry mirrors the control descriptor shape but only supports:

| field | meaning |
|-------|---------|
| `key` | unique identifier surfaced via `getToggleState(key)` |
| `label` | short uppercase-friendly label rendered on the stage |
| `value` | initial `true`/`false` state |

When a toggle changes, `onToggleChange(key, value)` fires on the active prototype (if implemented) so you can react without polling. You can also query the current state at render time via `env.getToggleState(key)`.

## Reference prototypes

- `flow-field` – CPU canvas example (particles in a flow field)
- `shader-gradient` – WebGL2 fragment shader playground

Duplicate either file to bootstrap a new idea quickly.
