import { useEffect, useRef, useState } from 'react'
import type { TranslationEntry, TranslationInput } from '../../shared/translation'
import { translationApi } from '../lib/api'

export function useTranslation(initialOutput = '') {
  const [output, setOutput] = useState(initialOutput)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { active.current?.abort(); active.current = undefined }, [])

  const translate = async (input: TranslationInput): Promise<TranslationEntry | undefined> => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setOutput(''); setError(''); setNotice('')
    let entry: TranslationEntry | undefined
    try {
      await translationApi.translate(input, controller.signal, (event) => {
        if (active.current !== controller) return
        if (event.type === 'delta') setOutput((previous) => previous + event.text)
        if (event.type === 'complete') {
          entry = event.entry
          setOutput(event.entry.translation)
          setNotice(event.warning ?? '翻译完成，已保存到本机历史')
        }
      })
      return entry
    } catch (value) {
      if (active.current === controller) {
        if (controller.signal.aborted) setNotice('已取消，当前译文可能不完整')
        else setError(value instanceof Error ? value.message : '翻译失败，请重试')
      }
    } finally {
      if (active.current === controller) { active.current = undefined; setBusy(false) }
    }
  }
  const loadOutput = (value: string) => { setOutput(value); setError(''); setNotice('') }
  return { output, setOutput: loadOutput, busy, error, notice, translate, cancel: () => active.current?.abort() }
}
