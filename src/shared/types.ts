export type Theme = 'light' | 'dark'
export interface Settings {
  theme: Theme
  sidebar: boolean
  sidebarWidth: number
  sidebarTab: 'files' | 'outline'
  zoom: number
  focusMode: boolean
  typewriter: boolean
  recentFiles: string[]
}
export interface DocumentData {
  id: string
  path: string | null
  name: string
  markdown: string
  revision: string | null
  bom: boolean
  eol: '\n' | '\r\n'
  readOnly: boolean
}
export interface FolderData { path: string; name: string }
export interface TreeEntry { path: string; name: string; directory: boolean }
export interface DraftData { id: string; path: string | null; name: string; markdown: string; updatedAt: number }
export interface PrintJob { ticket: string; documentId: string; markdown: string; title: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export type FileChange = { id: string; document?: DocumentData; missing?: boolean; error?: string }
export type AppCommand = { type: 'close' } | { type: 'open-path'; path: string }
export interface TreeChange { directories: string[] }
export interface DesktopAPI {
  settings(): Promise<Result<Settings>>
  setSettings(patch: Partial<Settings>): Promise<Result<Settings>>
  toggleFullscreen(): Promise<Result<boolean>>
  newDocument(directory?: string): Promise<Result<DocumentData>>
  renameDocument(id: string, name: string, expectedRevision: string | null): Promise<Result<DocumentData>>
  releaseDocument(id: string): Promise<Result<void>>
  openFile(path?: string): Promise<Result<DocumentData | null>>
  openFolder(path?: string): Promise<Result<FolderData | null>>
  listDirectory(path: string): Promise<Result<TreeEntry[]>>
  save(id: string, markdown: string, saveAs?: boolean, expectedRevision?: string | null): Promise<Result<DocumentData | null>>
  reload(id: string, onlyIfClean?: boolean): Promise<Result<DocumentData>>
  updateBuffer(id: string, markdown: string): void
  discardDraft(id: string): Promise<Result<void>>
  drafts(): Promise<Result<DraftData[]>>
  recoverDraft(id: string): Promise<Result<DocumentData>>
  confirmUnsaved(name: string): Promise<Result<'save' | 'discard' | 'cancel'>>
  importImage(id: string, bytes: Uint8Array, name: string): Promise<Result<string>>
  assetURL(id: string, reference: string): string
  droppedPath(file: File): string
  openLink(id: string, href: string): Promise<Result<void>>
  exportPDF(id: string, markdown: string): Promise<Result<string | null>>
  printJob(ticket: string): Promise<Result<PrintJob>>
  printReady(ticket: string, error?: string): void
  ready(): void
  close(): void
  onFileChange(fn: (change: FileChange) => void): () => void
  onTreeChange(fn: (change: TreeChange) => void): () => void
  onCommand(fn: (command: AppCommand) => void): () => void
}
declare global { interface Window { desktop: DesktopAPI } }
