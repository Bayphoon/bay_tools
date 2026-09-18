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

  it('matches an exact stem or full xlsx filename', () => {
    expect(configTableFileMatches('hero_skill.xlsx', 'hero_skill', 'exact')).toBe(true)
    expect(configTableFileMatches('hero_skill.xlsx', 'hero_skill.xlsx', 'exact')).toBe(true)
    expect(configTableFileMatches('hero_skill_copy.xlsx', 'hero_skill', 'exact')).toBe(false)
  })
})

describe('ConfigTableStore', () => {
  it('scans local branch xlsx files and reads workbook ranges without recalculating formulas', async () => {
    const { projectRoot, configRoot, branchRoot } = await fixture()
    await mkdir(join(configRoot, '.hidden_branch'), { recursive: true })
    await mkdir(join(branchRoot, 'nested'), { recursive: true })
    await writeWorkbook(join(branchRoot, 'nested', 'hero_skill.xlsx'))
    await writeFile(join(branchRoot, '~$hero_skill.xlsx'), 'temporary')
    await writeFile(join(branchRoot, 'notes.txt'), 'ignored')
    const store = new ConfigTableStore(projectRoot, { rootPath: configRoot })
    await store.init()

    let state = await store.getState()
    expect(state.rootPath).toBe(configRoot)
    expect(state.branches).toMatchObject([{ name: 'feature_a', local: true }])
    expect(state.branches.some((branch) => branch.name === '.hidden_branch')).toBe(false)

    state = await store.scanBranch('feature_a')
    expect(state.branches[0]).toMatchObject({ name: 'feature_a', fileCount: 1 })
    const page = await store.searchFiles('feature_a', false, 'hero skill', 'tokens', 1)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].relativePath).toBe('nested/hero_skill.xlsx')

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
    const matches = await store.searchCells('feature_a', page.items[0].relativePath, 'Config', 'hidden')
    expect(matches).toEqual([{ row: 3, column: 1, address: 'A3', text: 'hidden-value' }])
  })

  it('rejects traversal and files outside the registered branch', async () => {
    const { projectRoot, configRoot } = await fixture()
    const store = new ConfigTableStore(projectRoot, { rootPath: configRoot })
    await store.init()
    await expect(store.getFileLocation('feature_a', '../outside.xlsx')).rejects.toMatchObject({ code: 'INVALID_CONFIG_FILE_PATH' })
    await expect(store.getFileLocation('../other', 'file.xlsx')).rejects.toMatchObject({ code: 'INVALID_CONFIG_BRANCH' })
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
