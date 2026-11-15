// The complete IPC contract between renderer and main.
import type { Document } from './document'

export interface ProjectSummary {
  id: string // '' for a damaged file
  name: string
  modifiedAt: string // ISO
  thumbnail: string | null // data URL
  damaged?: string // reason, when the file can't be read
}
export interface OpenedProject {
  summary: ProjectSummary
  document: Document
  images: Record<string, Uint8Array>
}
/** A document with the image bytes it uses: a saved version, or another project read as a library. */
export interface ProjectContent {
  document: Document
  images: Record<string, Uint8Array>
}
export interface VersionInfo {
  id: string
  name?: string // absent for automatic versions
  at: string // ISO
  auto: boolean
}
export type Omitted = Record<string, number>
export type ImportResult =
  | { file: string; status: 'imported'; summary: ProjectSummary; omitted?: Omitted }
  | { file: string; status: 'conflict'; token: string; name: string }
  | { file: string; status: 'cancelled' }
  | { file: string; status: 'error'; error: string }
export type ConflictChoice = 'replace' | 'keepBoth' | 'cancel'
export type ExportKind = 'png' | 'jpg' | 'webp' | 'svg' | 'pdf' // for 'pdf' the bytes are an SVG document; main prints it
export type ExportFile = { name: string; kind: ExportKind; bytes: Uint8Array }

export interface PluginInfo {
  id: string // folder name
  name: string
  main: string // worker script, loaded from refig-plugin://<id>/<main>
  ui?: string // optional UI page
  commands: { id: string; label: string }[]
}

export interface RefigApi {
  listProjects(): Promise<ProjectSummary[]>
  createProject(name: string): Promise<ProjectSummary>
  openProject(id: string): Promise<OpenedProject>
  saveProject(id: string, document: Document, thumbnailPng?: Uint8Array): Promise<ProjectSummary>
  addImage(id: string, bytes: Uint8Array): Promise<string>
  /** Saved versions, newest first. Automatic ones are added by saveProject at most every 10 minutes. */
  listVersions(id: string): Promise<VersionInfo[]>
  /**
   * Saves `document` as the project and keeps a named copy of it. Resolves to the updated list. An `auto` copy is not counted against
   * the named-version cap (it rotates out like autosaves) and is skipped when the newest version already holds the same document.
   */
  saveVersion(id: string, name: string, document: Document, auto?: boolean): Promise<VersionInfo[]>
  getVersion(id: string, versionId: string): Promise<ProjectContent>
  deleteVersion(id: string, versionId: string): Promise<VersionInfo[]>
  /** Another project's saved document, read-only (libraries). */
  readLibrary(id: string): Promise<ProjectContent>
  renameProject(id: string, newName: string): Promise<ProjectSummary>
  deleteProject(id: string): Promise<void>
  duplicateProject(id: string): Promise<ProjectSummary>
  importProjects(): Promise<ImportResult[]>
  resolveImportConflict(token: string, choice: ConflictChoice): Promise<ImportResult>
  exportProject(id: string): Promise<{ path: string } | null>
  exportImage(bytes: Uint8Array, suggestedName: string, kind: ExportKind): Promise<{ path: string } | null>
  /** Asks for a folder and writes every file into it. Resolves to the written paths, or null if cancelled. */
  exportFiles(files: ExportFile[]): Promise<string[] | null>
  /** Opens an http(s) link in the system browser (prototype "Open link"). */
  openExternal(url: string): Promise<void>
  listPlugins(): Promise<PluginInfo[]>
  /** The worker script of an installed plugin (shim + its main file). */
  readPluginCode(id: string): Promise<string>
  /** Opens the plugins folder in the file manager. */
  openPluginsFolder(): Promise<void>
}

export const API_KEYS = [
  'listProjects',
  'createProject',
  'openProject',
  'saveProject',
  'addImage',
  'listVersions',
  'saveVersion',
  'getVersion',
  'deleteVersion',
  'readLibrary',
  'renameProject',
  'deleteProject',
  'duplicateProject',
  'importProjects',
  'resolveImportConflict',
  'exportProject',
  'exportImage',
  'exportFiles',
  'openExternal',
  'listPlugins',
  'readPluginCode',
  'openPluginsFolder',
] as const satisfies readonly (keyof RefigApi)[]
