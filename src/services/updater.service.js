/**
 * updater.service.js
 * Auto-update service using electron-updater + GitHub Releases.
 *
 * Behaviour:
 *   - Checks for updates silently 3 seconds after app ready
 *   - Downloads update in background (no user prompt)
 *   - Notifies user once download is complete via a subtle tray/window message
 *   - Installs on next app quit (quitAndInstall)
 *   - Never blocks the user or interrupts their session
 *
 * In development (npm start):
 *   - Update check is skipped entirely (app.isPackaged = false)
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
    // Skip in development — electron-updater requires a packaged app
    if (!app.isPackaged) {
      logger.info('Skipping auto-update check (development mode)');
      return;
    }

    this._configure();
    this._registerListeners();

    // Check for updates 3s after launch — non-blocking
    setTimeout(() => this.checkForUpdates(), 3000);
  }

  _configure() {
    // Silent download — don't auto-install, wait for user to quit
    autoUpdater.autoDownload    = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Disable update dialog — we handle notifications ourselves
    autoUpdater.autoRunAppAfterInstall = true;

    logger.info('Auto-updater configured', {
      channel: autoUpdater.channel || 'latest',
    });
  }

  _registerListeners() {
    autoUpdater.on('checking-for-update', () => {
      this._checking = true;
      logger.info('Checking for updates…');
    });

    autoUpdater.on('update-available', (info) => {
      this._checking = false;
      logger.info('Update available', {
        version:      info.version,
        releaseDate:  info.releaseDate,
      });
      // Downloading starts automatically (autoDownload: true)
      this._notifyAllWindows('update-available', {
        version: info.version,
        notes:   info.releaseNotes || '',
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this._checking = false;
      logger.info('App is up to date', { version: info.version });
    });

    autoUpdater.on('download-progress', (progress) => {
      logger.debug('Update download progress', {
        percent:       Math.round(progress.percent),
        transferred:   Math.round(progress.transferred / 1024 / 1024) + ' MB',
        total:         Math.round(progress.total / 1024 / 1024) + ' MB',
        bytesPerSecond: Math.round(progress.bytesPerSecond / 1024) + ' KB/s',
      });
      this._notifyAllWindows('update-download-progress', {
        percent: Math.round(progress.percent),
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this._updateDownloaded = true;
      logger.info('Update downloaded — will install on next quit', {
        version: info.version,
      });
      // Tell all windows so they can show a gentle "restart to update" prompt
      this._notifyAllWindows('update-downloaded', {
        version: info.version,
        notes:   info.releaseNotes || '',
      });
    });

    autoUpdater.on('error', (err) => {
      this._checking = false;
      // Non-fatal — log but don't surface to user unless debug needed
      logger.warn('Auto-update error (non-fatal)', {
        error: err.message,
      });
    });
  }

  checkForUpdates() {
    if (!app.isPackaged) return;
    if (this._checking)  return;
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      logger.warn('checkForUpdates failed', { error: err.message });
    }
  }

  // Call this when user explicitly clicks "Restart to update"
  quitAndInstall() {
    if (this._updateDownloaded) {
      logger.info('User triggered quit and install');
      autoUpdater.quitAndInstall(false, true);
    }
  }

  isUpdateDownloaded() {
    return this._updateDownloaded;
  }

  // Broadcast update events to all renderer windows
  _notifyAllWindows(channel, data) {
    try {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('auto-updater-event', { type: channel, ...data });
        }
      });
    } catch (err) {
      logger.warn('Failed to notify windows of update event', { error: err.message });
    }
  }
}

module.exports = new UpdaterService();