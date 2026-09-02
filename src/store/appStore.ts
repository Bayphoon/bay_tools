import { create } from 'zustand'
import type { AppSettings, JsonWorkspaceSummary, LanguageSourceSummary, ManagedMarkdownLibrary, MarkdownSourceTree } from '../../shared/types'
import { localBridge } from '../lib/api'

interface AppState {
  ready: boolean
  loading: boolean
  error?: string
  settings?: AppSettings
  jsonWorkspaces: JsonWorkspaceSummary[]
  languageSources: LanguageSourceSummary[]
  markdownTrees: MarkdownSourceTree[]
  managedMarkdown?: ManagedMarkdownLibrary
  markdownDirty: boolean
  bootstrap(): Promise<void>
  refreshJson(): Promise<void>
  refreshLanguages(): Promise<void>
  refreshMarkdown(): Promise<void>
  refreshManagedMarkdown(): Promise<void>
  saveSettings(settings: AppSettings): Promise<void>
  setMarkdownDirty(value: boolean): void
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  loading: false,
  jsonWorkspaces: [],
  languageSources: [],
  markdownTrees: [],
  markdownDirty: false,
  bootstrap: async () => {
    set({ loading: true, error: undefined })
    try {
      const [settings, jsonWorkspaces, languageSources, markdownTrees, managedMarkdown] = await Promise.all([
        localBridge.getSettings(),
        localBridge.listJsonWorkspaces(),
        localBridge.listLanguageSources(),
        localBridge.scanMarkdownSources(),
        localBridge.getManagedMarkdownLibrary(),
      ])
      set({ ready: true, loading: false, settings, jsonWorkspaces, languageSources, markdownTrees, managedMarkdown })
    } catch (error) {
      set({ ready: true, loading: false, error: error instanceof Error ? error.message : '初始化失败' })
    }
  },
  refreshJson: async () => set({ jsonWorkspaces: await localBridge.listJsonWorkspaces() }),
  refreshLanguages: async () => set({ languageSources: await localBridge.listLanguageSources() }),
  refreshMarkdown: async () => set({ markdownTrees: await localBridge.scanMarkdownSources() }),
  refreshManagedMarkdown: async () => set({ managedMarkdown: await localBridge.getManagedMarkdownLibrary() }),
  saveSettings: async (settings) => set({ settings: await localBridge.updateSettings(settings) }),
  setMarkdownDirty: (markdownDirty) => set({ markdownDirty }),
}))
