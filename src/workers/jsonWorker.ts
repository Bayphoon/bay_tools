import { diffJson } from '../lib/jsonDiff'

self.onmessage = (event: MessageEvent<{ id: string; type: 'diff'; left: string; right: string }>) => {
  try {
    const result = diffJson(JSON.parse(event.data.left), JSON.parse(event.data.right))
    self.postMessage({ id: event.data.id, ok: true, result })
  } catch (error) {
    self.postMessage({ id: event.data.id, ok: false, error: error instanceof Error ? error.message : 'JSON 解析失败' })
  }
}
