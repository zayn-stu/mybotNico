/**
 * Map colors to emoji representations for visual feedback in select menus.
 */

const COLOR_EMOJI_MAP = {
  '#FF0000': '🔴', // red
  '#8B0000': '🟥', // darkred
  '#FFA500': '🟠', // orange
  '#FF8C00': '🍊', // darkorange
  '#FFFF00': '🟡', // yellow
  '#00FF00': '🟢', // green
  '#0000FF': '🔵', // blue
  '#800080': '🟣', // purple
  '#FFC0CB': '💗', // pink
  '#A52A2A': '🟫', // brown
  '#808080': '⚫', // gray
  '#FFFFFF': '⚪', // white
  '#000000': '⬛', // black
  '#00FFFF': '🔷', // cyan
  '#FFD700': '⭐', // gold
  '#800000': '🔺', // maroon
  '#008000': '🟩', // darkgreen
  '#4B0082': '🟦', // indigo
  '#DC143C': '♥️', // crimson
  '#FF7F50': '🧡', // coral
  '#006400': '🌲', // forestgreen
  '#228B22': '🌲', // darkgreen alt
  '#87CEEB': '🩵', // skyblue
  '#4169E1': '💙', // royalblue
  '#EE82EE': '💜', // violet
  '#FF00FF': '🩷', // magenta
  '#008080': '🐢', // teal
  '#C0C0C0': '⚙️', // silver
  '#40E0D0': '🧿', // turquoise
  '#FFFFE0': '💛', // lightyellow
};

/**
 * Get emoji for a hex color.
 * Falls back to a generic square emoji if not found.
 */
function getColorEmoji(hex) {
  const upper = hex.toUpperCase();
  return COLOR_EMOJI_MAP[upper] || '🟦'; // default blue square
}

module.exports = { getColorEmoji, COLOR_EMOJI_MAP };
