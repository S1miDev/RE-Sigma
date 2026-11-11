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
export type Omitted = Record<string, number>
export type ImportResult =
  | { file: string; status: 'imported'; summary: ProjectSummary; omitted?: Omitted }
  | { file: string; status: 'conflict'; token: string; name: string }
  | { file: string; status: 'cancelled' }
  | { file: string; status: 'error'; error: string }
export type ConflictChoice = 'replace' | 'keepBoth' | 'cancel'
export type ExportKind = 'png' | 'svg' | 'pdf' // for 'pdf' the bytes are an SVG document; main prints it

export interface RefigApi {
  listProjects(): Promise<ProjectSummary[]>
  createProject(name: string): Promise<ProjectSummary>
  openProject(id: string): Promise<OpenedProject>
  saveProject(id: string, document: Document, thumbnailPng?: Uint8Array): Promise<ProjectSummary>
  addImage(id: string, bytes: Uint8Array): Promise<string>
  renameProject(id: string, newName: string): Promise<ProjectSummary>
  deleteProject(id: string): Promise<void>
  duplicateProject(id: string): Promise<ProjectSummary>
  importProjects(): Promise<ImportResult[]>
  resolveImportConflict(token: string, choice: ConflictChoice): Promise<ImportResult>
  exportProject(id: string): Promise<{ path: string } | null>
  exportImage(bytes: Uint8Array, suggestedName: string, kind: ExportKind): Promise<{ path: string } | null>
}

export const API_KEYS = [
  'listProjects',
  'createProject',
  'openProject',
  'saveProject',
  'addImage',
  'renameProject',
  'deleteProject',
  'duplicateProject',
  'importProjects',
  'resolveImportConflict',
  'exportProject',
  'exportImage',
] as const satisfies readonly (keyof RefigApi)[]
