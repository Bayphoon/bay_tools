import { create } from 'zustand'
import type { AppSettings, CodeCardLibrary, JsonFolder, JsonScratchpad, JsonWorkspaceSummary, LanguageSourceSummary, ManagedMarkdownLibrary, MarkdownSourceTree } from '../../shared/types'
import { ApiError, localBridge } from '../lib/api'

type JsonScratchpadPatch = Partial<Pick<JsonScratchpad, 'text' | 'mode' | 'autoFormat'>>
type JsonScratchpadSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict'

interface AppState {
  ready: boolean
  loading: boolean
  error?: string
  settings?: AppSettings
  jsonScratchpad?: JsonScratchpad
  jsonScratchpadSaveStatus: JsonScratchpadSaveStatus
  jsonScratchpadSaveError?: string
  jsonFolders: JsonFolder[]
  jsonWorkspaces: JsonWorkspaceSummary[]
  languageSources: LanguageSourceSummary[]
  markdownTrees: MarkdownSourceTree[]
  managedMarkdown?: ManagedMarkdownLibrary
  codeCards?: CodeCardLibrary
  markdownDirty: boolean
  fileWorkbenchDirty: boolean
  bootstrap(): Promise<void>
  refreshJson(): Promise<void>
  refreshLanguages(): Promise<void>
  refreshMarkdown(): Promise<void>
  refreshManagedMarkdown(): Promise<void>
  refreshCodeCards(): Promise<void>
  saveSettings(settings: AppSettings): Promise<void>
  updateJsonScratchpad(patch: JsonScratchpadPatch): void
  setMarkdownDirty(value: boolean): void
  setFileWorkbenchDirty(value: boolean): void
}

export const useAppStore = create<AppState>((set, get) => {
  let scratchpadSaveTimer: number | undefined
  let scratchpadSaveInFlight = false
  let scratchpadNeedsSave = false

  const scheduleScratchpadSave = () => {
    if (scratchpadSaveTimer) window.clearTimeout(scratchpadSaveTimer)
    scratchpadSaveTimer = window.setTimeout(() => void persistScratchpad(), 500)
  }

  async function persistScratchpad(): Promise<void> {
    if (scratchpadSaveInFlight) {
      scratchpadNeedsSave = true
      return
    }
    const snapshot = get().jsonScratchpad
    if (!snapshot) return
    scratchpadSaveInFlight = true
    scratchpadNeedsSave = false
    set({ jsonScratchpadSaveStatus: 'saving', jsonScratchpadSaveError: undefined })
    try {
      const saved = await localBridge.updateJsonScratchpad(snapshot)
      const hasNewerChanges = scratchpadNeedsSave
      set((state) => ({
        jsonScratchpad: state.jsonScratchpad ? { ...state.jsonScratchpad, revision: saved.revision, updatedAt: saved.updatedAt } : saved,
        jsonScratchpadSaveStatus: hasNewerChanges ? 'pending' : 'saved',
        jsonScratchpadSaveError: undefined,
      }))
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
      scratchpadNeedsSave = false
      set({
        jsonScratchpadSaveStatus: conflict ? 'conflict' : 'error',
        jsonScratchpadSaveError: conflict ? '草稿已在其他窗口中修改' : error instanceof Error ? error.message : '自动保存失败',
      })
    } finally {
      scratchpadSaveInFlight = false
      if (scratchpadNeedsSave) scheduleScratchpadSave()
    }
  }

  return {
    ready: false,
    loading: false,
    jsonScratchpadSaveStatus: 'idle',
    jsonFolders: [],
    jsonWorkspaces: [],
    languageSources: [],
    markdownTrees: [],
    markdownDirty: false,
    fileWorkbenchDirty: false,
    bootstrap: async () => {
      set({ loading: true, error: undefined })
      try {
        const [settings, jsonScratchpad, jsonFolders, jsonWorkspaces, languageSources, markdownTrees, managedMarkdown, codeCards] = await Promise.all([
          localBridge.getSettings(),
          localBridge.getJsonScratchpad(),
          localBridge.listJsonFolders(),
          localBridge.listJsonWorkspaces(),
          localBridge.listLanguageSources(),
          localBridge.scanMarkdownSources(),
          localBridge.getManagedMarkdownLibrary(),
          localBridge.getCodeCardLibrary(),
        ])
        set({ ready: true, loading: false, settings, jsonScratchpad, jsonScratchpadSaveStatus: 'idle', jsonFolders, jsonWorkspaces, languageSources, markdownTrees, managedMarkdown, codeCards })
      } catch (error) {
        set({ ready: true, loading: false, error: error instanceof Error ? error.message : '初始化失败' })
      }
    },
    refreshJson: async () => {
      const [jsonFolders, jsonWorkspaces] = await Promise.all([localBridge.listJsonFolders(), localBridge.listJsonWorkspaces()])
      set({ jsonFolders, jsonWorkspaces })
    },
    refreshLanguages: async () => set({ languageSources: await localBridge.listLanguageSources() }),
    refreshMarkdown: async () => set({ markdownTrees: await localBridge.scanMarkdownSources() }),
    refreshManagedMarkdown: async () => set({ managedMarkdown: await localBridge.getManagedMarkdownLibrary() }),
    refreshCodeCards: async () => set({ codeCards: await localBridge.getCodeCardLibrary() }),
    saveSettings: async (settings) => set({ settings: await localBridge.updateSettings(settings) }),
    updateJsonScratchpad: (patch) => {
      const current = get().jsonScratchpad
      if (!current) return
      set({ jsonScratchpad: { ...current, ...patch }, jsonScratchpadSaveStatus: 'pending', jsonScratchpadSaveError: undefined })
      scratchpadNeedsSave = true
      scheduleScratchpadSave()
    },
    setMarkdownDirty: (markdownDirty) => set({ markdownDirty }),
    setFileWorkbenchDirty: (fileWorkbenchDirty) => set({ fileWorkbenchDirty }),
  }
})
