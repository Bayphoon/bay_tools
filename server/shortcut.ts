import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ShortcutLocation, ShortcutResult } from '../shared/types.js'
import { AppError } from './errors.js'

const execFileAsync = promisify(execFile)

const createShortcutScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$shell = New-Object -ComObject WScript.Shell
$location = $env:BAYTOOLS_SHORTCUT_LOCATION
$projectRoot = $env:BAYTOOLS_PROJECT_ROOT
$launcher = $env:BAYTOOLS_LAUNCHER_PATH
$icon = $env:BAYTOOLS_SHORTCUT_ICON
if ($location -eq 'desktop') {
  $directory = $shell.SpecialFolders.Item('Desktop')
} elseif ($location -eq 'start-menu') {
  $directory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
} else {
  throw 'Invalid shortcut location'
}
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$shortcutPath = Join-Path $directory 'BayTools.lnk'
$replaced = Test-Path -LiteralPath $shortcutPath
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = $icon + ',0'
$shortcut.Description = 'BayTools Local Workbench'
$shortcut.Save()
[Console]::Write((@{ path = $shortcutPath; replaced = $replaced } | ConvertTo-Json -Compress))
`

export function parseShortcutOutput(stdout: string, location: ShortcutLocation): ShortcutResult {
  try {
    const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as { path?: unknown; replaced?: unknown }
    if (typeof value.path !== 'string' || typeof value.replaced !== 'boolean') throw new Error('invalid result')
    return { location, path: value.path, replaced: value.replaced }
  } catch {
    throw new AppError(500, 'SHORTCUT_FAILED', '快捷方式创建结果无法识别')
  }
}

export async function createWindowsShortcut(projectRoot: string, location: ShortcutLocation): Promise<ShortcutResult> {
  if (process.platform !== 'win32') throw new AppError(501, 'WINDOWS_ONLY', '快捷方式功能当前仅支持 Windows')
  if (location !== 'desktop' && location !== 'start-menu') throw new AppError(400, 'INVALID_SHORTCUT_LOCATION', '快捷方式位置无效')
  const launcher = join(projectRoot, 'BayTools.vbs')
  const icon = join(projectRoot, 'public', 'baytools-shortcut-v2.ico')
  try {
    await Promise.all([access(launcher), access(icon)])
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', createShortcutScript], {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        BAYTOOLS_SHORTCUT_LOCATION: location,
        BAYTOOLS_PROJECT_ROOT: projectRoot,
        BAYTOOLS_LAUNCHER_PATH: launcher,
        BAYTOOLS_SHORTCUT_ICON: icon,
      },
    })
    return parseShortcutOutput(result.stdout, location)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(500, 'SHORTCUT_FAILED', error instanceof Error ? `快捷方式创建失败：${error.message}` : '快捷方式创建失败')
  }
}
