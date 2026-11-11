import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { createProjectStore } from './projects'
import { workspaceDir } from './workspace'

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'Refig',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  const wc = win.webContents
  // The app loads no remote content: no new windows, no navigation away from the app page.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e, url) => {
    if (url !== wc.getURL()) e.preventDefault()
  })
  win.on('closed', () => (win = null))

  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    wc.on('before-input-event', (_, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools()
    })
    void win.loadURL(devUrl)
  } else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null) // the editor has its own menu; the default one would steal Ctrl+0, Ctrl+R, Ctrl+W…
    const store = createProjectStore(workspaceDir(), { trash: (file) => shell.trashItem(file), appVersion: app.getVersion() })
    registerIpc(store, () => win)
    createWindow()
  })
}
