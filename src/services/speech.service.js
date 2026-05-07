// Speech Service - Using OpenAI Whisper for speech recognition
const EventEmitter = require('events');
const logger = require('../core/logger').createServiceLogger('SPEECH');
const config = require('../core/config');
const whisperService = require('./whisper.service');
const recorder = require('node-record-lpcm16');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SpeechService extends EventEmitter {
  constructor() {
    super();
    this.isRecording = false;
    this.isInitialized = false;
    this.sessionStartTime = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.recording = null;
    this.audioBuffer = [];
    this.tempDir = path.join(os.tmpdir(), 'klaude-speech');
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async initialize() {
    try {
      const modelName = process.env.WHISPER_MODEL || 'base.en';
      const useGPU = process.env.WHISPER_GPU !== 'false';

      logger.info('Initializing Whisper speech service', {
        model: modelName,
        gpu: useGPU ? 'enabled' : 'disabled'
      });

      await whisperService.initialize({ modelName, useGPU });

      // Ensure temp directory exists
      fs.mkdirSync(this.tempDir, { recursive: true });

      this.isInitialized = true;
      logger.info('Whisper speech service initialized successfully', { model: modelName });
      return true;

    } catch (error) {
      logger.error('Whisper initialization failed', { error: error.message });
      throw error;
    }
  }

  // ─── Public API (called by main.js) ────────────────────────────────────────

  /**
   * Start recording. Called by:
   *   - ipcMain handler 'start-speech-recognition'
   *   - toggleSpeechRecognition() via Alt+R shortcut
   */
  async startRecording() {
    try {
      // Auto-initialize on first use
      if (!this.isInitialized) {
        logger.info('Auto-initializing Whisper before recording...');
        await this.initialize();
      }

      if (this.isRecording) {
        logger.warn('Recording already in progress');
        return;
      }

      this.isRecording = true;
      this.sessionStartTime = Date.now();
      this.retryCount = 0;
      this.audioBuffer = [];

      // Emit recording-started immediately so UI updates right away
      this.emit('recording-started');
      this.emit('status', 'Recording started');

      logger.info('Speech recording started');

      this._startMicrophoneCapture();

    } catch (error) {
      this.isRecording = false;
      logger.error('Failed to start recording', { error: error.message });
      this.emit('error', error.message);
      throw error;
    }
  }

  /**
   * Stop recording and process accumulated audio through Whisper.
   * Called by:
   *   - ipcMain handler 'stop-speech-recognition'
   *   - toggleSpeechRecognition() via Alt+R shortcut
   */
  stopRecording() {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;
    const sessionDuration = this.sessionStartTime ? Date.now() - this.sessionStartTime : 0;
    logger.info('Stopping speech recording', { sessionDuration: `${sessionDuration}ms` });

    // Stop the microphone capture
    this._stopMicrophoneCapture();

    // Process whatever audio we have
    this._processAudioBuffer();
  }

  // Aliases used by startRecognition / stopRecognition naming in older code paths
  async startRecognition() { return this.startRecording(); }
  stopRecognition() { return this.stopRecording(); }

  // ─── Microphone Capture ────────────────────────────────────────────────────

  _startMicrophoneCapture() {
    try {
      if (!recorder || typeof recorder.record !== 'function') {
        throw new Error('node-record-lpcm16 not available');
      }

      this.recording = recorder.record({
        sampleRateHertz: 16000,
        threshold: 0,
        verbose: false,
        recordProgram: 'sox',
        silence: '10.0s'   // auto-stop after 10s silence (same as Azure version)
      });

      logger.info('Microphone capture started');

      this.recording.stream().on('data', (chunk) => {
        if (this.isRecording) {
          this.audioBuffer.push(chunk);
        }
      });

      // sox auto-stopped due to silence — process automatically
      this.recording.stream().on('end', () => {
        if (this.isRecording) {
          logger.info('sox silence timeout — auto-processing audio');
          this.isRecording = false;
          this.emit('recording-stopped');
          this.emit('status', 'Processing...');
          this._processAudioBuffer();
        }
      });

      this.recording.stream().on('error', (error) => {
        logger.error('Audio stream error', { error: error.message });

        // Try fallback recording program
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          logger.info(`Retrying with fallback (attempt ${this.retryCount}/${this.maxRetries})`);
          this._stopMicrophoneCapture();
          setTimeout(() => this._startMicrophoneCaptureWithFallback(), 500);
        } else {
          this.isRecording = false;
          this.emit('error', `Microphone error: ${error.message}`);
        }
      });

    } catch (error) {
      logger.error('Failed to start microphone capture', { error: error.message });
      this.isRecording = false;
      this.emit('error', `Microphone capture failed: ${error.message}`);
    }
  }

  _startMicrophoneCaptureWithFallback() {
    const fallbackPrograms = ['rec', 'arecord'];
    const program = fallbackPrograms[this.retryCount - 1] || 'sox';

    logger.info(`Trying fallback recording program: ${program}`);

    try {
      this.recording = recorder.record({
        sampleRateHertz: 16000,
        threshold: 0,
        verbose: false,
        recordProgram: program,
        silence: '10.0s'
      });

      this.recording.stream().on('data', (chunk) => {
        if (this.isRecording) {
          this.audioBuffer.push(chunk);
        }
      });

      this.recording.stream().on('end', () => {
        if (this.isRecording) {
          this.isRecording = false;
          this.emit('recording-stopped');
          this._processAudioBuffer();
        }
      });

      this.recording.stream().on('error', (err) => {
        logger.error(`Fallback program ${program} also failed`, { error: err.message });
        this.isRecording = false;
        this.emit('error', 'Could not start microphone with any audio program. Is sox installed?');
      });

    } catch (error) {
      logger.error('Fallback recording failed', { error: error.message });
      this.isRecording = false;
      this.emit('error', `Recording failed: ${error.message}`);
    }
  }

  _stopMicrophoneCapture() {
    if (this.recording) {
      try {
        this.recording.stop();
      } catch (error) {
        logger.error('Error stopping recording', { error: error.message });
      }
      this.recording = null;
    }

    // Emit stopped so UI updates immediately
    this.emit('recording-stopped');
    this.emit('status', 'Processing...');
  }

  // ─── Audio Processing ──────────────────────────────────────────────────────

  async _processAudioBuffer() {
    if (this.audioBuffer.length === 0) {
      logger.warn('No audio data captured');
      this.emit('status', 'No audio captured');
      return;
    }

    const totalBytes = this.audioBuffer.reduce((sum, b) => sum + b.length, 0);
    logger.info('Processing audio buffer', {
      chunks: this.audioBuffer.length,
      totalBytes
    });

    let wavFile = null;

    try {
      // Combine all chunks into one buffer
      const rawPCM = Buffer.concat(this.audioBuffer);
      this.audioBuffer = [];

      // Write as proper WAV file (sox records raw PCM — Whisper needs WAV header)
      wavFile = path.join(this.tempDir, `speech_${Date.now()}.wav`);
      this._writeWavFile(wavFile, rawPCM, 16000, 1, 16);

      logger.info('WAV file written', {
        path: wavFile,
        size: fs.statSync(wavFile).size
      });

      // Send to Whisper
      this.emit('status', 'Transcribing...');
      const transcript = await whisperService.recognizeFromFile(wavFile);

      if (!transcript || transcript.trim().length === 0) {
        logger.info('No speech detected in audio');
        this.emit('status', 'No speech detected');
        return;
      }

      const cleanTranscript = transcript.trim();
      logger.info('Transcription complete', {
        textLength: cleanTranscript.length,
        preview: cleanTranscript.substring(0, 80)
      });

      // Emit all events that main.js listens for
      this.emit('transcription', cleanTranscript);
      this.emit('interim-transcription', cleanTranscript);
      this.emit('status', 'Transcription complete');

    } catch (error) {
      logger.error('Audio processing failed', { error: error.message });
      this.emit('error', `Transcription failed: ${error.message}`);
    } finally {
      // Clean up temp WAV file
      if (wavFile && fs.existsSync(wavFile)) {
        try { fs.unlinkSync(wavFile); } catch (_) {}
      }
    }
  }

  /**
   * Write a proper WAV file from raw PCM data.
   * sox outputs raw LPCM16 — Whisper requires a RIFF/WAV header.
   */
  _writeWavFile(filePath, pcmBuffer, sampleRate, channels, bitDepth) {
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const dataSize = pcmBuffer.length;
    const headerSize = 44;
    const wavBuffer = Buffer.alloc(headerSize + dataSize);

    // RIFF chunk
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + dataSize, 4);
    wavBuffer.write('WAVE', 8);

    // fmt sub-chunk
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);          // sub-chunk size
    wavBuffer.writeUInt16LE(1, 20);           // PCM format
    wavBuffer.writeUInt16LE(channels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(bitDepth, 34);

    // data sub-chunk
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(wavBuffer, 44);

    fs.writeFileSync(filePath, wavBuffer);
  }

  // ─── Status & Utilities ────────────────────────────────────────────────────

  getStatus() {
    return {
      isRecording: this.isRecording,
      isInitialized: this.isInitialized,
      sessionDuration: this.sessionStartTime ? Date.now() - this.sessionStartTime : 0,
      model: whisperService.currentModel || (process.env.WHISPER_MODEL || 'base.en'),
      source: 'Whisper (local)',
      config: {
        model: process.env.WHISPER_MODEL || 'base.en',
        gpu: process.env.WHISPER_GPU !== 'false'
      }
    };
  }

  async testConnection() {
    try {
      return await whisperService.testConnection();
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async recognizeFromFile(audioFilePath) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return whisperService.recognizeFromFile(audioFilePath);
  }
}

module.exports = new SpeechService();