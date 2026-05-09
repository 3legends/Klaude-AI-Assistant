const path = require('path');
const os = require('os');

// Configuration manager for Klaude application
class Config {
  constructor() {
    this.apiKeys = {
      GEMINI: process.env.GEMINI_API_KEY,
    };

    this.config = {
      // Application
      'app.version': '1.0.0',
      'app.isDevelopment': !process.env.NODE_ENV || process.env.NODE_ENV === 'development',
      'app.processTitle': 'Klaude',

      // Whisper Speech Recognition
      'speech.whisper.model': process.env.WHISPER_MODEL || 'base.en',
      'speech.whisper.useGPU': process.env.WHISPER_GPU !== 'false',

      // OCR Configuration
      'ocr.language': 'eng',
      'ocr.tempDir': path.join(os.tmpdir(), 'klaude-ocr'),

      // LLM Configuration
      'llm.gemini.model': 'gemini-2.5-flash',
      'llm.gemini.enableFallbackMethod': true,
      'llm.gemini.fallbackEnabled': true,
      'llm.gemini.maxRetries': 3,
      'llm.gemini.timeout': 90000,

      // Window Configuration
      'window.minWidth': 300,
      'window.minHeight': 200,
      'window.maxWidth': 1200,
      'window.maxHeight': 900,
      'window.webPreferences': {
        preload: path.join(__dirname, '../../preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },

      // Stealth Mode
      'stealth.disguiseProcess': true,
      'stealth.noAttachConsole': true,
      'stealth.hideFromDock': true,
      'stealth.windowTransparency': 0.95,

      // Session Management
      'session.maxDuration': 5400000,
      'session.autoSave': true,
      'session.maxMemorySize': 100,
      'session.compressionThreshold': 50,
    };
  }

  get(key) {
    return this.config[key];
  }

  getApiKey(service) {
    // Always read from in-memory store so keys set via setApiKey() at runtime
    // are used even when .env is absent.
    return this.apiKeys[service] || null;
  }

  setApiKey(service, value) {
    this.apiKeys[service] = value || null;
    // Keep process.env in sync for any legacy code that reads it directly.
    if (value) {
      process.env[service + '_API_KEY'] = value;
    } else {
      delete process.env[service + '_API_KEY'];
    }
  }

  set(key, value) {
    this.config[key] = value;
  }

  getAll() {
    return { ...this.config };
  }
}

module.exports = new Config();