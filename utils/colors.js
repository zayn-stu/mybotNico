const COLOR_NAMES = {
  red: '#FF0000', crimson: '#DC143C', darkred: '#8B0000',
  orange: '#FFA500', darkorange: '#FF8C00', coral: '#FF7F50',
  yellow: '#FFFF00', gold: '#FFD700', lightyellow: '#FFFFE0',
  green: '#00FF00', lime: '#00FF00', darkgreen: '#006400', forestgreen: '#228B22',
  blue: '#0000FF', navy: '#000080', royalblue: '#4169E1', skyblue: '#87CEEB',
  purple: '#800080', violet: '#EE82EE', magenta: '#FF00FF', pink: '#FFC0CB',
  cyan: '#00FFFF', teal: '#008080', aqua: '#00FFFF',
  white: '#FFFFFF', black: '#000000', gray: '#808080', grey: '#808080',
  brown: '#A52A2A', maroon: '#800000', olive: '#808000',
  silver: '#C0C0C0', indigo: '#4B0082', turquoise: '#40E0D0',
};

function parseColor(input) {
  const lower = input.toLowerCase();
  if (COLOR_NAMES[lower]) return COLOR_NAMES[lower];
  if (/^#?[0-9A-Fa-f]{6}$/.test(input)) {
    return input.startsWith('#') ? input : `#${input}`;
  }
  return null;
}

module.exports = { parseColor, COLOR_NAMES };
