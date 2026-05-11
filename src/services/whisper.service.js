/**
 * Whisper Speech Recognition Service
 * Drop-in replacement for Azure Speech SDK
 * Uses OpenAI's Whisper model via nodejs-whisper
 * 
 * File: src/services/whisper.service.js
 * 
 * Installation:
 * npm install nodejs-whisper ffmpeg-static
 * 
 * Usage (identical to Azure):
 * const result = await whisperService.recognizeFromFile('audio.wav');
 */

const { nodewhisper } = require('nodejs-whisper');
const EventEmitter = require('events');
const logger = require('../core/logger').createServiceLogger('WHISPER');
const config = require('../core/config');
const path = require('path');
const fs = require('fs');

class WhisperService extends EventEmitter {
  constructor() {
    super();
    this.isRecording = false;
    this.isInitialized = false;
    this.currentModel = null;
    this.sessionStartTime = null;
    this.recognitionCount = 0;
    this.modelPath = null;
    this.lastError = null;
    // Cached after first successful resolution — never re-resolved mid-session
    this._resolvedCliPath   = null;
    this._resolvedModelPath = null;
    this._symlinksDone      = false;
  }

  /**
   * Initialize Whisper service
   * Similar to Azure Speech initialization
   * 
   * @param {Object} config - Configuration options
   * @param {string} config.modelName - Model to use (tiny.en, base.en, small.en, medium.en, large)
   * @param {string} config.modelPath - Path to custom model directory
   * @param {boolean} config.useGPU - Enable GPU acceleration if available
   * @returns {Promise<boolean>} - True if initialization successful
   */
  async initialize(config = {}) {
    try {
      this.currentModel = config.modelName || 'base.en';
      
      // Model options and their characteristics
      const modelInfo = {
        'tiny.en': { size: '39M', speed: 'fastest', accuracy: 'lowest' },
        'base.en': { size: '140M', speed: 'fast', accuracy: 'good' },
        'small.en': { size: '460M', speed: 'medium', accuracy: 'very good' },
        'medium.en': { size: '1.5G', speed: 'slow', accuracy: 'excellent' },
        'large': { size: '2.9G', speed: 'very slow', accuracy: 'best' }
      };

      const info = modelInfo[this.currentModel];
      
      logger.info('Whisper service initializing', {
        model: this.currentModel,
        framework: 'nodejs-whisper',
        modelInfo: info,
        GPU: config.useGPU !== false ? 'enabled (if available)' : 'disabled'
      });

      // Whisper loads model on first use, so we just verify it's available
      // The actual model download happens during first recognition
      this.isInitialized = true;

      logger.info('Whisper service initialized successfully', {
        model: this.currentModel,
        size: info?.size,
        accuracy: info?.accuracy
      });

      return true;

    } catch (error) {
      logger.error('Whisper initialization failed', {
        error: error.message,
        stack: error.stack
      });
      this.lastError = error;
      throw error;
    }
  }

