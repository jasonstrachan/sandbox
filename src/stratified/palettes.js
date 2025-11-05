export const PALETTES = [
  {
    id: 'oxidized',
    name: 'Oxidized Alloy',
    description: 'Dusty bronze mids with teal shadows, inspired by oxidized packaging foil.',
    colors: {
      primary: '#f6d7b0',
      secondary: '#a6603b',
      shadow: '#28445c',
      sediment: '#6e4f3d',
    },
  },
  {
    id: 'ashfall',
    name: 'Ashfall Drift',
    description: 'Cool grays with muted ember accents for colder strata.',
    colors: {
      primary: '#d9d7d2',
      secondary: '#8b7f84',
      shadow: '#2f3746',
      sediment: '#705c4f',
    },
  },
  {
    id: 'petrol',
    name: 'Petrol Sheen',
    description: 'Iridescent greens and violets referencing oil-slick plastics.',
    colors: {
      primary: '#bed1c1',
      secondary: '#7c9fb5',
      shadow: '#2a1c38',
      sediment: '#4f3b4c',
    },
  },
];

export function getPalette(id = 'oxidized') {
  return PALETTES.find((entry) => entry.id === id) || PALETTES[0];
}

export function paletteColorsLinear(palette) {
  const colors = palette?.colors || {};
  const primary = hexToLinear(colors.primary || '#ffffff');
  const secondary = hexToLinear(colors.secondary || '#d4b59c');
  const shadow = hexToLinear(colors.shadow || '#1a1c1f');
  const sediment = hexToLinear(colors.sediment || '#4a3524');
  return { primary, secondary, shadow, sediment };
}

function hexToLinear(hex) {
  const value = hex.replace('#', '');
  const int = Number.parseInt(value.length === 3 ? value.repeat(2) : value, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1];
}

function srgbToLinear(value) {
  if (value <= 0.04045) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
}
