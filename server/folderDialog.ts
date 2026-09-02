import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function parseFolderDialogOutput(stdout: string): string | null {
  const value = stdout.replace(/^\uFEFF/, '').trim()
  return value || null
}

export async function selectWindowsFolder(script: string): Promise<string | null> {
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], {
    encoding: 'utf8',
    windowsHide: false,
  })
  return parseFolderDialogOutput(result.stdout)
}
