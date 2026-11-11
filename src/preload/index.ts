import { contextBridge, ipcRenderer } from 'electron'
import { API_KEYS } from '../shared/api'

// Named functions on fixed channels only; no generic send/invoke is exposed.
contextBridge.exposeInMainWorld(
  'refig',
  Object.fromEntries(API_KEYS.map((k) => [k, (...args: unknown[]) => ipcRenderer.invoke(`refig:${k}`, ...args)])),
)
