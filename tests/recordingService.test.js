const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLIP_BACK_MS,
  CLIP_FORWARD_MS,
  activeSessions,
  assertPathInsideRecordingRoot,
  assertScreenRecordingDependencies,
  buildFfmpegArgs,
  buildSessionFfmpegArgs,
  clampGeometryToDisplay,
  createSessionId,
  deleteLegacyAudioArtifacts,
  findLatestRecording,
  isBotOwner,
  markInterruptedScreenRecordings,
  normalizeCaptureGeometry,
  parseDisplayBounds,
  parseGeometry,
  resolveScreenRecordingConfig,
  selectSegmentsForWindow,
  requestClip,
  startRecording,
  stopRecording,
} = require('../features/voice/screenRecording/service');

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;

  const restore = () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-recording-service-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fakeMessage(options = {}) {
  const replies = [];
  const edits = [];
  const sends = [];
  const authorId = options.authorId || '111';
  const voiceChannel = options.voiceChannel === false
    ? null
    : { id: 'voice-1', name: 'General Voice', isVoiceBased: () => true };

  const message = {
    guild: options.guild === false ? null : { id: 'guild-1', name: 'Guild One' },
    author: { id: authorId, tag: `${authorId}#0000` },
    member: {
      voice: {
        channel: voiceChannel,
        channelId: voiceChannel?.id || options.channelId || null,
      },
    },
    channel: {
      id: 'text-1',
      send: async content => {
        sends.push(content);
        return content;
      },
    },
    client: {},
    reply: async content => {
      replies.push(content);
      return {
        edit: async next => {
          edits.push(next);
          return next;
        },
        channel: {
          send: async next => {
            sends.push(next);
            return next;
          },
        },
      };
    },
  };

  return { message, replies, edits, sends };
}

test.afterEach(() => {
  activeSessions.clear();
});

test('screen clip window constants match public behavior', () => {
  assert.equal(CLIP_BACK_MS, 60_000);
  assert.equal(CLIP_FORWARD_MS, 20_000);
});

test('createSessionId creates filesystem-safe timestamp ids', () => {
  assert.equal(createSessionId(new Date('2026-06-16T20:13:44.120Z')), '2026-06-16T20-13-44-120Z');
});

test('isBotOwner checks comma-separated BOT_OWNER_IDS', () => {
  withEnv('BOT_OWNER_IDS', '111, 222 ,333', () => {
    assert.equal(isBotOwner('222'), true);
    assert.equal(isBotOwner('444'), false);
  });
});

test('parseGeometry supports WIDTHxHEIGHT+X,Y', () => {
  assert.deepEqual(parseGeometry('1280x720+10,20'), {
    width: 1280,
    height: 720,
    x: 10,
    y: 20,
  });
  assert.deepEqual(parseGeometry('640x480+-5,-10'), {
    width: 640,
    height: 480,
    x: -5,
    y: -10,
  });
  assert.throws(() => parseGeometry('1280x720+10+20'), /WIDTHxHEIGHT\+X,Y/);
});

test('parseDisplayBounds reads xdpyinfo dimensions', () => {
  assert.deepEqual(parseDisplayBounds('  dimensions:    1920x1080 pixels (508x285 millimeters)'), {
    width: 1920,
    height: 1080,
  });
});

test('clampGeometryToDisplay trims capture regions that spill past the screen', () => {
  assert.deepEqual(
    clampGeometryToDisplay({ width: 1920, height: 1048, x: 1, y: 33 }, { width: 1920, height: 1080 }),
    { width: 1919, height: 1047, x: 1, y: 33 }
  );
});

test('normalizeCaptureGeometry clamps to display and aligns dimensions for H.264', () => {
  assert.deepEqual(
    normalizeCaptureGeometry({ width: 1920, height: 1048, x: 1, y: 33 }, { width: 1920, height: 1080 }),
    { width: 1918, height: 1046, x: 1, y: 33 }
  );
});

test('resolveScreenRecordingConfig uses explicit geometry without xdotool', () => {
  const config = resolveScreenRecordingConfig({
    DISPLAY: ':1',
    SCREEN_RECORDING_AUDIO_SOURCE: 'default',
    SCREEN_RECORDING_GEOMETRY: '1024x768+3,4',
  });

  assert.match(config.ffmpegPath, /ffmpeg$/);
  assert.equal(config.display, ':1');
  assert.equal(config.audioSource, 'default');
  assert.deepEqual(config.geometry, { width: 1024, height: 768, x: 3, y: 4 });
});

