import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigTableStore, configTableFileMatches, tokenizeConfigTableSearch, type SvnRunner } from './configTableStore.js'

const roots: string[] = []

async function fixture(): Promise<{ projectRoot: string; configRoot: string; branchRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'baytools-config-table-'))
  roots.push(projectRoot)
  const configRoot = join(projectRoot, 'working-copy', 'trunk')
  const branchRoot = join(configRoot, 'feature_a')
  await mkdir(branchRoot, { recursive: true })
  return { projectRoot, configRoot, branchRoot }
}

async function writeWorkbook(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Config')
  sheet.getCell('A1').value = 'id'
  sheet.getCell('B1').value = 'name'
  sheet.getCell('A2').value = 3
  sheet.getCell('B2').value = 'hero'
  sheet.getCell('C2').value = { formula: 'A2*2', result: 6 }
  const hidden = sheet.getRow(3)
  hidden.hidden = true
  hidden.getCell(1).value = 'hidden-value'
  workbook.addWorksheet('Second').getCell('A1').value = 'next'
  await workbook.xlsx.writeFile(path)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('config table filename search', () => {
  it('uses contiguous Unity Project-style tokens with AND semantics', () => {
    expect(tokenizeConfigTableSearch(' hero   skill ')).toEqual(['hero', 'skill'])
    expect(configTableFileMatches('lw_hero_skill.xlsx', 'hero skill', 'tokens')).toBe(true)
    expect(configTableFileMatches('hero-skill-effect.xlsx', 'skill hero', 'tokens')).toBe(true)
    expect(configTableFileMatches('hero_effect.xlsx', 'hero skill', 'tokens')).toBe(false)
    expect(configTableFileMatches('GetConfigState.xlsx', 'gcs', 'tokens')).toBe(false)
  })

  it('matches an exact stem or full xlsx/xlsm filename', () => {
    expect(configTableFileMatches('hero_skill.xlsx', 'hero_skill', 'exact')).toBe(true)
    expect(configTableFileMatches('hero_skill.xlsx', 'hero_skill.xlsx', 'exact')).toBe(true)
    expect(configTableFileMatches('hero_skill.xlsm', 'hero_skill', 'exact')).toBe(true)
    expect(configTableFileMatches('hero_skill.xlsm', 'hero_skill.xlsm', 'exact')).toBe(true)
    expect(configTableFileMatches('hero_skill.xlsm', 'hero_skill.xlsx', 'exact')).toBe(false)
    expect(configTableFileMatches('hero_skill_copy.xlsx', 'hero_skill', 'exact')).toBe(false)
  })
})

describe('ConfigTableStore', () => {
  it('scans local xlsx and xlsm files and reads workbook ranges without recalculating formulas or macros', async () => {
    const { projectRoot, configRoot, branchRoot } = await fixture()
    await mkdir(join(configRoot, '.hidden_branch'), { recursive: true })
    await mkdir(join(branchRoot, 'nested'), { recursive: true })
    await writeWorkbook(join(branchRoot, 'nested', 'hero_skill.xlsx'))
    await writeWorkbook(join(branchRoot, 'nested', 'macro_config.xlsm'))
    await writeFile(join(branchRoot, '~$hero_skill.xlsx'), 'temporary')
    await writeFile(join(branchRoot, '~$macro_config.xlsm'), 'temporary')
    await writeFile(join(branchRoot, 'legacy.xls'), 'ignored')
    await writeFile(join(branchRoot, 'notes.txt'), 'ignored')
    const store = new ConfigTableStore(projectRoot, { rootPath: configRoot })
    await store.init()

    let state = await store.getState()
    expect(state.rootPath).toBe(configRoot)
    expect(state.branches).toMatchObject([{ name: 'feature_a', local: true }])
    expect(state.branches.some((branch) => branch.name === '.hidden_branch')).toBe(false)

    state = await store.scanBranch('feature_a')
    expect(state.branches[0]).toMatchObject({ name: 'feature_a', fileCount: 2 })
    const page = await store.searchFiles('feature_a', false, 'hero skill', 'tokens', 1)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].relativePath).toBe('nested/hero_skill.xlsx')

    const macroPage = await store.searchFiles('feature_a', false, 'macro config', 'tokens', 1)
    expect(macroPage.items).toHaveLength(1)
    expect(macroPage.items[0].relativePath).toBe('nested/macro_config.xlsm')
    const macroWorkbook = await store.getWorkbook('feature_a', macroPage.items[0].relativePath)
    expect(macroWorkbook.sheets[0]).toEqual({ name: 'Config', rowCount: 3, columnCount: 3 })

    const workbook = await store.getWorkbook('feature_a', page.items[0].relativePath)
    expect(workbook.sheets).toEqual([
      { name: 'Config', rowCount: 3, columnCount: 3 },
      { name: 'Second', rowCount: 1, columnCount: 1 },
    ])
    const range = await store.getRange('feature_a', page.items[0].relativePath, 'Config', 1, 3, 1, 3)
    expect(range.values).toEqual([
      ['id', 'name', ''],
      ['3', 'hero', '6'],
      ['hidden-value', '', ''],
    ])
    const matches = await store.searchCells('feature_a', page.items[0].relativePath, 'Config', 'hidden', 'contains')
    expect(matches).toEqual([{ row: 3, column: 1, address: 'A3', text: 'hidden-value' }])
    expect(await store.searchCells('feature_a', page.items[0].relativePath, 'Config', 'hidden', 'exact')).toEqual([])
    expect(await store.searchCells('feature_a', page.items[0].relativePath, 'Config', 'hidden-value', 'exact')).toEqual(matches)
    await expect(store.searchCells('feature_a', page.items[0].relativePath, 'Config', 'hidden', 'invalid' as never)).rejects.toMatchObject({ code: 'INVALID_CONFIG_CELL_SEARCH_MODE' })
  })

  it('rejects traversal and files outside the registered branch', async () => {
    const { projectRoot, configRoot } = await fixture()
    const store = new ConfigTableStore(projectRoot, { rootPath: configRoot })
    await store.init()
    await expect(store.getFileLocation('feature_a', '../outside.xlsx')).rejects.toMatchObject({ code: 'INVALID_CONFIG_FILE_PATH' })
    await expect(store.getFileLocation('../other', 'file.xlsx')).rejects.toMatchObject({ code: 'INVALID_CONFIG_BRANCH' })
  })

  it('rescans legacy branch indexes after supported file types change', async () => {
    const { projectRoot, configRoot, branchRoot } = await fixture()
    await writeWorkbook(join(branchRoot, 'macro_config.xlsm'))
    const store = new ConfigTableStore(projectRoot, { rootPath: configRoot })
    await store.init()
    await writeFile(join(projectRoot, 'Doc', 'config-table', 'index.json'), JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      branches: { feature_a: { scannedAt: '2026-01-01T00:00:00.000Z', files: [] } },
    }))

    const page = await store.searchFiles('feature_a', false, 'macro config', 'tokens', 1)
    expect(page.items).toMatchObject([{ name: 'macro_config.xlsm', relativePath: 'macro_config.xlsm' }])
    expect((await store.getState()).branches[0]).toMatchObject({ name: 'feature_a', fileCount: 1 })
  })

  it('persists pinned branches and orders them before unpinned branches', async () => {
    const { projectRoot, configRoot } = await fixture()
    await mkdir(join(configRoot, 'alpha'), { recursive: true })
    await mkdir(join(configRoot, 'zeta'), { recursive: true })
    const store = new ConfigTableStore(projectRoot, { rootPath: configRoot })
    await store.init()

    let state = await store.setBranchPinned('zeta', true)
    expect(state.branches[0]).toMatchObject({ name: 'zeta', pinned: true })
    expect(state.branches.slice(1).map((branch) => branch.name)).toEqual(['alpha', 'feature_a'])

    const reopened = new ConfigTableStore(projectRoot, { rootPath: configRoot })
    await reopened.init()
    state = await reopened.getState()
    expect(state.branches[0]).toMatchObject({ name: 'zeta', pinned: true })

    state = await reopened.setBranchPinned('zeta', false)
    expect(state.branches.map((branch) => branch.name)).toEqual(['alpha', 'feature_a', 'zeta'])
    expect(state.branches.find((branch) => branch.name === 'zeta')?.pinned).toBe(false)
    await expect(reopened.setBranchPinned('missing', true)).rejects.toMatchObject({ code: 'CONFIG_BRANCH_NOT_FOUND' })
  })

  it('syncs remote names through svn argument arrays and updates one local branch', async () => {
    const { projectRoot, configRoot, branchRoot } = await fixture()
    await writeWorkbook(join(branchRoot, 'server.xlsx'))
    const runner = vi.fn<SvnRunner>(async (args) => {
      if (args[0] === 'info') return { stdout: 'svn://example/project/trunk\n', stderr: '' }
      if (args[0] === 'list') return { stdout: 'dev/\nfeature_a/\nremote_only/\n', stderr: '' }
      return { stdout: 'Updated.\n', stderr: '' }
    })
    const store = new ConfigTableStore(projectRoot, { rootPath: configRoot, runSvn: runner })
    await store.init()

    const remoteState = await store.syncRemoteBranches()
    expect(remoteState.branches.find((branch) => branch.name === 'remote_only')).toMatchObject({ local: false, remote: true })
    const updated = await store.updateBranch('feature_a')
    expect(updated.branches.find((branch) => branch.name === 'feature_a')).toMatchObject({ local: true, remote: true, fileCount: 1 })
    const resolvedBranchRoot = await realpath(branchRoot)
    expect(runner).toHaveBeenCalledWith(['update', resolvedBranchRoot, '--non-interactive'], resolvedBranchRoot)
  })
})
