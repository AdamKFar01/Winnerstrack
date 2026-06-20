const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

app.disableHardwareAcceleration();

const PORT = 5001;
let mainWindow;
let flaskProcess;

function startFlask() {
    const scriptPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.py')
        : path.join(__dirname, 'app.py');

    const cwd = app.isPackaged ? process.resourcesPath : __dirname;

    // When packaged, write the DB to the user's app data folder (writable)
    const dbPath = app.isPackaged
        ? path.join(app.getPath('userData'), 'wintracker.db')
        : path.join(__dirname, 'wintracker.db');

    // Electron strips PATH — prepend common Python locations so Flask is found
    const expandedPath = [
        '/opt/anaconda3/bin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        process.env.PATH || ''
    ].join(':');

    flaskProcess = spawn('python3', [scriptPath], {
        cwd,
        env: { ...process.env, PATH: expandedPath, WINNERSTRACKBUILDER_DB: dbPath }
    });

    flaskProcess.stdout.on('data', d => console.log('Flask:', d.toString().trim()));
    flaskProcess.stderr.on('data', d => console.error('Flask:', d.toString().trim()));
}

function waitForFlask(callback, attempts = 0) {
    if (attempts > 40) {
        console.error('Flask did not start in time');
        return;
    }
    http.get(`http://localhost:${PORT}`, () => {
        callback();
    }).on('error', () => {
        setTimeout(() => waitForFlask(callback, attempts + 1), 500);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        title: 'WinnersTrack',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('ready', () => {
    if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
        app.dock.setIcon(path.join(__dirname, 'build/icon.png'));
    }
    startFlask();
    waitForFlask(createWindow);
});

app.on('window-all-closed', () => {
    if (flaskProcess) flaskProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) waitForFlask(createWindow);
});

app.on('before-quit', () => {
    if (flaskProcess) flaskProcess.kill();
});