test('resolveScreenRecordingConfig auto-detects the default monitor source', () => {
  const config = resolveScreenRecordingConfig(
    {
      DISPLAY: ':1',
      SCREEN_RECORDING_GEOMETRY: '1024x768+0,0',
    },
    {
      execFileSync: (command, args) => {
        if (command === 'pactl') {
          assert.deepEqual(args, ['get-default-sink']);
          return 'alsa_output.pci-0000_00_1f.3.analog-stereo\n';
        }
        if (command === 'xdpyinfo') {
          return '  dimensions:    1920x1080 pixels (508x285 millimeters)\n';
        }
        throw new Error(`unexpected command ${command}`);
      },
    }
  );

  assert.equal(config.audioSource, 'alsa_output.pci-0000_00_1f.3.analog-stereo.monitor');
});

test('assertScreenRecordingDependencies rejects missing audio source when auto-detection fails', () => {
  const error = assertScreenRecordingDependencies(
    {
      DISPLAY: ':1',
      SCREEN_RECORDING_GEOMETRY: '1024x768+0,0',
    },
    {
      execFileSync: () => {
        throw new Error('pactl unavailable');
      },
    }
  );

  assert.match(error, /Could not auto-detect/);
});

test('assertScreenRecordingDependencies rejects missing recorder window', () => {
  const error = assertScreenRecordingDependencies(
    {
      DISPLAY: ':1',
      SCREEN_RECORDING_AUDIO_SOURCE: 'default',
      SCREEN_RECORDING_WINDOW_TITLE: 'Discord',
    },
    {
      execFileSync: () => {
        throw new Error('not found');
      },
    }
  );

  assert.match(error, /Could not find a visible recorder window/);
});

test('buildFfmpegArgs includes x11grab, geometry, audio, H.264, AAC, and segment output', () => {
  const config = {
    display: ':1',
    geometry: { width: 1280, height: 720, x: 11, y: 22 },
    fps: 30,
    segmentSeconds: 2,
    audioSource: 'alsa_output.monitor',
  };
  const args = buildFfmpegArgs(config, '/tmp/buffer/%Y%m%d-%H%M%S.ts');

  assert.ok(args.includes('x11grab'));
  assert.ok(args.includes(':1+11,22'));
  assert.ok(args.includes('1280x720'));
  assert.ok(args.includes('pulse'));
  assert.ok(args.includes('alsa_output.monitor'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('segment'));
  assert.ok(args.includes('/tmp/buffer/%Y%m%d-%H%M%S.ts'));
});

test('buildSessionFfmpegArgs remuxes the segment list into a playable MP4', () => {
  assert.deepEqual(buildSessionFfmpegArgs('/tmp/session.concat.txt', '/tmp/recording.mp4'), [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'concat',
    '-safe', '0',
    '-i', '/tmp/session.concat.txt',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y',
    '/tmp/recording.mp4',
  ]);
});

test('selectSegmentsForWindow includes every overlapping segment', () => {
  const segments = [
    { file: 'a.ts', startMs: 0, endMs: 2_000 },
    { file: 'b.ts', startMs: 2_000, endMs: 4_000 },
    { file: 'c.ts', startMs: 4_000, endMs: 6_000 },
    { file: 'd.ts', startMs: 6_000, endMs: 8_000 },
  ];

  assert.deepEqual(
    selectSegmentsForWindow(segments, 1_500, 6_000).map(segment => segment.file),
    ['a.ts', 'b.ts', 'c.ts']
  );
});

test('markInterruptedScreenRecordings marks active and stopping screen sessions only', () => {
  withTempDir(dir => {
    const activeDir = path.join(dir, 'guild', '2026-06-16', 'active');
    const stoppedDir = path.join(dir, 'guild', '2026-06-16', 'stopped');
    const legacyDir = path.join(dir, 'guild', '2026-06-16', 'legacy');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.mkdirSync(stoppedDir, { recursive: true });
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, 'session.json'), JSON.stringify({ kind: 'screen_recording', status: 'active' }, null, 2));
    fs.writeFileSync(path.join(stoppedDir, 'session.json'), JSON.stringify({ kind: 'screen_recording', status: 'stopped' }, null, 2));
    fs.writeFileSync(path.join(legacyDir, 'session.json'), JSON.stringify({ status: 'active' }, null, 2));

    assert.equal(markInterruptedScreenRecordings(dir), 1);

    const updated = JSON.parse(fs.readFileSync(path.join(activeDir, 'session.json'), 'utf8'));
    const stopped = JSON.parse(fs.readFileSync(path.join(stoppedDir, 'session.json'), 'utf8'));
    const legacy = JSON.parse(fs.readFileSync(path.join(legacyDir, 'session.json'), 'utf8'));
    assert.equal(updated.status, 'interrupted');
    assert.equal(typeof updated.interruptedAt, 'string');
    assert.equal(stopped.status, 'stopped');
    assert.equal(legacy.status, 'active');
    assert.match(fs.readFileSync(path.join(activeDir, 'events.jsonl'), 'utf8'), /screen_recording_interrupted/);
  });
});