  /**
   * Recognize speech from audio file
   * MAIN METHOD - Drop-in replacement for Azure's recognizeFromFile
   * 
   * @param {string} audioFilePath - Path to audio file (.wav, .mp3, .m4a, etc.)
   * @returns {Promise<string>} - Recognized text
   * @throws {Error} - If recognition fails
   */
  async recognizeFromFile(audioFilePath) {
    const startTime = Date.now();
    
    try {
      // Validate file exists
      if (!fs.existsSync(audioFilePath)) {
        throw new Error(`Audio file not found: ${audioFilePath}`);
      }

      if (!this.isInitialized) {
        throw new Error('Whisper service not initialized. Call initialize() first.');
      }

      logger.info('Starting Whisper file recognition', {
        filePath: audioFilePath,
        model: this.currentModel,
        fileSize: `${fs.statSync(audioFilePath).size} bytes`
      });

      // Resolve cli + model paths once per service lifetime and cache them.
      // Re-checking every call caused the second call to fail when dep-check
      // returned a different model path (userData fallback) that had no
      // corresponding whisper-cli symlink.
      const depCheck = require('./dep-check');
      const fsWh     = require('fs');
      const pathWh   = require('path');

      if (!this._resolvedCliPath || !this._resolvedModelPath) {
        const modelCheck = depCheck.checkWhisperModel();
        if (!modelCheck.ok) throw new Error('Whisper model not found. Please reinstall Klaude.');

        const cliCheck = depCheck.checkWhisperCli();
        if (!cliCheck.ok) throw new Error('whisper-cli not found. Please reinstall Klaude.');

        this._resolvedModelPath = modelCheck.path;
        this._resolvedCliPath   = cliCheck.path;
        logger.info('Whisper paths resolved and cached', {
          model: this._resolvedModelPath,
          cli:   this._resolvedCliPath,
        });
      }

      // Ensure symlinks exist in nodejs-whisper's hardcoded locations.
      // Only done once per session (_symlinksDone flag).
      if (!this._symlinksDone) {
        const whisperPkgEntry = require.resolve('nodejs-whisper');
        const whisperCppDir   = pathWh.join(pathWh.dirname(whisperPkgEntry), '..', 'cpp', 'whisper.cpp');

        // Model symlink
        const targetModelDir  = pathWh.join(whisperCppDir, 'models');
        const modelFileName   = pathWh.basename(this._resolvedModelPath);
        const targetModelPath = pathWh.join(targetModelDir, modelFileName);
        fsWh.mkdirSync(targetModelDir, { recursive: true });
        let needsModelLink = true;
        try { fsWh.accessSync(targetModelPath); needsModelLink = false; } catch (_) {}
        if (needsModelLink) {
          try { fsWh.symlinkSync(this._resolvedModelPath, targetModelPath); }
          catch (_) {
            try { fsWh.copyFileSync(this._resolvedModelPath, targetModelPath); }
            catch (e) { throw new Error('Could not place Whisper model: ' + e.message); }
          }
          logger.info('Whisper model linked to nodejs-whisper location');
        }

        // CLI symlink
        const targetBinDir  = pathWh.join(whisperCppDir, 'build', 'bin');
        const cliBinName    = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
        const targetCliPath = pathWh.join(targetBinDir, cliBinName);
        fsWh.mkdirSync(targetBinDir, { recursive: true });
        let needsCliLink = true;
        try { fsWh.accessSync(targetCliPath); needsCliLink = false; } catch (_) {}
        if (needsCliLink) {
          try { fsWh.symlinkSync(this._resolvedCliPath, targetCliPath); }
          catch (_) {
            try { fsWh.copyFileSync(this._resolvedCliPath, targetCliPath); }
            catch (e) { throw new Error('Could not place whisper-cli: ' + e.message); }
          }
          logger.info('whisper-cli linked to nodejs-whisper location');
        }

        this._symlinksDone = true;
      }

      const modelFileName     = pathWh.basename(this._resolvedModelPath);
      const resolvedModelName = modelFileName.replace(/^ggml-/, '').replace(/\.bin$/, '');
      logger.info('Calling nodewhisper', { modelName: resolvedModelName });

      const result = await nodewhisper(audioFilePath, {
        modelName: resolvedModelName,
        removeWavFileAfterTranscription: false,
        withCuda: false,
        whisperOptions: {
          outputInText: true,
          outputInSrt: false,
          outputInVtt: false,
          outputInCsv: false,
          outputInJson: false,
          translateToEnglish: false,
          wordTimestamps: false,
          language: 'auto'
        }
      });
      // nodewhisper returns an array of segments [{start, end, speech}]
      // join them all into one transcript string
      const transcript = Array.isArray(result)
        ? result.map(s => (s.speech || s.text || '')).join(' ').trim()
        : (typeof result === 'string' ? result.trim() : '');

      const duration = Date.now() - startTime;
      const textLength = transcript.length;
      const wordCount = transcript.split(/\s+/).filter(w => w.length > 0).length;

      // Emit event for compatibility with existing code
      this.emit('recognize', {
        text: transcript,
        isFinal: true,
        confidence: null, // Whisper doesn't provide confidence
        timestamp: Date.now(),
        duration: duration,
        wordCount: wordCount
      });

      logger.info('File recognition completed successfully', {
        duration: `${duration}ms`,
        textLength,
        wordCount,
        model: this.currentModel
      });

      this.recognitionCount++;
      return transcript;

    } catch (error) {
      this.lastError = error;
      logger.error('File recognition failed', {
        filePath: audioFilePath,
        error: error.message,
        stack: error.stack
      });
      
      this.emit('error', {
        code: 'RECOGNITION_FAILED',
        message: error.message,
        timestamp: Date.now()
      });

      throw error;
    }
  }

  /**
   * Recognize from audio buffer (for streaming/real-time)
   * 
   * @param {Buffer} audioBuffer - Audio data as buffer
   * @param {Object} options - Recognition options
   * @returns {Promise<string>} - Recognized text
   */
  async recognizeFromBuffer(audioBuffer, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!this.isInitialized) {
        throw new Error('Whisper service not initialized');
      }

