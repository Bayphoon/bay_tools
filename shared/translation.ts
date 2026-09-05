export const TRANSLATION_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const
export type TranslationModel = typeof TRANSLATION_MODELS[number]
export const TRANSLATION_LANGUAGES = ['简体中文', '繁體中文', '英语', '日语', '韩语', '法语', '德语', '西班牙语', '俄语', '葡萄牙语', '意大利语', '阿拉伯语'] as const
export const TRANSLATION_MAX_INPUT = 12_000
export const TRANSLATION_HISTORY_LIMIT = 100

export interface TranslationInput {
  text: string
  sourceLanguage: string
  targetLanguage: string
  model: TranslationModel
}

export interface TranslationEntry extends TranslationInput {
  id: string
  createdAt: string
  translation: string
}

export interface TranslationConfig {
  configured: boolean
  source: 'local' | 'environment' | 'none'
  canSaveKey: boolean
  hasLocalKey: boolean
}

export type TranslationEvent =
  | { type: 'delta'; text: string }
  | { type: 'complete'; entry: TranslationEntry; warning?: string }
  | { type: 'error'; error: string; code: string }