test('legacy cleanup refuses paths outside recordings root', () => {
  withTempDir(root => {
    assert.throws(
      () => assertPathInsideRecordingRoot(path.join(os.tmpdir(), 'outside-session'), root),
      /outside the recordings root/
    );
  });
});

test('legacy cleanup deletes only legacy audio-looking session directories', () => {
  withTempDir(root => {
    const sessionDir = path.join(root, 'guild', '2026-06-16', 'legacy');
    fs.mkdirSync(path.join(sessionDir, 'mixed'), { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({
      status: 'stopped',
      paths: { mixed: path.join(sessionDir, 'mixed') },
    }));

    assert.equal(deleteLegacyAudioArtifacts(sessionDir, root), true);
    assert.equal(fs.existsSync(sessionDir), false);
  });
});

test('findLatestRecording returns the newest playable session file', () => {
  withTempDir(root => {
    const olderDir = path.join(root, 'guild', '2026-06-16', 'older');
    const newerDir = path.join(root, 'guild', '2026-06-16', 'newer');
    fs.mkdirSync(olderDir, { recursive: true });
    fs.mkdirSync(newerDir, { recursive: true });
    fs.writeFileSync(path.join(olderDir, 'recording.mp4'), '');
    fs.writeFileSync(path.join(newerDir, 'recording.mp4'), '');
    fs.writeFileSync(path.join(newerDir, 'session.json'), JSON.stringify({ sessionId: 'newer-session', channelName: 'Voice' }));

    const now = new Date();
    fs.utimesSync(path.join(olderDir, 'recording.mp4'), now, new Date(now.getTime() - 10_000));
    fs.utimesSync(path.join(newerDir, 'recording.mp4'), now, now);

    const latest = findLatestRecording('guild', root);
    assert.equal(latest.sessionId, 'newer-session');
    assert.equal(latest.file, path.join(newerDir, 'recording.mp4'));
  });
});

test('startRecording rejects non-owner, missing guild, missing voice channel, and missing audio source', async () => {
  await withEnv('BOT_OWNER_IDS', '111', async () => {
    const missingGuild = fakeMessage({ guild: false });
    await startRecording(missingGuild.message);
    assert.match(missingGuild.replies[0], /server channel/);

    const nonOwner = fakeMessage({ authorId: '222' });
    await startRecording(nonOwner.message);
    assert.match(nonOwner.replies[0], /not authorized/);

    const missingVoice = fakeMessage({ voiceChannel: false });
    await startRecording(missingVoice.message);
    assert.match(missingVoice.replies[0], /Join the voice channel/);

    const missingAudio = fakeMessage();
    await withEnv('SCREEN_RECORDING_AUDIO_SOURCE', undefined, async () => {
      await withEnv('SCREEN_RECORDING_GEOMETRY', '1024x768+0,0', async () => {
        await withEnv('SCREEN_RECORDING_DISPLAY', ':1', async () => {
          await startRecording(missingAudio.message);
        });
      });
    });
    assert.match(missingAudio.edits.at(-1), /SCREEN_RECORDING_AUDIO_SOURCE/);
  });
});

test('requestClip rejects inactive sessions and users outside the recorded channel', async () => {
  await withEnv('BOT_OWNER_IDS', '111', async () => {
    const inactive = fakeMessage({ authorId: '111' });
    await requestClip(inactive.message, 'note');
    assert.match(inactive.replies[0], /not active/);

    const outside = fakeMessage({ authorId: '222' });
    activeSessions.set(outside.message.guild.id, {
      channel: { id: 'other-voice', name: 'Other Voice' },
    });

    await requestClip(outside.message, 'note');
    assert.match(outside.replies[0], /recorded voice channel/);
  });
});

test('stopRecording handles inactive and active sessions', async () => {
  await withEnv('BOT_OWNER_IDS', '111', async () => {
    const inactive = fakeMessage();
    await stopRecording(inactive.message);
    assert.match(inactive.replies[0], /not active/);

    const active = fakeMessage();
    const startedAtMs = Date.now() - 5_000;
    activeSessions.set(active.message.guild.id, {
      startedAtMs,
      stoppedAt: new Date(),
      rootDir: path.join(process.cwd(), 'recordings', 'guild-1', 'test'),
      stop: async function stop() {
        this.stoppedAt = new Date(startedAtMs + 5_000);
      },
    });

    await stopRecording(active.message);
    assert.match(active.replies[0], /Stopping screen recording/);
    assert.match(active.sends[0], /Screen recording stopped/);
  });
});
