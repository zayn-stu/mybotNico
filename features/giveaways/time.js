/**
 * Parse duration strings like "10m", "2h", "1d" into milliseconds.
 * @param {string} str - Duration string (e.g., "10m", "2h", "1d", "5w")
 * @returns {number|null} Milliseconds or null if invalid
 */
function parseDuration(str) {
  if (!str || typeof str !== 'string') return null;

  const trimmed = str.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);

  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (isNaN(value) || value <= 0) return null;

  const unitMap = {
    // Milliseconds
    ms: 1,
    millisecond: 1,
    milliseconds: 1,

    // Seconds
    s: 1000,
    sec: 1000,
    second: 1000,
    seconds: 1000,

    // Minutes
    m: 60 * 1000,
    min: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,

    // Hours
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,

    // Days
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,

    // Weeks
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
  };

  const multiplier = unitMap[unit];
  if (multiplier === undefined) return null;

  return Math.round(value * multiplier);
}

module.exports = { parseDuration };
