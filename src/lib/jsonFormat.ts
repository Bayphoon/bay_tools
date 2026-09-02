export function tryFormatJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2)
  } catch {
    return undefined
  }
}