      logger.info('Starting buffer recognition', {
        bufferSize: audioBuffer.length,
        model: this.currentModel
      });

      // Save buffer to temporary file
      const tmpFile = path.join(require('os').tmpdir(), `whisper_${Date.now()}.wav`);
      fs.writeFileSync(tmpFile, audioBuffer);

      try {
        // Recognize using temporary file.
        // Uses the same cached paths as recognizeFromFile — no re-resolution.
        const pathBuf = require('path');

        // Ensure paths are resolved (may not have been if buffer path called first)
        if (!this._resolvedCliPath || !this._resolvedModelPath) {
          const depCheckBuf = require('./dep-check');
          const modelCheckBuf = depCheckBuf.checkWhisperModel();
          if (!modelCheckBuf.ok) throw new Error('Whisper model not found. Please reinstall Klaude.');
          const cliCheckBuf = depCheckBuf.checkWhisperCli();
          if (!cliCheckBuf.ok) throw new Error('whisper-cli not found. Please reinstall Klaude.');
          this._resolvedModelPath = modelCheckBuf.path;
          this._resolvedCliPath   = cliCheckBuf.path;
        }

        const modelFileNameBuf     = pathBuf.basename(this._resolvedModelPath);
        const resolvedModelNameBuf = modelFileNameBuf.replace(/^ggml-/, '').replace(/\.bin$/, '');

        const bufResult = await nodewhisper(tmpFile, {
          modelName: resolvedModelNameBuf,
          removeWavFileAfterTranscription: false,
          withCuda: false,
          whisperOptions: {
            outputInText: true,
            outputInSrt: false,
            outputInVtt: false,
            outputInCsv: false,
            outputInJson: false,
            translateToEnglish: false,
            wordTimestamps: false,
            language: 'auto'
          }
        });
        const transcript = Array.isArray(bufResult)
          ? bufResult.map(s => (s.speech || s.text || '')).join(' ').trim()
          : (typeof bufResult === 'string' ? bufResult.trim() : '');

        logger.info('Buffer recognition completed', {
          duration: Date.now() - startTime,
          textLength: transcript.length
        });

        return transcript;

      } finally {
        // Clean up temporary file
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }

    } catch (error) {
      logger.error('Buffer recognition failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Start real-time streaming recognition
   * For voice commands during interview
   * 
   * @param {Stream} audioStream - Audio stream
   * @returns {Promise<void>}
   */
  async startStreaming(audioStream) {
    try {
      if (!this.isInitialized) {
        throw new Error('Whisper service not initialized');
      }

      this.isRecording = true;
      this.sessionStartTime = Date.now();

      logger.info('Starting stream recognition');

      let audioBuffer = [];

      // Collect audio chunks
      audioStream.on('data', (chunk) => {
        audioBuffer.push(chunk);

        // Emit interim results every 1 second or when buffer reaches 16KB
        if (Date.now() - this.sessionStartTime > 1000 || 
            audioBuffer.length > 16) {
          this.emit('interim', {
            bufferSize: audioBuffer.length,
            timestamp: Date.now()
          });
        }
      });

      // Process collected audio when stream ends
      audioStream.on('end', async () => {
        try {
          if (audioBuffer.length === 0) {
            this.emit('error', { message: 'No audio data received' });
            return;
          }

          const fullAudio = Buffer.concat(audioBuffer);
          const transcript = await this.recognizeFromBuffer(fullAudio);

          this.emit('recognize', {
            text: transcript,
            isFinal: true,
            duration: Date.now() - this.sessionStartTime
          });

          this.isRecording = false;
          this.recognitionCount++;

        } catch (error) {
          logger.error('Stream processing error', { error: error.message });
          this.emit('error', { message: error.message });
          this.isRecording = false;
        }
      });

      audioStream.on('error', (error) => {
        logger.error('Audio stream error', { error: error.message });
        this.emit('error', { message: error.message });
        this.isRecording = false;
      });

    } catch (error) {
      logger.error('Failed to start streaming', { error: error.message });
      this.isRecording = false;
      throw error;
    }
  }

  /**
   * Stop current recognition
   * For compatibility with Azure API
   */
  stopRecognition() {
    this.isRecording = false;
    logger.info('Recognition stopped');
  }

  /**
   * Get current service status
   * 
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      isInitialized: this.isInitialized,
      model: this.currentModel,
      source: 'Whisper (OpenAI)',
      framework: 'nodejs-whisper',
      recognitionCount: this.recognitionCount,
      sessionDuration: this.sessionStartTime ? 
        Date.now() - this.sessionStartTime : 0,
      lastError: this.lastError ? {
        message: this.lastError.message,
        time: new Date().toISOString()
      } : null
    };
  }

  /**
   * Set model for recognition
   * Larger models = better accuracy but slower
   * 
   * @param {string} modelName - Model name (tiny.en, base.en, small.en, medium.en, large)
   */
  setModel(modelName) {
    const validModels = ['tiny.en', 'base.en', 'small.en', 'medium.en', 'large'];
    
    if (!validModels.includes(modelName)) {
      throw new Error(`Invalid model: ${modelName}. Valid options: ${validModels.join(', ')}`);
    }

    this.currentModel = modelName;
    logger.info('Whisper model changed', { model: modelName });

    // Emit event
    this.emit('modelChanged', { model: modelName });
  }

  /**
   * Get available models with info
   * 
   * @returns {Object} - Model information
   */
  getAvailableModels() {
    return {
      'tiny.en': {
        description: 'Fastest, lowest accuracy',
        size: '39MB',
        recommendedFor: 'Real-time on weak hardware'
      },
      'base.en': {
        description: 'Good balance of speed/accuracy',
        size: '140MB',
        recommendedFor: 'Most interview scenarios (RECOMMENDED)'
      },
      'small.en': {
        description: 'Better accuracy, slower',
        size: '460MB',
        recommendedFor: 'Important interviews, technical terms'
      },
      'medium.en': {
        description: 'Very good accuracy, much slower',
        size: '1.5GB',
        recommendedFor: 'Critical scenarios with background noise'
      },
      'large': {
        description: 'Best accuracy, very slow',
        size: '2.9GB',
        recommendedFor: 'Batch processing, non-real-time'
      }
    };
  }

  /**
   * Test connection/availability
   * 
   * @returns {Promise<Object>} - Test result
   */
  async testConnection() {
    try {
      if (!this.isInitialized) {
        return {
          success: false,
          message: 'Whisper service not initialized',
          details: 'Call initialize() first'
        };
      }

      return {
        success: true,
        message: 'Whisper service is available',
        model: this.currentModel,
        framework: 'nodejs-whisper',
        status: 'ready'
      };

    } catch (error) {
      return {
        success: false,
        message: 'Whisper service test failed',
        error: error.message
      };
    }
  }

  /**
   * Comparison with Azure Speech
   * For research/documentation
   * 
   * @returns {Object} - Comparison data
   */
  getComparisonMetrics() {
    return {
      whisper: {
        cost: 'Free (open-source)',
        accuracy: 'Excellent (5-15% WER)',
        languages: '50+',
        fileSupport: 'Yes',
        streaming: 'Yes',
        confidence: 'Not provided',
        customModels: 'Yes (fine-tuning possible)',
        offlineSupport: 'Full',
        setupTime: '30 min (model download)',
        processingTime: '1-3 sec per 30 sec audio',
        advantage: 'Best accuracy, fully offline, no dependencies'
      },
      azure: {
        cost: 'Free tier (5 hrs/month)',
        accuracy: 'Excellent (13-23% WER)',
        languages: '140+',
        fileSupport: 'Yes',
        streaming: 'Yes (real-time)',
        confidence: 'Yes (0-100)',
        customModels: 'Yes',
        offlineSupport: 'Partial (edge)',
        setupTime: '5 min (API key only)',
        processingTime: '0.5 sec (cloud)',
        advantage: 'Most languages, ready to use'
      }
    };
  }

  /**
   * Get performance metrics
   * 
   * @returns {Object} - Performance data
   */
  getPerformanceMetrics() {
    return {
      recognitionCount: this.recognitionCount,
      averageProcessingTime: this.recognitionCount > 0 ? 
        'Track via logging' : 'No data',
      modelsAvailable: this.getAvailableModels(),
      currentModel: this.currentModel,
      initialized: this.isInitialized
    };
  }

  /**
   * Reset service state
   */
  reset() {
    try {
      this.stopRecognition();
      this.recognitionCount = 0;
      this.sessionStartTime = null;
      this.lastError = null;
      logger.info('Whisper service reset');
    } catch (error) {
      logger.error('Error resetting service', { error: error.message });
    }
  }

  /**
   * Cleanup and destroy service
   */
  destroy() {
    try {
      this.stopRecognition();
      this.removeAllListeners();
      this.isInitialized = false;
      logger.info('Whisper service destroyed');
    } catch (error) {
      logger.error('Error destroying service', { error: error.message });
    }
  }
}

// Export singleton instance
module.exports = new WhisperService();