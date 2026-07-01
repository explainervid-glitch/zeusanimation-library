// import { app, shell, BrowserWindow } from 'electron'
// import { join } from 'path'
// import { electronApp, is } from '@electron-toolkit/utils'
// import icon from '../../resources/icon.png?asset'
// import { registerIpcHandlers } from './ipc/assets.js'

// // Fix GPU issue
// app.disableHardwareAcceleration()
// app.commandLine.appendSwitch('no-sandbox')
// app.commandLine.appendSwitch('disable-gpu-sandbox')

// function createWindow() {
//   const mainWindow = new BrowserWindow({
//     width: 1280,
//     height: 800,
//     minWidth: 900,
//     minHeight: 600,
//     show: false,
//     autoHideMenuBar: true,
//     ...(process.platform === 'linux' ? { icon } : {}),
//     webPreferences: {
//       preload: join(__dirname, '../preload/index.js'),
//       sandbox: false,
//       webSecurity: false  // Izinkan akses file lokal (video dari W:\)
//     }
//   })

//   mainWindow.on('ready-to-show', () => {
//     mainWindow.show()
//   })

//   mainWindow.webContents.setWindowOpenHandler((details) => {
//     shell.openExternal(details.url)
//     return { action: 'deny' }
//   })

//   if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
//     mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
//   } else {
//     mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
//   }
// }

// app.whenReady().then(async () => {
//   electronApp.setAppUserModelId('com.zeusanimation.library')

//   app.on('browser-window-created', (_, window) => {
//     // shortcuts handled by default
//   })

//   // Register IPC handlers (async karena sql.js pakai wasm)
//   await registerIpcHandlers()

//   createWindow()

//   app.on('activate', function () {
//     if (BrowserWindow.getAllWindows().length === 0) createWindow()
//   })
// })

// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit()
//   }
// })

import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/assets.js'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')

// ─── SPLASH WINDOW ────────────────────────────────────────────
function createSplash() {
  const splash = new BrowserWindow({
    width:           340,
    height:          340,
    frame:           false,       // no title bar
    transparent:     true,        // rounded look
    resizable:       false,
    center:          true,
    alwaysOnTop:     true,
    skipTaskbar:     true,        // tidak muncul di taskbar
    webPreferences:  { sandbox: false },
  })

  splash.loadFile(join(__dirname, '../../resources/splash.html'))
  return splash
}

// ─── MAIN WINDOW ──────────────────────────────────────────────
function createWindow(splash) {
  const mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        900,
    minHeight:       600,
    show:            false,       // tunggu sampai ready
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload:     join(__dirname, '../preload/index.js'),
      sandbox:     false,
      webSecurity: false,
    },
  })

  // Saat main window siap → tutup splash, tampilkan main
  mainWindow.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) {
      splash.destroy()
    }
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── APP READY ────────────────────────────────────────────────
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.zeusanimation.library')

  // 1. Tampilkan splash dulu
  const splash = createSplash()

  // 2. Register IPC (bisa lama karena sql.js WASM)
  await registerIpcHandlers()

  // 3. Buat main window — splash otomatis tutup saat ready-to-show
  createWindow(splash)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(null)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})