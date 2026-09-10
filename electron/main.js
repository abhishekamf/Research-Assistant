/**
 * Research AI Assistant - Electron main process
 * Author: Abhishek <abhishek.aks@gmail.com> | https://github.com/abhishekamf
 *
 * Creates the app window and bridges the renderer (UI) to the server layer
 * (document processing, RAG, academic search, citations, data analysis)
 * through a single IPC dispatch channel.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const api = require('../server/api');

let win = null;

// Allow a custom data directory (optional): RESEARCHAI_DATA=/path/to/data
process.env.RESEARCHAI_DATA = process.env.RESEARCHAI_DATA || '';

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d1021',
    title: 'Research AI Assistant',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Open external links (DOI, GitHub, arXiv...) in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.RESEARCHAI_DEV === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => { win = null; });
}

// Events pushed from server -> renderer (chat tokens, progress, statuses)
function sendEvent(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('evt', { type, ...payload });
}
api.setEventSender(sendEvent);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'Research AI Assistant',
        submenu: [
          { label: 'About Research AI Assistant', click: () => sendEvent('ui:about', {}) },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }
    ]));

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Single IPC dispatch channel: renderer calls window.researchai.call(method, ...args)
ipcMain.handle('call', async (_event, method, args) => {
  try {
    const result = await api.dispatch(String(method), Array.isArray(args) ? args : []);
    return { ok: true, result };
  } catch (err) {
    console.error(`[api:${method}]`, err);
    return { ok: false, error: (err && err.message) || String(err) };
  }
});

// File/folder dialogs (called from server layer too)
ipcMain.handle('dialog:openFiles', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    ...(opts || {})
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:saveFile', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, opts || {});
  return r.canceled ? null : r.filePath;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
  sendEvent('app:log', { message: String((err && err.message) || err) });
});
