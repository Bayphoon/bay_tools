import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('BayTools launcher API compatibility', () => {
  it('keeps the visible launcher compatibility check aligned with the local server API version', async () => {
    const root = process.cwd()
    const [serverSource, launcherSource, vbsSource, commandSource] = await Promise.all([
      readFile(join(root, 'server', 'index.ts'), 'utf8'),
      readFile(join(root, 'BayTools.Launcher.ps1'), 'utf8'),
      readFile(join(root, 'BayTools.vbs'), 'utf8'),
      readFile(join(root, 'BayTools.cmd'), 'utf8'),
    ])
    const serverVersion = /const\s+apiVersion\s*=\s*(\d+)/.exec(serverSource)?.[1]
    const launcherVersion = /\$ExpectedApiVersion\s*=\s*(\d+)/.exec(launcherSource)?.[1]
    expect(serverVersion, 'server/index.ts must declare apiVersion').toBeTruthy()
    expect(launcherVersion, 'BayTools.Launcher.ps1 must check apiVersion').toBeTruthy()
    expect(launcherVersion).toBe(serverVersion)
    expect(vbsSource).toContain('BayTools.Launcher.ps1')
    expect(commandSource).toContain('call :status installing')
    expect(commandSource).toContain('call :status building')
  })
})
