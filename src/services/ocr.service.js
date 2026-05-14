const fs   = require('fs');
const path = require('path');
const logger = require('../core/logger').createServiceLogger('OCR');
const config = require('../core/config');

// Lazy-load Electron modules only when needed
let desktopCapturer = null;
function getDesktopCapturer() {
  if (!desktopCapturer) {
    desktopCapturer = require('electron').desktopCapturer;
  }
  return desktopCapturer;
}

/**
 * Resolve the directory containing eng.traineddata.
 *
 * Dev:      project_root/  (eng.traineddata sits next to package.json)
 * Packaged: app.asar.unpacked/ (asarUnpack includes eng.traineddata)
 */
function getLangPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    // eng.traineddata is unpacked alongside app.asar
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked');
    logger.info('OCR langPath (packaged)', { unpacked });
    return unpacked;
  }
  // Dev: traineddata is in project root
  const devPath = path.join(__dirname, '..', '..');
  logger.info('OCR langPath (dev)', { devPath });
  return devPath;
}

class OCRService {
  constructor() {
    this.isProcessing = false;
    this.tempFiles    = new Set();
    this._worker      = null;   // persistent Tesseract worker
    this._workerReady = false;
  }

  /**
   * Initialize the Tesseract worker once and reuse it.
   * Using createWorker (not Tesseract.recognize shorthand) is required
   * for Electron packaged apps — the shorthand can't resolve worker paths
   * inside app.asar.
   */
  async _getWorker() {
    if (this._worker && this._workerReady) return this._worker;

    const { createWorker } = require('tesseract.js');
    const { app }  = require('electron');
    const langPath = getLangPath();

    // In a packaged Electron app, worker threads can't resolve modules
    // from inside app.asar. Pass explicit paths to the unpacked locations
    // for the worker script and WASM core so they load from real filesystem paths.
    let workerPath;
    let corePath;

    if (app.isPackaged) {
      const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked');
      workerPath = path.join(unpacked, 'node_modules', 'tesseract.js',
                            'src', 'worker-script', 'node', 'index.js');
      corePath   = path.join(unpacked, 'node_modules', 'tesseract.js-core');
    }

    logger.info('Creating Tesseract worker', {
      langPath,
      workerPath: workerPath || '(default)',
      corePath:   corePath   || '(default)',
    });

    const workerOptions = {
      langPath,
      gzip: false,
      logger: m => {
        if (m.status === 'recognizing text') {
          logger.debug('OCR progress', { pct: Math.round(m.progress * 100) });
        }
      },
    };

    // Only set workerPath/corePath in packaged app — in dev let tesseract resolve normally
    if (app.isPackaged) {
      workerOptions.workerPath = workerPath;
      workerOptions.corePath   = corePath;
    }

    this._worker = await createWorker('eng', 1, workerOptions);
    this._workerReady = true;
    logger.info('Tesseract worker ready');
    return this._worker;
  }

  async captureAndProcess() {
    try {
      if (this.isProcessing) {
        throw new Error('OCR operation already in progress');
      }
      this.isProcessing = true;
      const startTime   = Date.now();

      logger.info('Starting screenshot capture and OCR processing');

      const screenshot    = await this.captureScreenshot();
      const extractedText = await this.performOCR(screenshot);

      this.isProcessing = false;
      this.cleanup();

      return {
        text: extractedText.trim(),
        metadata: {
          timestamp:      new Date().toISOString(),
          source:         screenshot.metadata,
          processingTime: Date.now() - startTime,
        }
      };
    } catch (error) {
      this.isProcessing = false;
      this.cleanup();
      logger.error('OCR captureAndProcess failed', { error: error.message });
      throw error;
    }
  }

  async captureScreenshot() {
    const dc = getDesktopCapturer();
    const sources = await dc.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });

    if (sources.length === 0) throw new Error('No screen sources available for capture');

    const image = sources[0].thumbnail;
    if (!image) throw new Error('Failed to capture screen thumbnail');

    return {
      image,
      metadata: {
        sourceName:  sources[0].name,
        dimensions:  image.getSize(),
        captureTime: new Date().toISOString(),
      }
    };
  }

  async performOCR(screenshot) {
    const tempPath = this.createTempFile(screenshot.image);
    logger.debug('Starting OCR text extraction', { tempPath });

    try {
      const worker = await this._getWorker();
      const { data: { text } } = await worker.recognize(tempPath);
      logger.info('OCR text extraction completed', {
        originalLength: text.length,
        wordsExtracted: text.split(/\s+/).filter(w => w.length > 0).length,
      });
      return this.sanitizeText(text);
    } catch (err) {
      // Worker may have died — reset so next call recreates it
      logger.error('OCR worker error — resetting worker', { error: err.message });
      this._worker      = null;
      this._workerReady = false;
      throw err;
    }
  }

  createTempFile(image) {
    const tempDir  = config.get('ocr.tempDir') || '/tmp/klaude-ocr';
    const tempPath = path.join(
      tempDir,
      `klaude-screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
    );
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    const buffer = image.toPNG();
    fs.writeFileSync(tempPath, buffer);
    this.tempFiles.add(tempPath);
    return tempPath;
  }

  sanitizeText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();
  }

  cleanup() {
    for (const tempFile of this.tempFiles) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }
    this.tempFiles.clear();
  }

  getStatus() {
    return {
      isProcessing:  this.isProcessing,
      workerReady:   this._workerReady,
      tempFilesCount: this.tempFiles.size,
    };
  }
}

module.exports = new OCRService();