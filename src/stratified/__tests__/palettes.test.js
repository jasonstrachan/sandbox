import test from 'node:test';
import assert from 'node:assert/strict';

import { getPalette, paletteColorsLinear } from '../palettes.js';

test('getPalette falls back to the first palette when id is unknown', () => {
  const palette = getPalette('does-not-exist');
  const firstPalette = getPalette('oxidized');

  assert.equal(palette.id, firstPalette.id);
  assert.deepEqual(palette.colors, firstPalette.colors);
});

test('paletteColorsLinear converts basic sRGB colors into linear RGBA arrays', () => {
  const palette = {
    colors: {
      primary: '#000000',
      secondary: '#ffffff',
      shadow: '#ff0000',
      sediment: '#00ff00',
    },
  };

  const { primary, secondary, shadow, sediment } = paletteColorsLinear(palette);

  assert.deepEqual(primary, [0, 0, 0, 1]);
  assert.deepEqual(secondary, [1, 1, 1, 1]);
  assert.deepEqual(shadow, [1, 0, 0, 1]);
  assert.deepEqual(sediment, [0, 1, 0, 1]);
});
