import { app, shell, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { autoUpdater } from 'electron-updater'

// --- NETWORK & GPU STABILITY FIXES ---
// Disabling HTTP/2 often resolves 'handshake failed' and 'ERR_CONNECTION_RESET' 
// when using Firebase within Electron on some Windows environments.
app.commandLine.appendSwitch('disable-http2')
app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('allow-insecure-localhost')
app.commandLine.appendSwitch('--no-sandbox')
app.disableHardwareAcceleration()

// Main entry point for the Electron application
export let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createWindow(): void {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false
        },
        icon: join(__dirname, '../../resources/icon.png')
    })

    // STRICT BLOCKER: Block ALL external requests (HTTP/HTTPS) to stop SSL handshake failures.
    // Only allow localhost (which includes HMR and local resources).
    mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = details.url.toLowerCase()
        // Allow DevTools, creating empty windows (about:blank), localhost, and Firebase
        if (
            url.startsWith('devtools:') ||
            url.startsWith('file:') ||
            url.startsWith('chrome-extension:') ||
            url.startsWith('chrome:') ||
            url.startsWith('data:') ||
            url.startsWith('blob:') ||
            url.includes('localhost') ||
            url.includes('127.0.0.1') ||
            // Whitelist Firebase domains
            url.includes('googleapis.com') ||
            url.includes('firebaseapp.com') ||
            url.includes('firebaseapp.com') ||
            url.includes('firebaseio.com') ||
            // Whitelist GitHub for updates
            url.includes('github.com') ||
            url.includes('githubusercontent.com')
        ) {
            callback({ cancel: false })
        } else {
            console.log('[Blocked External Request]', url) // Optional: verify what's being killed
            callback({ cancel: true })
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // Auto-updater event listeners
    autoUpdater.on('update-available', (info) => {
        mainWindow?.webContents.send('update-available', info);
    });

    autoUpdater.on('update-downloaded', (info) => {
        mainWindow?.webContents.send('update-downloaded', info);
    });

    autoUpdater.on('download-progress', (progressObj) => {
        mainWindow?.webContents.send('download-progress', progressObj);
    });

    autoUpdater.on('error', (err) => {
        mainWindow?.webContents.send('update-error', err.toString());
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault()
            mainWindow?.hide()
        }
        return false
    })
}

// FORCE IGNORE: Tell Chromium to ignore all certificate errors (Development Only Fix)
app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('allow-insecure-localhost') // helpful if local dev server is HTTPS

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    createWindow()
    createTray()

    // Auto-updater configuration
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    if (process.platform === 'darwin') {
        // Disabling signature verification for updates (allows unsigned apps to update)
        // Caution: This is a security risk if the update source is not trusted.
        (autoUpdater as any).forceDevUpdateConfig = true;
    }

    // Check for updates IPC
    ipcMain.handle('check-for-updates', () => {
        if (is.dev) {
            // Verify functionality in dev mode? 
            // autoUpdater.checkForUpdates() might not work as expected without build configuration
            console.log("Check for updates triggered in dev mode");
            // You might wont to fake it for testing UI
            // return { update: "fake", version: "1.0.1" };
        }
        return autoUpdater.checkForUpdates();
    });

    ipcMain.handle('start-download', () => {
        return autoUpdater.downloadUpdate();
    });

    ipcMain.handle('quit-and-install', () => {
        autoUpdater.quitAndInstall();
    });

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // app.quit() // Disabled to keep app running in tray
    }
})

function createTray(): void {
    const iconPath = join(__dirname, '../../resources/icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    tray = new Tray(icon.resize({ width: 16, height: 16 }))

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Inventory System',
            click: (): void => {
                mainWindow?.show()
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: (): void => {
                isQuitting = true
                app.quit()
            }
        }
    ])

    tray.setToolTip('Inventory Management System')
    tray.setContextMenu(contextMenu)

    tray.on('click', () => {
        mainWindow?.show()
    })
}
