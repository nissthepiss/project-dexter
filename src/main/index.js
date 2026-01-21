const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let backendProcess = null;
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');

function startBackend() {
  const backendPath = path.join(__dirname, '../backend/server.mjs');
  
  // Start the backend server
  backendProcess = spawn('node', [backendPath], {
    cwd: path.join(__dirname, '../../'),
    stdio: 'inherit',
    detached: false,
    windowsHide: true // Hide CMD window on Windows
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend server...');
    
    // Kill the process and all its children
    if (process.platform === 'win32') {
      // On Windows, use taskkill to ensure the process tree is terminated
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
    
    backendProcess = null;
  }
}

function loadWindowState() {
  try {
    if (fs.existsSync(windowStateFile)) {
      const data = fs.readFileSync(windowStateFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load window state:', err);
  }
  return { width: 1400, height: 900 }; // Defaults
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(windowStateFile, JSON.stringify(bounds), 'utf8');
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

function createWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width || 1400,
    height: windowState.height || 900,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1000,
    minHeight: 600,
    frame: false, // Remove standard window frame
    titleBarStyle: 'hidden', // Hide title bar
    autoHideMenuBar: true, // Hide menu bar (File, Edit, View, etc.)
    icon: path.join(__dirname, '../../assets/icon.ico'), // App icon
    backgroundColor: '#070707', // Match title bar color
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const startUrl = `file://${path.join(__dirname, '../renderer/index.html')}`;
  mainWindow.loadURL(startUrl);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Save window state on resize/move
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  
  mainWindow.on('closed', () => {
    saveWindowState(); // Save state before closing
    mainWindow = null;
    stopBackend(); // Stop backend when window closes
  });
}

// IPC handlers for window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

app.on('ready', () => {
  startBackend(); // Start backend before creating window
  
  // Wait a moment for backend to start
  setTimeout(() => {
    createWindow();
  }, 2000);
});

app.on('window-all-closed', () => {
  stopBackend(); // Stop backend when all windows close
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle app quit - ensure backend is stopped
app.on('before-quit', () => {
  stopBackend();
});
