#! /usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── 1. Redirect data writes to /tmp BEFORE requiring bot modules ────────────
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loadtest-'));
process.env.DATA_DIR = TMPDIR;

const DATA_DIR = path.join(TMPDIR, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

for (const f of [
  'pandas.json', 'bumpTracking.json', 'voiceRewardTracking.json',
  'pandaRuntimeState.json', 'memberRoles.json', 'inviteRewards.json',
  'inviteSnapshots.json', 'roles.json', 'giveaways.json',
  'nicosCavePlayers.json', 'voiceConnections.json',
  'verification.json', 'roundHistory.json', 'victoryPandas.json',
  'pendingAds.json', 'pendingBroadcastDeletes.json', 'broadcastHistory.json',
  'partnerManagers.json',
]) fs.writeFileSync(path.join(DATA_DIR, f), '{}');

fs.copyFileSync(path.join(__dirname, '..', 'data', 'pandaChannels.json'),    path.join(DATA_DIR, 'pandaChannels.json'));
fs.copyFileSync(path.join(__dirname, '..', 'data', 'partnerChannels.json'),  path.join(DATA_DIR, 'partnerChannels.json'));

// ─── 2. Mocks ────────────────────────────────────────────────────────────────
class MockCollection extends Map {
  find(fn) {
    for (const [k, v] of this) if (fn(v, k, this)) return v;
    return undefined;
  }
  filter(fn) {
    const r = new MockCollection();
    for (const [k, v] of this) if (fn(v, k, this)) r.set(k, v);
    return r;
  }
}

function createMockUser(id, name) {
  return { id, username: name, tag: `${name}#0000`, bot: false, displayAvatarURL: () => '' };
}

function createMockGuild(id, name) {
  const emojiCache = new MockCollection();
  emojiCache.set('sn_roohappi', { id: 'e1', name: 'SN_RooHappi', toString: () => '<:SN_RooHappi:e1>' });
  return {
    id, name,
    emojis: { cache: emojiCache },
    members: { cache: new MockCollection(), fetch: async () => new MockCollection() },
    channels: { cache: new MockCollection(), fetch: async () => null },
    roles: { cache: new MockCollection() },
    voiceAdapterCreator: {},
    fetchVanityData: async () => null,
    invites: { fetch: async () => new MockCollection() },
  };
}

function createMockMessage(content, opts = {}) {
  const guildId = opts.guildId || 'loadtest_guild';
  const channelId = opts.channelId || 'loadtest_channel';
  const userId = opts.userId || `u${Math.random().toString(36).slice(2,6)}`;
  const guild = createMockGuild(guildId, 'LoadTest Guild');
  const author = createMockUser(userId, `TestUser_${userId}`);
  const msg = {
    guild,
    author,
    channel: { id: channelId, name: 'test', isTextBased: () => true, send: async () => {} },
    content,
    type: 0,
    embeds: [],
    interaction: null,
    react: async () => {},
    reply: async () => {},
    client: { commands: new Map() },
  };
  return msg;
}

// ─── 3. Imports ──────────────────────────────────────────────────────────────
const { handleMessageCreate } = require('../bot/events/messageCreate');
const { createRuntimeContext } = require('../bot/registerEvents');
const { flushAllWrites } = require('../shared/jsonStore');

const pandaChannels = require('../data/pandaChannels.json');
pandaChannels.loadtest_guild = 'loadtest_channel';

// ─── 4. Context factory ────────────────────────────────────────────────────
function makeContext() {
  const ctx = createRuntimeContext({ channels: { fetch: async () => null } });
  ctx.client.channels = { fetch: async () => null };
  ctx.client.guilds = { cache: new MockCollection() };
  ctx.client.user = { tag: 'TestBot#0000' };
  return ctx;
}

function quiet() {
  const prev = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  return () => {
    console.log = prev[0];
    console.warn = prev[1];
    console.error = prev[2];
  };
}

// ─── 5. Event loop lag tracker ──────────────────────────────────────────────
function trackLag() {
  const samples = [];
  let prev = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    samples.push(Number(now - prev) / 1_000_000);
    prev = now;
  }, 1);

  return {
    stop() { clearInterval(timer); },
    max() { return samples.length > 1 ? Math.max(...samples) : 0; },
  };
}

