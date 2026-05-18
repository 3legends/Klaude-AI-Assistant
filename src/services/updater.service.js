/**
 * updater.service.js
 * Auto-update via electron-updater + GitHub Releases.
 * - Checks silently 3s after launch
 * - Downloads in background
 * - Shows banner in main window when ready
 * - Installs on next quit
 * - All errors are non-fatal — never crashes the app
 */

const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const logger = require('../core/logger').createServiceLogger('UPDATER');

class UpdaterService {
  constructor() {
    this._updateDownloaded = false;
    this._checking         = false;
  }

  init() {
    if (!app.isPackaged) {
      logger.info('Skipping auto-update check (development mode)');
      return;
    }

    this._configure();
    this._registerListeners();
    setTimeout(() => this.checkForUpdates(), 3000);
  }

  _configure() {
    autoUpdater.autoDownload         = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    logger.info('Auto-updater configured', { channel: autoUpdater.channel || 'latest' });
  }

  _registerListeners() {
    autoUpdater.on('checking-for-update', () => {
      this._checking = true;
      logger.info('Checking for updates…');
    });

    autoUpdater.on('update-available', (info) => {
      this._checking = false;
      logger.info('Update available', { version: info.version });
      this._notifyAllWindows('update-available', { version: info.version, notes: info.releaseNotes || '' });
    });

    autoUpdater.on('update-not-available', (info) => {
      this._checking = false;
      logger.info('App is up to date', { version: info.version });
    });

    autoUpdater.on('download-progress', (progress) => {
      this._notifyAllWindows('update-download-progress', { percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this._updateDownloaded = true;
      logger.info('Update downloaded — will install on next quit', { version: info.version });
      this._notifyAllWindows('update-downloaded', { version: info.version, notes: info.releaseNotes || '' });
    });

    autoUpdater.on('error', (err) => {
      this._checking = false;
      logger.warn('Auto-update error (non-fatal)', { error: err.message });
    });
  }

  checkForUpdates() {
    if (!app.isPackaged) return;
    if (this._checking) return;
    try {
      const result = autoUpdater.checkForUpdates();
      if (result && typeof result.then === 'function') {
        result.catch(err => {
          this._checking = false;
          logger.warn('checkForUpdates rejected (non-fatal)', { error: err.message || String(err) });
        });
      }
    } catch (err) {
      this._checking = false;
      logger.warn('checkForUpdates threw (non-fatal)', { error: err.message });
    }
  }

  quitAndInstall() {
    if (this._updateDownloaded) {
      logger.info('User triggered quit and install');
      autoUpdater.quitAndInstall(false, true);
    }
  }

  isUpdateDownloaded() {
    return this._updateDownloaded;
  }

  _notifyAllWindows(channel, data) {
    try {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('auto-updater-event', { type: channel, ...data });
        }
      });
    } catch (err) {
      logger.warn('Failed to notify windows', { error: err.message });
    }
  }
}

module.exports = new UpdaterService();