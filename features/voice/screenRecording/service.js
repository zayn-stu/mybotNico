const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { once } = require('events');
const { writeJsonFileAtomic } = require('../../../shared/jsonStore');

const CLIP_BACK_MS = 60_000;
const CLIP_FORWARD_MS = 20_000;
const HISTORY_MARGIN_MS = 10_000;
const EXPORT_SETTLE_MS = 1_000;
const DEFAULT_SEGMENT_SECONDS = 2;
const DEFAULT_FPS = 30;
const DEFAULT_WINDOW_TITLE = 'Discord';
const RECORDING_ROOT = path.join(__dirname, '..', '..', '..', 'recordings');
const activeSessions = new Map();

function getOwnerIds(env = process.env) {
  return (env.BOT_OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function isBotOwner(userId, env = process.env) {
  return getOwnerIds(env).includes(userId);
}

function toDatePart(date) {
  return date.toISOString().slice(0, 10);
}

function toSafeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createSessionId(date = new Date()) {
  return toSafeTimestamp(date);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function seconds(valueMs) {
  return Math.round(valueMs / 1000);
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return parsed;
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function parseGeometry(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+)x(\d+)\+(-?\d+),(-?\d+)$/);
  if (!match) {
    throw new Error('SCREEN_RECORDING_GEOMETRY must use WIDTHxHEIGHT+X,Y, for example 1280x720+0,0.');
  }

  const geometry = {
    width: Number(match[1]),
    height: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
  };

  if (geometry.width <= 0 || geometry.height <= 0) {
    throw new Error('SCREEN_RECORDING_GEOMETRY width and height must be positive.');
  }

  return geometry;
}

function formatGeometry(geometry) {
  return `${geometry.width}x${geometry.height}+${geometry.x},${geometry.y}`;
}

function parseDisplayBounds(output) {
  const match = String(output || '').match(/dimensions:\s*(\d+)x(\d+)\s+pixels/);
  if (!match) throw new Error('Could not read X11 display dimensions from xdpyinfo.');
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function parseXdotoolGeometry(output) {
  const values = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(-?\d+)$/);
    if (match) values[match[1]] = Number(match[2]);
  }

  if (!values.WIDTH || !values.HEIGHT || !Number.isFinite(values.X) || !Number.isFinite(values.Y)) {
    throw new Error('Could not read Discord window geometry from xdotool.');
  }

  return {
    width: values.WIDTH,
    height: values.HEIGHT,
    x: values.X,
    y: values.Y,
  };
}

function detectDisplayBounds(display, deps = {}) {
  const execFile = deps.execFileSync || execFileSync;
  try {
    return parseDisplayBounds(execFile('xdpyinfo', ['-display', display], { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

function clampGeometryToDisplay(geometry, bounds) {
  if (!bounds) return geometry;

  const x = Math.max(0, geometry.x);
  const y = Math.max(0, geometry.y);
  const width = Math.min(geometry.width, bounds.width - x);
  const height = Math.min(geometry.height, bounds.height - y);

  if (width <= 0 || height <= 0) {
    throw new Error(`Capture geometry ${formatGeometry(geometry)} is outside the X11 display ${bounds.width}x${bounds.height}.`);
  }

  return { width, height, x, y };
}

function normalizeCaptureGeometry(geometry, bounds = null) {
  const clamped = clampGeometryToDisplay(geometry, bounds);
  const width = clamped.width - (clamped.width % 2);
  const height = clamped.height - (clamped.height % 2);

  if (width <= 0 || height <= 0) {
    throw new Error(`Capture geometry ${formatGeometry(geometry)} is too small after display and encoder alignment.`);
  }

  return {
    width,
    height,
    x: clamped.x,
    y: clamped.y,
  };
}

function resolveWindowGeometry(env = process.env, deps = {}) {
  const configured = parseGeometry(env.SCREEN_RECORDING_GEOMETRY);
  if (configured) return configured;

  const execFile = deps.execFileSync || execFileSync;
  const windowTitle = env.SCREEN_RECORDING_WINDOW_TITLE || DEFAULT_WINDOW_TITLE;
  let searchOutput;
  try {
    searchOutput = execFile('xdotool', ['search', '--onlyvisible', '--name', windowTitle], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`Could not find a visible recorder window matching "${windowTitle}". Set SCREEN_RECORDING_GEOMETRY or open a visible prejoined Discord window.`);
  }

  const windowId = String(searchOutput || '').trim().split(/\s+/).filter(Boolean)[0];
  if (!windowId) {
    throw new Error(`Could not find a visible recorder window matching "${windowTitle}".`);
  }

  let geometryOutput;
  try {
    geometryOutput = execFile('xdotool', ['getwindowgeometry', '--shell', windowId], { encoding: 'utf8' });
  } catch {
    throw new Error(`Could not inspect recorder window geometry for "${windowTitle}".`);
  }

  return parseXdotoolGeometry(geometryOutput);
}

function getFfmpegPath(env = process.env) {
  if (env.SCREEN_RECORDING_FFMPEG_PATH) return env.SCREEN_RECORDING_FFMPEG_PATH;
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  if (fs.existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
  return 'ffmpeg';
}

function detectDefaultAudioSource(deps = {}) {
  const execFile = deps.execFileSync || execFileSync;
  let defaultSink;

  try {
    defaultSink = execFile('pactl', ['get-default-sink'], { encoding: 'utf8' }).trim();
  } catch {
    try {
      const info = execFile('pactl', ['info'], { encoding: 'utf8' });
      const match = info.match(/^Default Sink:\s*(.+)$/m);
      defaultSink = match?.[1]?.trim();
    } catch {
      return null;
    }
  }

  if (!defaultSink) return null;
  return defaultSink.endsWith('.monitor') ? defaultSink : `${defaultSink}.monitor`;
}

function resolveScreenRecordingConfig(env = process.env, deps = {}) {
  const display = env.SCREEN_RECORDING_DISPLAY || env.DISPLAY;
  if (!display) {
    throw new Error('SCREEN_RECORDING_DISPLAY or DISPLAY is required for X11 screen recording.');
  }

  const videoOnly = parseBoolean(env.SCREEN_RECORDING_ALLOW_VIDEO_ONLY);
  const audioSource = env.SCREEN_RECORDING_AUDIO_SOURCE || (videoOnly ? '' : detectDefaultAudioSource(deps));
  if (!audioSource && !videoOnly) {
    throw new Error('Could not auto-detect a Pulse/PipeWire monitor source. Set SCREEN_RECORDING_AUDIO_SOURCE to your monitor source, or set SCREEN_RECORDING_ALLOW_VIDEO_ONLY=true.');
  }

  const fps = parsePositiveInteger(env.SCREEN_RECORDING_FPS, DEFAULT_FPS, 'SCREEN_RECORDING_FPS');
  const segmentSeconds = parsePositiveInteger(
    env.SCREEN_RECORDING_SEGMENT_SECONDS,
    DEFAULT_SEGMENT_SECONDS,
    'SCREEN_RECORDING_SEGMENT_SECONDS'
  );
  const rawGeometry = resolveWindowGeometry(env, deps);
  const displayBounds = detectDisplayBounds(display, deps);
  const geometry = normalizeCaptureGeometry(rawGeometry, displayBounds);

  return {
    ffmpegPath: getFfmpegPath(env),
    display,
    windowTitle: env.SCREEN_RECORDING_WINDOW_TITLE || DEFAULT_WINDOW_TITLE,
    geometry,
    requestedGeometry: rawGeometry,
    displayBounds,
    audioSource,
    videoOnly,
    fps,
    segmentSeconds,
  };
}

function validateFfmpegConfig(config, deps = {}) {
  const run = deps.spawnSync || spawnSync;
  const ffmpegCheck = run(config.ffmpegPath, ['-hide_banner', '-devices'], { encoding: 'utf8' });
  if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
    return 'FFmpeg is not available. Install system FFmpeg or set SCREEN_RECORDING_FFMPEG_PATH to a working binary.';
  }

  const deviceOutput = `${ffmpegCheck.stdout || ''}\n${ffmpegCheck.stderr || ''}`;
  if (!/\bD[E.]?\s+x11grab\b/.test(deviceOutput)) {
    return 'FFmpeg does not support x11grab on this host.';
  }

  if (config.audioSource && !/\bD[E.]?\s+pulse\b/.test(deviceOutput)) {
    return 'FFmpeg does not support Pulse/PipeWire audio capture on this host.';
  }

  const encoderCheck = run(config.ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (encoderCheck.error || encoderCheck.status !== 0) {
    return 'FFmpeg encoder list could not be inspected.';
  }

  const encoderOutput = `${encoderCheck.stdout || ''}\n${encoderCheck.stderr || ''}`;
  if (!/\blibx264\b/.test(encoderOutput)) {
    return 'FFmpeg is missing the libx264 encoder required for MP4 screen clips.';
  }

  if (config.audioSource && !/\baac\b/.test(encoderOutput)) {
    return 'FFmpeg is missing the AAC encoder required for clip audio.';
  }

  return null;
}

function assertScreenRecordingDependencies(env = process.env, deps = {}) {
  let config;
  try {
    config = resolveScreenRecordingConfig(env, deps);
  } catch (err) {
    return err.message;
  }

  return validateFfmpegConfig(config, deps);
}

function buildFfmpegArgs(config, outputPattern) {
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'x11grab',
    '-thread_queue_size', '1024',
    '-framerate', String(config.fps),
    '-video_size', `${config.geometry.width}x${config.geometry.height}`,
    '-i', `${config.display}+${config.geometry.x},${config.geometry.y}`,
  ];

  if (config.audioSource) {
    args.push(
      '-thread_queue_size', '1024',
      '-f', 'pulse',
      '-i', config.audioSource
    );
  }

  args.push(
    '-map', '0:v:0'
  );

  if (config.audioSource) {
    args.push('-map', '1:a:0?');
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-r', String(config.fps)
  );

  if (config.audioSource) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push(
    '-f', 'segment',
    '-segment_time', String(config.segmentSeconds),
    '-segment_format', 'mpegts',
    '-reset_timestamps', '1',
    '-strftime', '1',
    outputPattern
  );

  return args;
}

function escapeConcatPath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

function buildClipFfmpegArgs(config, concatFile, outputFile, offsetSeconds, durationSeconds) {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-ss', offsetSeconds.toFixed(3),
    '-t', durationSeconds.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
  ];

  if (config.audioSource) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', '-y', outputFile);
  return args;
}

function buildSessionFfmpegArgs(concatFile, outputFile) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y',
    outputFile,
  ];
}

function getSegmentFiles(bufferDir, segmentSeconds = DEFAULT_SEGMENT_SECONDS) {
  if (!fs.existsSync(bufferDir)) return [];

  return fs.readdirSync(bufferDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => {
      const file = path.join(bufferDir, entry.name);
      const stat = fs.statSync(file);
      const endMs = stat.mtimeMs;
      return {
        file,
        name: entry.name,
        startMs: endMs - segmentSeconds * 1000,
        endMs,
      };
    })
    .sort((left, right) => left.startMs - right.startMs || left.name.localeCompare(right.name));
}

function selectSegmentsForWindow(segments, startMs, endMs) {
  return segments.filter(segment => segment.endMs > startMs && segment.startMs < endMs);
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

async function waitForProcessStartup(child, stderr, waitMs = 1_000) {
  if (!child || child.exitCode !== null) {
    throw new Error(stderr() || 'FFmpeg exited before recording started.');
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('close', onClose);
      child.off('error', onError);
      resolve();
    }, waitMs);

    function onClose(code) {
      clearTimeout(timeout);
      child.off('error', onError);
      reject(new Error(stderr() || `FFmpeg exited before recording started with code ${code}.`));
    }

    function onError(err) {
      clearTimeout(timeout);
      child.off('close', onClose);
      reject(err);
    }

    child.once('close', onClose);
    child.once('error', onError);
  });
}

async function stopProcess(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.killed) return;

  child.kill('SIGTERM');

  let killTimeout;
  await Promise.race([
    once(child, 'close').catch(() => {}),
    new Promise(resolve => {
      killTimeout = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(killTimeout));
}

async function updateStatusMessage(statusMessage, content) {
  if (!statusMessage) return;
  if (typeof statusMessage.edit === 'function') {
    await statusMessage.edit(content).catch(() => {});
    return;
  }
  if (typeof statusMessage.channel?.send === 'function') {
    await statusMessage.channel.send(content).catch(() => {});
  }
}

function summarizeFfmpegError(stderr) {
  const lines = String(stderr || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const interesting = [...lines].reverse().find(line => (
    /error|invalid|not found|failed|unable|denied|outside|divisible/i.test(line)
  )) || lines.at(-1);

  if (!interesting) return 'unknown FFmpeg error';
  return interesting.length > 240 ? `${interesting.slice(0, 237)}...` : interesting;
}

class ScreenRecordingSession {
  constructor({ guild, channel, commandChannel, startedBy, config }) {
    const startedAt = new Date();

    this.guild = guild;
    this.channel = channel;
    this.commandChannel = commandChannel;
    this.startedBy = startedBy;
    this.config = config;
    this.startedAt = startedAt;
    this.startedAtMs = startedAt.getTime();
    this.sessionId = createSessionId(startedAt);
    this.rootDir = path.join(RECORDING_ROOT, guild.id, toDatePart(startedAt), this.sessionId);
    this.sessionFile = path.join(this.rootDir, 'session.json');
    this.eventsFile = path.join(this.rootDir, 'events.jsonl');
    this.bufferDir = path.join(this.rootDir, 'buffer');
    this.clipsDir = path.join(this.rootDir, 'clips');
    this.pendingClips = new Map();
    this.status = 'active';
    this.started = false;
    this.captureProcess = null;
    this.captureStderr = '';
    this.pruneTimer = null;
  }

  async start() {
    ensureDir(this.bufferDir);
    ensureDir(this.clipsDir);

    this.writeSessionFile();
    this.logEvent('screen_recording_start', {
      guildId: this.guild.id,
      channelId: this.channel.id,
      startedBy: this.startedBy.id,
      geometry: formatGeometry(this.config.geometry),
      display: this.config.display,
      audio: this.config.audioSource ? 'enabled' : 'disabled',
    });

    const outputPattern = path.join(this.bufferDir, '%Y%m%d-%H%M%S.ts');
    const args = buildFfmpegArgs(this.config, outputPattern);
    this.captureProcess = spawn(this.config.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    this.captureProcess.stderr.on('data', chunk => {
      this.captureStderr += chunk.toString();
    });

    this.captureProcess.once('error', err => {
      console.error('[screen-recording] FFmpeg failed to start:', err);
    });

    this.captureProcess.once('close', code => {
      if (this.status === 'active' && this.started) {
        const errorSummary = summarizeFfmpegError(this.captureStderr);
        console.error('[screen-recording] FFmpeg exited unexpectedly:', code, this.captureStderr.trim());
        this.status = 'interrupted';
        this.stoppedAt = new Date();
        activeSessions.delete(this.guild.id);
        if (this.pruneTimer) clearInterval(this.pruneTimer);
        this.writeSessionFile({ error: this.captureStderr.trim() || `FFmpeg exited with code ${code}`, errorSummary });
        this.logEvent('screen_recording_interrupted', { code, error: errorSummary });
        this.commandChannel.send(`⚠️ Screen recording stopped because FFmpeg exited: ${errorSummary}`).catch(() => {});
      }
    });

    await waitForProcessStartup(this.captureProcess, () => this.captureStderr.trim());
    this.started = true;
    this.pruneTimer = setInterval(() => this.pruneBuffer(), 10_000);
  }

  getSegments() {
    return getSegmentFiles(this.bufferDir, this.config.segmentSeconds);
  }

  pruneBuffer(nowMs = Date.now()) {
    const pendingStarts = [...this.pendingClips.values()]
      .filter(clip => clip.status === 'queued' || clip.status === 'exporting')
      .map(clip => clip.startMs);
    const oldestPendingStart = pendingStarts.length > 0 ? Math.min(...pendingStarts) : Number.POSITIVE_INFINITY;
    const keepFrom = Math.min(
      nowMs - CLIP_BACK_MS - CLIP_FORWARD_MS - HISTORY_MARGIN_MS,
      oldestPendingStart - HISTORY_MARGIN_MS
    );

    if (!Number.isFinite(keepFrom)) return;

    for (const segment of this.getSegments()) {
      if (segment.endMs >= keepFrom) continue;
      fs.rmSync(segment.file, { force: true });
    }
  }

  requestClip(message, note) {
    const requestedAtMs = Date.now();
    const clipId = toSafeTimestamp(new Date(requestedAtMs));
    const clip = {
      clipId,
      note: note || '',
      requesterId: message.author.id,
      requesterTag: message.author.tag,
      requestedAtMs,
      startMs: Math.max(this.startedAtMs, requestedAtMs - CLIP_BACK_MS),
      endMs: requestedAtMs + CLIP_FORWARD_MS,
      status: 'queued',
      timeout: null,
      message,
    };

    this.pendingClips.set(clipId, clip);
    this.writeSessionFile();
    this.logEvent('clip_requested', {
      clipId,
      requesterId: clip.requesterId,
      note: clip.note,
      clipStart: new Date(clip.startMs).toISOString(),
      clipEnd: new Date(clip.endMs).toISOString(),
    });

    clip.timeout = setTimeout(() => {
      this.exportClip(clipId, message).catch(err => {
        console.error('[screen-recording] Clip export failed:', err);
        message.channel.send(`❌ Failed to export clip \`${clipId}\`: ${err.message}`).catch(() => {});
      });
    }, Math.max(0, clip.endMs - Date.now() + EXPORT_SETTLE_MS));

    return clip;
  }

  async exportClip(clipId, message, options = {}) {
    const clip = this.pendingClips.get(clipId);
    if (!clip || clip.status === 'exporting') return null;

    clip.status = 'exporting';
    if (clip.timeout) clearTimeout(clip.timeout);

    try {
      const actualEndMs = options.partial ? Math.min(Date.now(), clip.endMs) : clip.endMs;
      const segments = selectSegmentsForWindow(this.getSegments(), clip.startMs, actualEndMs);
      if (segments.length === 0) {
        throw new Error('No screen recording segments are available for that clip window.');
      }

      ensureDir(this.clipsDir);
      const outputFile = path.join(this.clipsDir, `${clipId}.mp4`);
      const concatFile = path.join(this.clipsDir, `${clipId}.concat.txt`);
      const earliestSegmentStartMs = segments[0].startMs;
      const actualStartMs = Math.max(clip.startMs, earliestSegmentStartMs);
      const offsetSeconds = Math.max(0, (actualStartMs - earliestSegmentStartMs) / 1000);
      const durationSeconds = Math.max(0.1, (actualEndMs - actualStartMs) / 1000);

      fs.writeFileSync(
        concatFile,
        segments.map(segment => `file '${escapeConcatPath(path.resolve(segment.file))}'`).join('\n') + '\n'
      );

      try {
        await runFfmpeg(
          this.config.ffmpegPath,
          buildClipFfmpegArgs(this.config, concatFile, outputFile, offsetSeconds, durationSeconds)
        );
      } finally {
        fs.rmSync(concatFile, { force: true });
      }

      clip.status = 'complete';
      this.pendingClips.delete(clipId);
      this.writeSessionFile();

      const shortened = actualStartMs > clip.startMs || actualEndMs < clip.endMs;
      this.logEvent('clip_exported', {
        clipId,
        file: outputFile,
        shortened,
        clipStart: new Date(actualStartMs).toISOString(),
        clipEnd: new Date(actualEndMs).toISOString(),
      });

      const relativePath = path.relative(process.cwd(), outputFile);
      const suffix = shortened ? ` Shortened to ${seconds(actualEndMs - actualStartMs)}s from available footage.` : '';
      await message.channel.send(`✅ Clip saved: \`${relativePath}\`.${suffix}`).catch(() => {});
      return outputFile;
    } catch (err) {
      clip.status = 'failed';
      this.pendingClips.delete(clipId);
      this.writeSessionFile();
      this.logEvent('clip_failed', { clipId, error: err.message });
      throw err;
    }
  }

  async exportPendingClipsPartial() {
    const clips = [...this.pendingClips.values()];
    for (const clip of clips) {
      await this.exportClip(clip.clipId, clip.message || { channel: this.commandChannel }, { partial: true }).catch(err => {
        console.error('[screen-recording] Pending clip export failed during stop:', err);
        this.commandChannel.send(`❌ Failed to export pending clip \`${clip.clipId}\`: ${err.message}`).catch(() => {});
      });
    }
  }

  async exportFullRecording() {
    const segments = this.getSegments();
    if (segments.length === 0) return null;

    const outputFile = path.join(this.rootDir, 'recording.mp4');
    const concatFile = path.join(this.rootDir, 'recording.concat.txt');
    fs.writeFileSync(
      concatFile,
      segments.map(segment => `file '${escapeConcatPath(path.resolve(segment.file))}'`).join('\n') + '\n'
    );

    try {
      await runFfmpeg(this.config.ffmpegPath, buildSessionFfmpegArgs(concatFile, outputFile));
    } finally {
      fs.rmSync(concatFile, { force: true });
    }

    this.logEvent('recording_exported', {
      file: outputFile,
      segmentCount: segments.length,
    });
    return outputFile;
  }

  writeSessionFile(extra = {}) {
    const value = {
      kind: 'screen_recording',
      sessionId: this.sessionId,
      status: this.status,
      guildId: this.guild.id,
      guildName: this.guild.name,
      channelId: this.channel.id,
      channelName: this.channel.name,
      commandChannelId: this.commandChannel.id,
      startedBy: {
        id: this.startedBy.id,
        tag: this.startedBy.tag,
      },
      startedAt: this.startedAt.toISOString(),
      stoppedAt: this.stoppedAt ? this.stoppedAt.toISOString() : null,
      clipWindow: {
        backMs: CLIP_BACK_MS,
        forwardMs: CLIP_FORWARD_MS,
      },
      capture: {
        display: this.config.display,
        windowTitle: this.config.windowTitle,
        geometry: formatGeometry(this.config.geometry),
        requestedGeometry: this.config.requestedGeometry ? formatGeometry(this.config.requestedGeometry) : null,
        displayBounds: this.config.displayBounds
          ? `${this.config.displayBounds.width}x${this.config.displayBounds.height}`
          : null,
        fps: this.config.fps,
        segmentSeconds: this.config.segmentSeconds,
        audioSource: this.config.audioSource || null,
        videoOnly: !this.config.audioSource,
      },
      paths: {
        root: this.rootDir,
        buffer: this.bufferDir,
        clips: this.clipsDir,
        recording: path.join(this.rootDir, 'recording.mp4'),
      },
      pendingClips: [...this.pendingClips.values()].map(clip => ({
        clipId: clip.clipId,
        requesterId: clip.requesterId,
        note: clip.note,
        requestedAt: new Date(clip.requestedAtMs).toISOString(),
        clipStart: new Date(clip.startMs).toISOString(),
        clipEnd: new Date(clip.endMs).toISOString(),
        status: clip.status,
      })),
      ...extra,
    };

    writeJsonFileAtomic(this.sessionFile, value, { ensureDirectory: true });
  }

  logEvent(type, data = {}) {
    appendJsonLine(this.eventsFile, {
      type,
      at: new Date().toISOString(),
      ...data,
    });
  }

  async stop() {
    if (this.status !== 'active' && this.status !== 'starting') return;

    this.status = 'stopping';
    this.stoppedAt = new Date();
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    this.logEvent('screen_recording_stop_requested', { stoppedAt: this.stoppedAt.toISOString() });
    this.writeSessionFile();

    await stopProcess(this.captureProcess);
    await this.exportPendingClipsPartial();
    this.recordingFile = await this.exportFullRecording().catch(err => {
      console.error('[screen-recording] Full recording export failed during stop:', err);
      this.commandChannel.send(`❌ Failed to export full recording: ${err.message}`).catch(() => {});
      return null;
    });

    this.status = 'stopped';
    this.stoppedAt = this.stoppedAt || new Date();
    this.writeSessionFile();
    this.logEvent('screen_recording_stopped', { stoppedAt: this.stoppedAt.toISOString() });
  }
}

function resolveRecordingChannel(message) {
  const channel = message.member?.voice?.channel;
  if (!channel) {
    return { error: 'Join the voice channel you want clipped, then run `nico record on`. The prejoined recorder window must already be visible.' };
  }
  if (typeof channel.isVoiceBased === 'function' && !channel.isVoiceBased()) {
    return { error: 'That is not a voice channel.' };
  }
  return { channel };
}

async function startRecording(message) {
  if (!message.guild) return message.reply('This command can only be used in a server channel.');
  if (!isBotOwner(message.author.id)) return message.reply('❌ You are not authorized to start recording.');
  if (activeSessions.has(message.guild.id)) return message.reply('Screen recording is already active in this server.');

  const resolved = resolveRecordingChannel(message);
  if (resolved.error) return message.reply(resolved.error);

  const statusMessage = await message.reply('🔴 Starting screen recording...');

  let config;
  try {
    config = resolveScreenRecordingConfig();
  } catch (err) {
    await updateStatusMessage(statusMessage, `❌ ${err.message}`);
    return;
  }

  const dependencyError = validateFfmpegConfig(config);
  if (dependencyError) {
    await updateStatusMessage(statusMessage, `❌ ${dependencyError}`);
    return;
  }

  const session = new ScreenRecordingSession({
    guild: message.guild,
    channel: resolved.channel,
    commandChannel: message.channel,
    startedBy: message.author,
    config,
  });

  try {
    await updateStatusMessage(statusMessage, `🔴 Capturing visible recorder window for **${resolved.channel.name}**...`);
    await session.start();
    activeSessions.set(message.guild.id, session);
    await updateStatusMessage(
      statusMessage,
      `🔴 Screen recording started for **${resolved.channel.name}**. Use \`nico clip [note]\` to save the last 60 seconds plus the next 20 seconds.`
    );
  } catch (err) {
    console.error('[screen-recording] Failed to start:', err);
    activeSessions.delete(message.guild.id);
    await session.stop().catch(() => {});
    await updateStatusMessage(statusMessage, `❌ Failed to start screen recording: ${err.message}`);
  }
}

async function stopRecording(message) {
  if (!message.guild) return message.reply('This command can only be used in a server channel.');
  if (!isBotOwner(message.author.id)) return message.reply('❌ You are not authorized to stop recording.');

  const session = activeSessions.get(message.guild.id);
  if (!session) return message.reply('Screen recording is not active in this server.');

  activeSessions.delete(message.guild.id);
  await message.reply('Stopping screen recording and finalizing pending clips...');
  await session.stop();

  const durationMs = (session.stoppedAt || new Date()).getTime() - session.startedAtMs;
  const lines = [
    `✅ Screen recording stopped. Duration: ${seconds(durationMs)}s.`,
    `Folder: \`${path.relative(process.cwd(), session.rootDir)}\``,
  ];
  if (session.recordingFile) {
    lines.push(`Playable file: \`${path.relative(process.cwd(), session.recordingFile)}\``);
  }
  return message.channel.send(lines.join('\n'));
}

async function requestClip(message, note) {
  if (!message.guild) return message.reply('This command can only be used in a server channel.');

  const session = activeSessions.get(message.guild.id);
  if (!session) return message.reply('Screen recording is not active in this server.');

  const inRecordedChannel = message.member?.voice?.channelId === session.channel.id;
  if (!isBotOwner(message.author.id) && !inRecordedChannel) {
    return message.reply('You need to be in the recorded voice channel to save a screen clip.');
  }

  const clip = session.requestClip(message, note);
  return message.reply(`📌 Clip queued: \`${clip.clipId}\`. Saving 60 seconds before now plus 20 seconds after now.`);
}

function getRecordingStatus(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return null;

  return {
    sessionId: session.sessionId,
    channelName: session.channel.name,
    startedAt: session.startedAt,
    pendingClips: session.pendingClips.size,
    rootDir: session.rootDir,
    geometry: formatGeometry(session.config.geometry),
    audio: session.config.audioSource ? 'enabled' : 'disabled',
  };
}

function findLatestRecording(guildId, rootDir = RECORDING_ROOT) {
  const guildDir = path.join(rootDir, guildId);
  if (!fs.existsSync(guildDir)) return null;

  let latest = null;
  const dateDirs = fs.readdirSync(guildDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
  for (const dateDir of dateDirs) {
    const datePath = path.join(guildDir, dateDir.name);
    const sessionDirs = fs.readdirSync(datePath, { withFileTypes: true }).filter(entry => entry.isDirectory());
    for (const sessionDir of sessionDirs) {
      const sessionPath = path.join(datePath, sessionDir.name);
      const recordingFile = path.join(sessionPath, 'recording.mp4');
      const sessionFile = path.join(sessionPath, 'session.json');
      if (!fs.existsSync(recordingFile)) continue;

      const stat = fs.statSync(recordingFile);
      let session = null;
      if (fs.existsSync(sessionFile)) {
        try {
          session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        } catch {
          session = null;
        }
      }

      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = {
          file: recordingFile,
          rootDir: sessionPath,
          mtimeMs: stat.mtimeMs,
          sessionId: session?.sessionId || sessionDir.name,
          channelName: session?.channelName || null,
          startedAt: session?.startedAt || null,
          stoppedAt: session?.stoppedAt || null,
        };
      }
    }
  }

  return latest;
}

async function sendRecordingStatus(message) {
  if (!message.guild) return message.reply('This command can only be used in a server channel.');

  const status = getRecordingStatus(message.guild.id);
  if (!status) {
    const latest = findLatestRecording(message.guild.id);
    const latestLine = latest
      ? `\nLatest playable file: \`${path.relative(process.cwd(), latest.file)}\``
      : '';
    return message.reply(`Screen recording is inactive. Commands: \`nico record on\`, \`nico clip [note]\`, \`nico record off\`.${latestLine}`);
  }

  const durationMs = Date.now() - status.startedAt.getTime();
  return message.reply([
    `🔴 Screen recording **${status.channelName}** for ${seconds(durationMs)}s.`,
    `Session: \`${status.sessionId}\``,
    `Pending clips: ${status.pendingClips}`,
    `Capture: ${status.geometry}, audio ${status.audio}`,
    `Path: \`${path.relative(process.cwd(), status.rootDir)}\``,
  ].join('\n'));
}

function isInsideDirectory(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function cleanupStaleScreenRecordingFiles(sessionDir, session) {
  if (session.kind !== 'screen_recording') return 0;
  const bufferDir = session.paths?.buffer || path.join(sessionDir, 'buffer');
  if (!isInsideDirectory(bufferDir, sessionDir) || !fs.existsSync(bufferDir)) return 0;

  let removed = 0;
  for (const entry of fs.readdirSync(bufferDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(tmp|part|concat\.txt)$/i.test(entry.name)) continue;
    fs.rmSync(path.join(bufferDir, entry.name), { force: true });
    removed++;
  }
  return removed;
}

function markInterruptedScreenRecordings(rootDir = RECORDING_ROOT) {
  if (!fs.existsSync(rootDir)) return 0;

  let interrupted = 0;
  const guildDirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
  for (const guildDir of guildDirs) {
    const guildPath = path.join(rootDir, guildDir.name);
    const dateDirs = fs.readdirSync(guildPath, { withFileTypes: true }).filter(entry => entry.isDirectory());
    for (const dateDir of dateDirs) {
      const datePath = path.join(guildPath, dateDir.name);
      const sessionDirs = fs.readdirSync(datePath, { withFileTypes: true }).filter(entry => entry.isDirectory());
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(datePath, sessionDir.name);
        const sessionFile = path.join(sessionPath, 'session.json');
        if (!fs.existsSync(sessionFile)) continue;

        try {
          const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
          cleanupStaleScreenRecordingFiles(sessionPath, session);
          if (session.kind !== 'screen_recording') continue;
          if (session.status !== 'active' && session.status !== 'stopping') continue;
          session.status = 'interrupted';
          session.interruptedAt = new Date().toISOString();
          writeJsonFileAtomic(sessionFile, session);
          appendJsonLine(path.join(sessionPath, 'events.jsonl'), {
            type: 'screen_recording_interrupted',
            at: session.interruptedAt,
          });
          interrupted++;
        } catch (err) {
          console.warn('[screen-recording] Failed to inspect recording session:', sessionFile, err.message);
        }
      }
    }
  }

  if (interrupted > 0) console.log(`[screen-recording] Marked ${interrupted} interrupted screen recording session(s)`);
  return interrupted;
}

function assertPathInsideRecordingRoot(targetPath, rootDir = RECORDING_ROOT) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  if (target === root || !target.startsWith(root + path.sep)) {
    throw new Error('Refusing to clean up a path outside the recordings root.');
  }
  return target;
}

function deleteLegacyAudioArtifacts(targetPath, rootDir = RECORDING_ROOT) {
  const target = assertPathInsideRecordingRoot(targetPath, rootDir);
  if (!fs.existsSync(target)) return false;

  const sessionFile = path.join(target, 'session.json');
  const session = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : {};
  const looksLikeLegacyAudio =
    session.kind !== 'screen_recording' &&
    (
      session.paths?.mixed ||
      session.paths?.users ||
      fs.existsSync(path.join(target, 'mixed')) ||
      fs.existsSync(path.join(target, 'users'))
    );

  if (!looksLikeLegacyAudio) {
    throw new Error('Refusing to delete artifacts that do not look like a legacy audio recording session.');
  }

  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

module.exports = {
  CLIP_BACK_MS,
  CLIP_FORWARD_MS,
  RECORDING_ROOT,
  ScreenRecordingSession,
  activeSessions,
  assertPathInsideRecordingRoot,
  assertScreenRecordingDependencies,
  buildClipFfmpegArgs,
  buildFfmpegArgs,
  buildSessionFfmpegArgs,
  clampGeometryToDisplay,
  createSessionId,
  deleteLegacyAudioArtifacts,
  findLatestRecording,
  getRecordingStatus,
  getSegmentFiles,
  isBotOwner,
  markInterruptedScreenRecordings,
  normalizeCaptureGeometry,
  parseDisplayBounds,
  parseGeometry,
  requestClip,
  resolveScreenRecordingConfig,
  selectSegmentsForWindow,
  sendRecordingStatus,
  startRecording,
  stopRecording,
};
