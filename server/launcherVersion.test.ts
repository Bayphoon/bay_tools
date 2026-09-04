import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('BayTools launcher API compatibility', () => {
  it('keeps the VBS compatibility check aligned with the local server API version', async () => {
    const root = process.cwd()
    const [serverSource, launcherSource] = await Promise.all([
      readFile(join(root, 'server', 'index.ts'), 'utf8'),
      readFile(join(root, 'BayTools.vbs'), 'utf8'),
    ])
    const serverVersion = /const\s+apiVersion\s*=\s*(\d+)/.exec(serverSource)?.[1]
    const launcherVersion = /"""apiVersion"":(\d+)/.exec(launcherSource)?.[1]
    expect(serverVersion, 'server/index.ts must declare apiVersion').toBeTruthy()
    expect(launcherVersion, 'BayTools.vbs must check apiVersion').toBeTruthy()
    expect(launcherVersion).toBe(serverVersion)
  })
})
