/**
 * dep-check.js
 * Checks all runtime dependencies at startup.
 * Results drive the first-run setup window.
 *
 * Checks:
 *   1. gemini  — is an API key stored and encrypted?
 *   2. sox     — bundled binary (resources/sox/<platform>/sox)
 *   3. whisper — bundled binary + model (resources/whisper/<platform>/*)
 *
 * Sox and Whisper binaries are bundled inside the app package via
 * electron-builder extraResources. No user installation needed.
 */

const { execSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const logger = require('../core/logger').createServiceLogger('DEP-CHECK');

// ── Platform helpers ──────────────────────────────────────────────────────────

function getPlatformDir() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (plat === 'win32')  return 'windows-x64';
  return 'linux-x64';
}

/**
 * Resolve path to a bundled resource.
 * Dev:        project_root/resources/<subPath>
 * Packaged:   Contents/Resources/<subPath>
 */
function getBundledPath(subPath) {
  if (getApp().isPackaged) {
    return path.join(process.resourcesPath, subPath);
  }
  return path.join(process.cwd(), 'resources', subPath);
}

function getApp() {
  return require('electron').app;
}

// ── Real userData (immune to app.setName stealth corruption) ──────────────────

function getRealUserData() {
  if (process.env.KLAUDE_USER_DATA) return process.env.KLAUDE_USER_DATA;
  return getApp().getPath('userData').trimEnd();
}

// ── Exported path getters (used by whisper.service.js) ───────────────────────

function getBundledWhisperCliPath() {
  const binName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  return getBundledPath(path.join('whisper', getPlatformDir(), binName));
}

function getBundledModelPath() {
  return getBundledPath(path.join('whisper', getPlatformDir(), 'ggml-base.en.bin'));
}

function getBundledSoxPath() {
  const binName = process.platform === 'win32' ? 'sox.exe' : 'sox';
  return getBundledPath(path.join('sox', getPlatformDir(), binName));
}

// Legacy helpers kept for compatibility
function getModelDir()       { return path.join(getRealUserData(), 'models'); }
function getModelFilePath()  { return path.join(getModelDir(), 'ggml-base.en.bin'); }
function getUserDataBinDir() { return path.join(getRealUserData(), 'bin'); }

// ── Individual checks ─────────────────────────────────────────────────────────

function checkGeminiKey() {
  try {
    const store = require('../core/store');
    const prefs = store.loadPreferences();
    return {
      ok:      prefs.hasGeminiKey,
      label:   'Gemini API key',
      detail:  prefs.hasGeminiKey ? 'Key stored and encrypted.' : 'Required to use AI features.',
      fixable: !prefs.hasGeminiKey,
    };
  } catch (err) {
    return { ok: false, label: 'Gemini API key', detail: err.message, fixable: true };
  }
}

function checkSox() {
  // 1. Bundled binary (primary)
  const bundled = getBundledSoxPath();
  if (fs.existsSync(bundled)) {
    try { if (process.platform !== 'win32') fs.chmodSync(bundled, 0o755); } catch (_) {}
    _injectDirToPath(path.dirname(bundled));
    logger.info('Sox found (bundled)', { path: bundled });
    return { ok: true, label: 'Sox audio recorder', detail: 'Ready.', resolvedPath: bundled };
  }

  // 2. System PATH fallback (dev convenience)
  try {
    const cmd   = process.platform === 'win32' ? 'where sox' : 'which sox';
    const found = execSync(cmd, { timeout: 3000 }).toString().trim().split('\n')[0];
    if (found && fs.existsSync(found)) {
      _injectDirToPath(path.dirname(found));
      logger.info('Sox found on PATH', { path: found });
      return { ok: true, label: 'Sox audio recorder', detail: `Found at ${found}.`, resolvedPath: found };
    }
  } catch (_) {}

  logger.warn('Sox not found');
  return { ok: false, label: 'Sox audio recorder', detail: 'Sox binary not found. Please reinstall Klaude.', fixable: false };
}

function checkWhisperModel() {
  // 1. Bundled model (primary)
  const bundled = getBundledModelPath();
  if (fs.existsSync(bundled) && fs.statSync(bundled).size > 50 * 1024 * 1024) {
    logger.info('Whisper model found (bundled)', { path: bundled });
    return { ok: true, label: 'Whisper speech model', detail: 'Ready (bundled).', path: bundled };
  }

  // 2. userData/models fallback (previously downloaded copy)
  const userModel = getModelFilePath();
  if (fs.existsSync(userModel) && fs.statSync(userModel).size > 50 * 1024 * 1024) {
    logger.info('Whisper model found in userData', { path: userModel });
    return { ok: true, label: 'Whisper speech model', detail: 'Ready.', path: userModel };
  }

  logger.warn('Whisper model not found');
  return { ok: false, label: 'Whisper speech model', detail: 'Whisper model not found. Please reinstall Klaude.', fixable: false, path: userModel };
}

function checkWhisperCli() {
  // 1. Bundled CLI (primary)
  const bundled = getBundledWhisperCliPath();
  if (fs.existsSync(bundled)) {
    try { if (process.platform !== 'win32') fs.chmodSync(bundled, 0o755); } catch (_) {}
    logger.info('whisper-cli found (bundled)', { path: bundled });
    return { ok: true, path: bundled };
  }

  // 2. node_modules compiled fallback
  const fallback = path.join(
    process.cwd(), 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp',
    'build', 'bin', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  );
  if (fs.existsSync(fallback)) {
    logger.info('whisper-cli found (node_modules fallback)', { path: fallback });
    return { ok: true, path: fallback };
  }

  logger.warn('whisper-cli not found');
  return { ok: false, path: null };
}

// ── Public API ────────────────────────────────────────────────────────────────

function runAllChecks() {
  const gemini  = checkGeminiKey();
  const sox     = checkSox();
  const whisper = checkWhisperModel();
  const allOk   = gemini.ok && sox.ok && whisper.ok;

  logger.info('Dependency check complete', { gemini: gemini.ok, sox: sox.ok, whisper: whisper.ok, allOk });
  return { gemini, sox, whisper, allOk };
}

function _injectDirToPath(dir) {
  if (dir && !process.env.PATH.includes(dir)) {
    process.env.PATH = dir + path.delimiter + process.env.PATH;
    logger.info('Injected dir to PATH', { dir });
  }
}

module.exports = {
  runAllChecks,
  checkGeminiKey,
  checkSox,
  checkWhisperModel,
  checkWhisperCli,
  getBundledWhisperCliPath,
  getBundledModelPath,
  getBundledSoxPath,
  getModelDir,
  getModelFilePath,
  getUserDataBinDir,
};