import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('BayTools launcher API compatibility', () => {
  it('keeps the visible launcher compatibility check aligned with the local server API version', async () => {
    const root = process.cwd()
    const [serverSource, launcherSource, vbsSource, commandSource, workerSource, packageSource, lockSource] = await Promise.all([
      readFile(join(root, 'server', 'index.ts'), 'utf8'),
      readFile(join(root, 'BayTools.Launcher.ps1'), 'utf8'),
      readFile(join(root, 'BayTools.vbs'), 'utf8'),
      readFile(join(root, 'BayTools.cmd'), 'utf8'),
      readFile(join(root, 'scripts', 'baytools-worker.mjs'), 'utf8'),
      readFile(join(root, 'package.json'), 'utf8'),
      readFile(join(root, 'package-lock.json'), 'utf8'),
    ])
    const serverVersion = /const\s+apiVersion\s*=\s*(\d+)/.exec(serverSource)?.[1]
    const launcherVersion = /\$ExpectedApiVersion\s*=\s*(\d+)/.exec(launcherSource)?.[1]
    expect(serverVersion, 'server/index.ts must declare apiVersion').toBeTruthy()
    expect(launcherVersion, 'BayTools.Launcher.ps1 must check apiVersion').toBeTruthy()
    expect(launcherVersion).toBe(serverVersion)
    expect(vbsSource).toContain('BayTools.Launcher.ps1')
    expect(commandSource).toContain('BayTools.Launcher.ps1" -Console')
    expect(commandSource).not.toContain('npm.cmd install')
    expect(workerSource).toContain('npm.cmd ci --no-audit --no-fund')
    expect(workerSource).toContain("node_modules', '.modules.yaml'")
    expect(workerSource).toContain('备份现有 node_modules')
    expect(workerSource.indexOf('stageRoot = await stageBuild')).toBeLessThan(workerSource.indexOf('await stopExistingService'))
    expect(launcherSource).toContain("$statusRunId -eq $runId")
    expect(JSON.parse(packageSource).scripts['start:built']).toContain('--open')
    expect(JSON.parse(lockSource).lockfileVersion).toBe(3)
  })

  it('parses explicit worker run metadata and compares build metadata', async () => {
    const root = process.cwd()
    const worker = await import(pathToFileURL(join(root, 'scripts', 'baytools-worker.mjs')).href) as {
      parseArguments(args: string[]): Record<string, string | boolean>
      isBuildMetadataCurrent(metadata: unknown, expected: unknown): boolean
    }
    expect(worker.parseArguments([
      '--run-id', 'run-1',
      '--source-version', 'source-1',
      '--dependency-version', 'deps-1',
      '--api-version', '15',
      '--restart',
    ])).toEqual({
      restart: true,
      run_id: 'run-1',
      source_version: 'source-1',
      dependency_version: 'deps-1',
      api_version: '15',
    })
    const expected = { sourceVersion: 'source-1', dependencyVersion: 'deps-1', apiVersion: 15 }
    expect(worker.isBuildMetadataCurrent({ schemaVersion: 1, ...expected }, expected)).toBe(true)
    expect(worker.isBuildMetadataCurrent({ schemaVersion: 1, ...expected, dependencyVersion: 'old' }, expected)).toBe(false)
  })
})
