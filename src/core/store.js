/**
 * Klaude persistent store
 *
 * Two-layer storage:
 *   - electron-store  → plain JSON in userData for user preferences
 *   - electron.safeStorage → OS-encrypted blob in userData for the Gemini API key
 *
 * Why split?
 *   electron-store does not encrypt. Preferences (skill, language, icon) are
 *   non-sensitive so plain JSON is fine and makes debugging easy.
 *   The API key is sensitive and must never sit on disk unencrypted.
 */

const path = require('path');
const fs   = require('fs');
const logger = require('./logger').createServiceLogger('STORE');

// ---------------------------------------------------------------------------
// electron-store setup
// We import lazily so this file can be required before app.whenReady() fires.
// ---------------------------------------------------------------------------
let _store = null;

function getStore() {
  if (_store) return _store;

  // electron-store v8 is a pure-ESM package. We use the CJS-compatible shim
  // pattern: require() will work as long as electron-store exposes a default.
  try {
    const Store = require('electron-store');
    _store = new Store({
      name: 'klaude-preferences',
      defaults: {
        codingLanguage : 'java',
        activeSkill    : 'dsa',
        appIcon        : 'terminal',
        windowGap      : 20,
      },
    });
    logger.info('electron-store initialised', { path: _store.path });
  } catch (err) {
    logger.error('electron-store failed to initialise — falling back to in-memory store', { error: err.message });
    // Minimal in-memory fallback so the rest of the app doesn't crash
    const mem = {
      codingLanguage : 'java',
      activeSkill    : 'dsa',
      appIcon        : 'terminal',
      windowGap      : 20,
    };
    _store = {
      get : (k, def) => (k in mem ? mem[k] : def),
      set : (k, v)   => { mem[k] = v; },
      store: mem,
    };
  }
  return _store;
}

// ---------------------------------------------------------------------------
// safeStorage helpers  (must be called after app.whenReady())
// ---------------------------------------------------------------------------
const SECURE_KEY_FILE = () => {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'klaude-secure.dat');
};

/**
 * Persist the Gemini API key encrypted with the OS keychain.
 * safeStorage is only available after app.whenReady().
 */
function saveApiKey(apiKey) {
  try {
    const { safeStorage } = require('electron');

    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('safeStorage encryption unavailable — key will not be persisted');
      return false;
    }

    if (!apiKey || apiKey.trim() === '') {
      // Erase stored key
      const keyFile = SECURE_KEY_FILE();
      if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile);
      logger.info('API key cleared from disk');
      return true;
    }

    const encrypted = safeStorage.encryptString(apiKey.trim());
    fs.writeFileSync(SECURE_KEY_FILE(), encrypted);
    logger.info('API key saved (encrypted)');
    return true;
  } catch (err) {
    logger.error('Failed to save API key', { error: err.message });
    return false;
  }
}

/**
 * Read and decrypt the stored Gemini API key.
 * Returns null if no key is stored or decryption fails.
 */
function loadApiKey() {
  try {
    const { safeStorage } = require('electron');
    const keyFile = SECURE_KEY_FILE();

    if (!fs.existsSync(keyFile)) {
      logger.debug('No stored API key found');
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('safeStorage unavailable — cannot decrypt API key');
      return null;
    }

    const encrypted = fs.readFileSync(keyFile);
    const decrypted = safeStorage.decryptString(encrypted);
    logger.info('API key loaded from secure storage');
    return decrypted || null;
  } catch (err) {
    logger.error('Failed to load API key', { error: err.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Preferences API  (thin wrappers around electron-store)
// ---------------------------------------------------------------------------

function getPreference(key, defaultValue) {
  return getStore().get(key, defaultValue);
}

function setPreference(key, value) {
  getStore().set(key, value);
}

/**
 * Bulk-save a settings object.  Only known keys are persisted.
 * The geminiKey field is routed to safeStorage, not electron-store.
 */
function savePreferences(settings = {}) {
  const ALLOWED = ['codingLanguage', 'activeSkill', 'appIcon', 'selectedIcon', 'windowGap'];
  const store   = getStore();

  for (const key of ALLOWED) {
    if (settings[key] !== undefined && settings[key] !== null && settings[key] !== '') {
      // Normalise: selectedIcon and appIcon map to the same stored key
      const storeKey = key === 'selectedIcon' ? 'appIcon' : key;
      const val = key === 'windowGap' ? Number(settings[key]) : settings[key];
      store.set(storeKey, val);
    }
  }

  // Route API key to safeStorage
  if (settings.geminiKey !== undefined) {
    saveApiKey(settings.geminiKey);
  }

  logger.debug('Preferences saved', Object.keys(settings));
}

/**
 * Return all stored preferences as a plain object.
 * Redacts the API key — callers that need it must call loadApiKey() directly.
 */
function loadPreferences() {
  const store = getStore();
  return {
    codingLanguage : store.get('codingLanguage', 'java'),
    activeSkill    : store.get('activeSkill',    'dsa'),
    appIcon        : store.get('appIcon',        'terminal'),
    selectedIcon   : store.get('appIcon',        'terminal'),
    windowGap      : store.get('windowGap',       20),
    // geminiKey is intentionally omitted here — load separately via loadApiKey()
    // We include a boolean so the UI knows whether a key is already stored
    hasGeminiKey   : fs.existsSync(SECURE_KEY_FILE()),
  };
}

module.exports = {
  getPreference,
  setPreference,
  savePreferences,
  loadPreferences,
  saveApiKey,
  loadApiKey,
};