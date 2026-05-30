const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false 
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.maximize();
  
  win.once('ready-to-show', () => {
    win.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  // No more dynamic dock switching! It will just use your default build icon.
});

ipcMain.handle('get-files', async (event, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath);
    const filtered = files.filter(f => /\.(jpg|jpeg|png|gif|mp4|webm|mov)$/i.test(f));
    return { folderName: path.basename(folderPath), filePaths: filtered.map(f => path.join(folderPath, f)) };
  } catch (err) { return { error: "Folder not found" }; }
});

ipcMain.handle('reveal', (event, filePath) => { if (filePath) shell.showItemInFolder(filePath); });

ipcMain.handle('set-wallpaper', async (event, filePath) => {
    const script = `osascript -e 'tell application "System Events" to set picture of every desktop to POSIX file "${filePath}"'`;
    exec(script);
});

ipcMain.handle('quit-app', () => {
    app.quit();
});