// ─── 6. Sequential benchmark (one-at-a-time) ────────────────────────────────
async function runSequential(count) {
  const ctx = makeContext();
  const restore = quiet();
  const tracker = trackLag();

  const cpuBefore = process.cpuUsage();
  const memBefore = process.memoryUsage();
  const start = Date.now();
  let errors = 0;

  for (let i = 0; i < count; i++) {
    try {
      await handleMessageCreate(
        createMockMessage('hello', { channelId: 'loadtest_channel', userId: `seq_${i}` }),
        ctx
      );
    } catch { errors++; }
  }

  await flushAllWrites();
  tracker.stop();
  restore();

  const wall = Date.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const mem = process.memoryUsage();

  return {
    label: `Sequential (1×${count})`,
    count, wall,
    ops: Math.round(count / (wall / 1000)),
    cpuTotal: ((cpu.user + cpu.system) / 1000).toFixed(1),
    maxLag: tracker.max(),
    heapDelta: ((mem.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
    errors,
  };
}

// ─── 7. Concurrent burst benchmark ──────────────────────────────────────────
async function runConcurrent(count, batchSize) {
  const ctx = makeContext();
  const restore = quiet();
  const tracker = trackLag();

  // Pre-create all messages with unique user IDs
  const messages = Array.from({ length: count }, (_, i) =>
    createMockMessage('hello', { channelId: 'loadtest_channel', userId: `burst_${i}` })
  );

  const cpuBefore = process.cpuUsage();
  const memBefore = process.memoryUsage();
  const start = Date.now();
  let errors = 0;

  for (let offset = 0; offset < count; offset += batchSize) {
    const batch = messages.slice(offset, offset + batchSize);
    const results = await Promise.allSettled(
      batch.map(msg => handleMessageCreate(msg, ctx))
    );
    for (const r of results) if (r.status === 'rejected') errors++;
  }

  await flushAllWrites();
  tracker.stop();
  restore();

  const wall = Date.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const mem = process.memoryUsage();

  return {
    label: `Concurrent (${batchSize}×${Math.ceil(count/batchSize)})`,
    count, wall,
    ops: Math.round(count / (wall / 1000)),
    cpuTotal: ((cpu.user + cpu.system) / 1000).toFixed(1),
    maxLag: tracker.max(),
    heapDelta: ((mem.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
    errors,
  };
}

// ─── 8. Main ────────────────────────────────────────────────────────────────
async function runAll(mode, total, batch) {
  // Set the write mode
  process.env.FORCE_SYNC_WRITES = mode === 'sync' ? '1' : '';
  // Clear any module caches that might have stale state... actually the env
  // is checked at call-time in writeJsonFileDebounced, so no cache issue.

  const seq = await runSequential(total);
  const con = await runConcurrent(total, batch);
  return { seq, con, mode };
}

async function main() {
  const total = parseInt(process.argv[2], 10) || 1000;
  const batch = parseInt(process.argv[3], 10) || 50;

  // Run both modes
  const oldResults = await runAll('sync', total, batch);
  const newResults = await runAll('async', total, batch);

  console.log(`\nLoad Test: ${total} handlers total, concurrent batch=${batch}`);
  console.log(`Data dir: ${TMPDIR}\n`);

  for (const { mode, seq, con } of [oldResults, newResults]) {
    console.log(`── ${mode.toUpperCase()} WRITES ──`);
    const hdr = `${'MODE'.padEnd(30)} ${'OPS/S'.padEnd(8)} ${'WALL'.padEnd(8)} ${'CPU_MS'.padEnd(8)} ${'MAX_LAG'.padEnd(8)} ${'HEAP+'.padEnd(8)} ${'ERR'}`;
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const r of [seq, con]) {
      console.log(
        `${r.label.padEnd(30)} ` +
        `${String(r.ops).padEnd(8)} ` +
        `${r.wall.toString().padEnd(8)} ` +
        `${r.cpuTotal.padEnd(8)} ` +
        `${r.maxLag.toFixed(2).padEnd(8)} ` +
        `${r.heapDelta.padEnd(8)} ` +
        `${r.errors}`
      );
    }
    console.log();
  }

  // Summary
  console.log(`── COMPARISON (CONCURRENT) ──`);
  console.log(`${'METRIC'.padEnd(20)} ${'SYNC'.padEnd(10)} ${'ASYNC'.padEnd(10)} ${'IMPROVEMENT'}`);
  console.log('-'.repeat(55));
  const metrics = [
    { label: 'Throughput (ops/s)', sync: oldResults.con.ops, async: newResults.con.ops, higher: true },
    { label: 'Wall time (ms)',     sync: oldResults.con.wall, async: newResults.con.wall, higher: false },
    { label: 'CPU total (ms)',     sync: oldResults.con.cpuTotal, async: newResults.con.cpuTotal, higher: false },
    { label: 'Max lag (ms)',       sync: oldResults.con.maxLag, async: newResults.con.maxLag, higher: false },
  ];
  for (const m of metrics) {
    const s = parseFloat(m.sync), a = parseFloat(m.async);
    let pct;
    if (s > 0 && m.label !== 'Max lag (ms)') {
      pct = ((a - s) / s * 100).toFixed(1);
      if (m.higher && pct > 0) pct = '+' + pct;
      if (!m.higher && pct < 0) pct = '' + pct;
      pct += '%';
    } else if (s > 0 && m.label === 'Max lag (ms)') {
      pct = ((1 - a / s) * 100).toFixed(1);
      if (pct > 0) pct = '-' + pct + '%';
      else pct = '+' + pct + '%';
    } else {
      pct = 'N/A (0 baseline)';
    }
    console.log(
      `${m.label.padEnd(20)} ` +
      `${m.sync.toString().padEnd(10)} ` +
      `${m.async.toString().padEnd(10)} ` +
      `${pct}`
    );
  }

  await flushAllWrites();
  await new Promise(r => setTimeout(r, 100));
  delete process.env.FORCE_SYNC_WRITES;
  try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch {}
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
