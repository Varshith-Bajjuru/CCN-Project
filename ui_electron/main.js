const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const UdpClient = require('./udpClientWin');
const crypto = require('crypto');
const fs = require('fs');

let mainWindow;
let udpClient = null;
let metricsEnabled = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers
ipcMain.handle('udp:init', async (event, { host, port }) => {
  if (udpClient) {
    udpClient.close();
    udpClient = null;
  }
  udpClient = new UdpClient(host, port, (log) => {
    mainWindow.webContents.send('log:append', log);
  });
  if (metricsEnabled && udpClient.setMetricsCb) {
    udpClient.setMetricsCb((payload) => {
      mainWindow.webContents.send('metrics:update', payload);
    });
  }
  return { ok: true };
});

ipcMain.handle('cmd:ls', async () => {
  if (!udpClient) throw new Error('UDP client not initialized');
  const res = await udpClient.list();
  return res;
});

ipcMain.handle('cmd:delete', async (event, filename) => {
  if (!udpClient) throw new Error('UDP client not initialized');
  const res = await udpClient.delete(filename);
  return res;
});

ipcMain.handle('cmd:get', async (event, filename) => {
  if (!udpClient) throw new Error('UDP client not initialized');
  const saveTo = dialog.showSaveDialogSync(mainWindow, { defaultPath: filename, title: 'Save file as' });
  if (!saveTo) return { ok: false, error: 'Save cancelled' };
  const res = await udpClient.get(filename, saveTo);
  return res;
});

ipcMain.handle('cmd:put', async () => {
  if (!udpClient) throw new Error('UDP client not initialized');
  const files = dialog.showOpenDialogSync(mainWindow, { properties: ['openFile'] });
  if (!files || files.length === 0) return { ok: false, error: 'No file selected' };
  const filePath = files[0];
  const res = await udpClient.put(filePath);
  return res;
});

ipcMain.handle('cmd:exit', async () => {
  if (!udpClient) return { ok: true };
  try { await udpClient.exit(); } catch (e) {}
  udpClient.close();
  udpClient = null;
  return { ok: true };
});

// Metrics streaming
ipcMain.handle('metrics:enable', async () => {
  metricsEnabled = true;
  if (udpClient && udpClient.setMetricsCb) {
    udpClient.setMetricsCb((payload) => {
      mainWindow.webContents.send('metrics:update', payload);
    });
  }
  return { ok: true };
});

// Analyzer: ping (approximate RTT)
ipcMain.handle('analyze:ping', async () => {
  if (!udpClient || !udpClient.ping) throw new Error('UDP client not initialized');
  return await udpClient.ping();
});

// Utility: checksum a local file (SHA-256)
ipcMain.handle('util:checksum', async (_evt, filePath) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return await new Promise((resolve, reject) => {
    stream.on('data', (d) => hash.update(d));
    stream.on('error', (e) => reject({ ok: false, error: e.message }));
    stream.on('end', () => resolve({ ok: true, algo: 'sha256', digest: hash.digest('hex') }));
  });
});

// Drag-and-drop: put multiple paths (sequentially)
ipcMain.handle('cmd:putPaths', async (_evt, paths) => {
  if (!udpClient) throw new Error('UDP client not initialized');
  const results = [];
  for (const p of paths) {
    try {
      const res = await udpClient.put(p);
      results.push({ path: p, ...res });
    } catch (e) {
      results.push({ path: p, ok: false, error: e.message });
    }
  }
  return { ok: true, results };
});
