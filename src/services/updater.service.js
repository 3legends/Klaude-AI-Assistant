const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const logger = require('../core/logger').createServiceLogger('OCR');
const config = require('../core/config');

// Lazy-load Electron modules only when needed
let desktopCapturer = null;
function getDesktopCapturer() {
  if (!desktopCapturer) {
    console.log('[OCR] Lazy loading desktopCapturer');
    desktopCapturer = require('electron').desktopCapturer;
  }
  return desktopCapturer;
}

// Lazy-load Tesseract only when needed
let Tesseract = null;
function getTesseract() {
  if (!Tesseract) {
    console.log('[OCR] Lazy loading Tesseract.js');
    Tesseract = require('tesseract.js');
  }
  return Tesseract;
}

class OCRService {
  constructor() {
    this.isProcessing = false;
    this.tempFiles = new Set();
  }

  async captureAndProcess() {
    console.log('[OCR] captureAndProcess: ==== START ====');
    try {
      if (this.isProcessing) {
        throw new Error('OCR operation already in progress');
      }

      this.isProcessing = true;
      console.log('[OCR] captureAndProcess: set isProcessing true');

      const startTime = Date.now();
      console.log('[OCR] captureAndProcess: about to call captureScreenshot');

      const screenshot = await this.captureScreenshot();
      console.log('[OCR] captureAndProcess: captureScreenshot done');

      const extractedText = await this.performOCR(screenshot);
      console.log('[OCR] captureAndProcess: performOCR done');

      this.isProcessing = false;
      this.cleanup();

      return {
        text: extractedText.trim(),
        metadata: {
          timestamp: new Date().toISOString(),
          source: screenshot.metadata,
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      console.error('[OCR] captureAndProcess: ERROR:', error.message, error.stack);
      this.isProcessing = false;
      this.cleanup();
      throw error;
    }
  }

  async captureScreenshot() {
    console.log('[OCR] captureScreenshot: calling getSources');
    const dc = getDesktopCapturer();

    const sources = await dc.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });

    console.log('[OCR] captureScreenshot: got sources', { count: sources.length });

    if (sources.length === 0) {
      throw new Error('No screen sources available for capture');
    }

    const primarySource = sources[0];
    const image = primarySource.thumbnail;

    if (!image) {
      throw new Error('Failed to capture screen thumbnail');
    }

    console.log('[OCR] captureScreenshot: done, image size:', image.getSize());

    return {
      image,
      metadata: {
        sourceName: primarySource.name,
        dimensions: image.getSize(),
        captureTime: new Date().toISOString()
      }
    };
  }

  async performOCR(screenshot) {
    console.log('[OCR] performOCR: creating temp file');
    const tempPath = this.createTempFile(screenshot.image);
    console.log('[OCR] performOCR: temp file created at', tempPath);

    console.log('[OCR] performOCR: calling Tesseract.recognize');
    const Tess = getTesseract();

    // In packaged app process.cwd() = '/' so Tesseract can't find eng.traineddata.
    // Resolve the correct path based on whether app is packaged or not.
    const { app } = require('electron');
    const langPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked')
      : path.join(__dirname, '..', '..');

    console.log('[OCR] performOCR: langPath =', langPath, '| isPackaged =', app.isPackaged);

    const { data: { text } } = await Tess.recognize(tempPath, 'eng', {
      langPath,
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log('[OCR] progress:', Math.round(m.progress * 100) + '%');
        }
      }
    });
    console.log('[OCR] performOCR: Tesseract returned', { textLength: text.length });

    const cleanText = this.sanitizeText(text);
    return cleanText;
  }

  createTempFile(image) {
    const tempDir = config.get('ocr.tempDir') || '/tmp/klaude-ocr';
    const tempPath = path.join(
      tempDir,
      `Klaude-screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
    );

    console.log('[OCR] createTempFile: mkdir for', tempDir);
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });

    const buffer = image.toPNG();
    console.log('[OCR] createTempFile: writing PNG, size:', buffer.length);
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
    console.log('[OCR] cleanup: cleaning', this.tempFiles.size, 'files');
    for (const tempFile of this.tempFiles) {
      try {
        fs.unlinkSync(tempFile);
      } catch (error) {
        console.error('[OCR] cleanup: failed to delete', tempFile, error.message);
      }
    }
    this.tempFiles.clear();
  }

  getStatus() {
    return {
      isProcessing: this.isProcessing,
      tempFilesCount: this.tempFiles.size,
      config: {
        language: config.get('ocr.language'),
        tempDir: config.get('ocr.tempDir')
      }
    };
  }
}

module.exports = new OCRService();
