const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDeleteMatchList } = require('../features/partners/deleteFlow');

function makeMatch(index, extra = {}) {
  return {
    id: `broadcast-${index}`,
    source: 'direct',
    createdAt: `2026-01-01T00:0${index % 10}:00.000Z`,
    content: `Broadcast content ${index}`,
    messages: Array.from({ length: index + 1 }, (_, messageIndex) => ({
      serverName: `Server ${messageIndex}`,
      channelName: 'ads',
    })),
    ...extra,
  };
}

test('formatDeleteMatchList renders one page of numbered delete matches', () => {
  const matches = [makeMatch(0), makeMatch(1)];

  const { msg, pageMatches, totalPages } = formatDeleteMatchList(matches, 'content', 0);

  assert.equal(totalPages, 1);
  assert.equal(pageMatches.length, 2);
  assert.match(msg, /\*\*Delete Matches for:\*\* `content`/);
  assert.match(msg, /Page 1\/1/);
  assert.match(msg, /1️⃣/);
  assert.match(msg, /2️⃣/);
  assert.match(msg, /direct/);
  assert.doesNotMatch(msg, /Use ◀️ \/ ▶️ to change pages/);
});

test('formatDeleteMatchList paginates after nine matches', () => {
  const matches = Array.from({ length: 10 }, (_, index) => makeMatch(index));

  const firstPage = formatDeleteMatchList(matches, 'content', 0);
  const secondPage = formatDeleteMatchList(matches, 'content', 1);

  assert.equal(firstPage.totalPages, 2);
  assert.equal(firstPage.pageMatches.length, 9);
  assert.equal(secondPage.pageMatches.length, 1);
  assert.match(firstPage.msg, /Use ◀️ \/ ▶️ to change pages/);
  assert.match(secondPage.msg, /Page 2\/2/);
});

test('formatDeleteMatchList labels fallback matches', () => {
  const { msg } = formatDeleteMatchList([
    makeMatch(0, { source: 'live_scan', isFallback: true }),
  ], 'fallback', 0);

  assert.match(msg, /live_scan fallback/);
});
