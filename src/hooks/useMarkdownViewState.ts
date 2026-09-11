import { useCallback, useEffect, useRef, useState } from 'react'
import type { MarkdownUiState } from '../../shared/types'
import type { MarkdownMode } from '../components/MarkdownWorkspace'
import { ApiError, localBridge } from '../lib/api'

interface MarkdownViewPreferences {
  mode: MarkdownMode
  tocOpen: boolean
  syncScroll: boolean
}

const defaults: MarkdownViewPreferences = { mode: 'split', tocOpen: true, syncScroll: true }

function preferencesOf(state: MarkdownUiState): MarkdownViewPreferences {
  return { mode: state.mode, tocOpen: state.tocOpen, syncScroll: state.syncScroll }
}

function samePreferences(left: MarkdownViewPreferences, right: MarkdownViewPreferences): boolean {
  return left.mode === right.mode && left.tocOpen === right.tocOpen && left.syncScroll === right.syncScroll
}

export function useMarkdownViewState() {
  const [preferences, setPreferences] = useState(defaults)
  const desired = useRef(defaults)
  const persisted = useRef<MarkdownUiState | undefined>(undefined)
  const touched = useRef(false)
  const flushing = useRef(false)

  const flush = useCallback(async () => {
    if (flushing.current || !persisted.current) return
    flushing.current = true
    try {
      for (let attempt = 0; attempt < 4 && persisted.current; attempt += 1) {
        const target = desired.current
        if (samePreferences(preferencesOf(persisted.current), target)) break
        try {
          persisted.current = await localBridge.updateMarkdownUiState({ ...persisted.current, ...target })
        } catch (value) {
          if (!(value instanceof ApiError) || value.status !== 409) break
          persisted.current = await localBridge.getMarkdownUiState()
        }
      }
    } finally {
      flushing.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void localBridge.getMarkdownUiState().then((value) => {
      if (!active) return
      persisted.current = value
      if (!touched.current) {
        desired.current = preferencesOf(value)
        setPreferences(desired.current)
      }
      void flush()
    }).catch(() => undefined)
    return () => { active = false }
  }, [flush])

  const update = useCallback((patch: Partial<MarkdownViewPreferences>) => {
    touched.current = true
    desired.current = { ...desired.current, ...patch }
    setPreferences(desired.current)
    void flush()
  }, [flush])

  return {
    ...preferences,
    changeMode: (mode: MarkdownMode) => update({ mode }),
    toggleToc: () => update({ tocOpen: !desired.current.tocOpen }),
    toggleSyncScroll: () => update({ syncScroll: !desired.current.syncScroll }),
  }
}
