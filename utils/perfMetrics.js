/**
 * Simple performance metrics tracker.
 * Provides timing utilities for measuring execution time.
 */

function startTimer() {
  return process.hrtime.bigint();
}

function endTimer(startTime) {
  const endTime = process.hrtime.bigint();
  const durationNs = endTime - startTime;
  const durationMs = Number(durationNs) / 1_000_000;
  return durationMs.toFixed(2);
}

module.exports = { startTimer, endTimer };
