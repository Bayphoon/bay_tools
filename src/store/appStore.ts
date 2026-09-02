import { create } from 'zustand'
import type { AppSettings, JsonWorkspaceSummary, MarkdownSourceTree } from '../../shared/types'
import { localBridge } from '../lib/api'

interface AppState {
  ready: boolean
  loading: boolean
  error?: string
  settings?: AppSettings
  jsonWorkspaces: JsonWorkspaceSummary[]
  markdownTrees: MarkdownSourceTree[]
  markdownDirty: boolean
  bootstrap(): Promise<void>
  refreshJson(): Promise<void>
  refreshMarkdown(): Promise<void>
  saveSettings(settings: AppSettings): Promise<void>
  setMarkdownDirty(value: boolean): void
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  loading: false,
  jsonWorkspaces: [],
  markdownTrees: [],
  markdownDirty: false,
  bootstrap: async () => {
    set({ loading: true, error: undefined })
    try {
      const [settings, jsonWorkspaces, markdownTrees] = await Promise.all([
        localBridge.getSettings(),
        localBridge.listJsonWorkspaces(),
        localBridge.scanMarkdownSources(),
      ])
      set({ ready: true, loading: false, settings, jsonWorkspaces, markdownTrees })
    } catch (error) {
      set({ ready: true, loading: false, error: error instanceof Error ? error.message : '初始化失败' })
    }
  },
  refreshJson: async () => set({ jsonWorkspaces: await localBridge.listJsonWorkspaces() }),
  refreshMarkdown: async () => set({ markdownTrees: await localBridge.scanMarkdownSources() }),
  saveSettings: async (settings) => set({ settings: await localBridge.updateSettings(settings) }),
  setMarkdownDirty: (markdownDirty) => set({ markdownDirty }),
}))
