export const BAYTOOLS_NOTICE_EVENT = 'baytools:notice'

export interface AppNotice {
  message: string
  kind: 'success' | 'error'
}

export function showAppNotice(notice: AppNotice): void {
  window.dispatchEvent(new CustomEvent<AppNotice>(BAYTOOLS_NOTICE_EVENT, { detail: notice }))
}

export async function copyFilePath(resolvePath: () => Promise<string>, label = '文件路径'): Promise<void> {
  try {
    const path = await resolvePath()
    await navigator.clipboard.writeText(path)
    showAppNotice({ message: `${label}已复制`, kind: 'success' })
  } catch (error) {
    showAppNotice({ message: error instanceof Error ? `复制失败：${error.message}` : `${label}复制失败`, kind: 'error' })
  }
}
