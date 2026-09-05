import { execFile } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalDataManager } from './personalData.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function createRoot(branch = 'user/alice'): Promise<{ root: string; manager: PersonalDataManager }> {
  const root = await mkdtemp(join(tmpdir(), 'baytools-personal-data-'))
  roots.push(root)
  return {
    root,
    manager: new PersonalDataManager(root, {
      branchResolver: async () => branch,
      now: () => '2026-09-05T00:00:00.000Z',
    }),
  }
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PersonalDataManager', () => {
  it('disables snapshots outside user branches', async () => {
    const { root, manager } = await createRoot('main')
    await write(root, 'Doc/settings.json', '{"theme":"dark"}')
    await expect(manager.getStatus()).resolves.toMatchObject({ branch: 'main', eligible: false, state: 'unavailable', runtimeHasData: true })
    await expect(manager.sync()).rejects.toMatchObject({ code: 'USER_BRANCH_REQUIRED' })
  })

  it('copies only portable personal data and does not rewrite an unchanged snapshot', async () => {
    const { root, manager } = await createRoot()
    await write(root, 'Doc/settings.json', '{"theme":"dark"}')
    await write(root, 'Doc/json/workspaces/中文.json', '{"ok":true}')
    await write(root, 'Doc/markdown/ui-state.json', '{"mode":"split"}')
    await write(root, 'Doc/markdown/documents/files/note.md', '# note')
    await write(root, 'Doc/logs/baytools.log', 'private log')
    await write(root, 'Doc/trash/index.json', '{"items":[]}')
    await write(root, 'Doc/markdown/sources.json', '{"sources":[{"path":"C:/private"}]}')
    await write(root, 'Doc/server-status/state.json', '{"url":"private"}')

    const first = await manager.sync()
    expect(first.changed).toBe(true)
    expect(first.status).toMatchObject({ user: 'alice', state: 'ready', snapshotExists: true })
    expect(await readFile(join(root, 'UserData/alice/json/workspaces/中文.json'), 'utf8')).toBe('{"ok":true}')
    await expect(access(join(root, 'UserData/alice/logs/baytools.log'))).rejects.toThrow()
    await expect(access(join(root, 'UserData/alice/trash/index.json'))).rejects.toThrow()
    await expect(access(join(root, 'UserData/alice/markdown/sources.json'))).rejects.toThrow()
    await expect(access(join(root, 'UserData/alice/server-status/state.json'))).rejects.toThrow()
    await expect(manager.sync()).resolves.toMatchObject({ changed: false, status: { state: 'ready' } })
  })

  it('detects two-sided changes and requires explicit overwrite', async () => {
    const { root, manager } = await createRoot()
    await write(root, 'Doc/settings.json', 'base')
    await manager.sync()
    await write(root, 'Doc/settings.json', 'runtime')
    await write(root, 'UserData/alice/settings.json', 'snapshot')

    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'diverged' })
    await expect(manager.sync()).rejects.toMatchObject({ code: 'PERSONAL_DATA_DIVERGED' })
    await expect(manager.sync(true)).resolves.toMatchObject({ changed: true, status: { state: 'ready' } })
    expect(await readFile(join(root, 'UserData/alice/settings.json'), 'utf8')).toBe('runtime')
  })

  it('restores an exact snapshot while preserving excluded local data', async () => {
    const { root, manager } = await createRoot()
    await write(root, 'Doc/settings.json', 'snapshot settings')
    await write(root, 'Doc/json/index.json', 'snapshot index')
    await manager.sync()
    await write(root, 'Doc/settings.json', 'local settings')
    await write(root, 'Doc/json/stale.json', 'stale')
    await write(root, 'Doc/logs/baytools.log', 'keep me')
    await write(root, 'Doc/markdown/sources.json', 'keep sources')

    await expect(manager.restore()).rejects.toMatchObject({ code: 'RESTORE_CONFIRMATION_REQUIRED' })
    await expect(manager.restore(true)).resolves.toMatchObject({ status: { state: 'ready' } })
    expect(await readFile(join(root, 'Doc/settings.json'), 'utf8')).toBe('snapshot settings')
    expect(await readFile(join(root, 'Doc/json/index.json'), 'utf8')).toBe('snapshot index')
    await expect(access(join(root, 'Doc/json/stale.json'))).rejects.toThrow()
    expect(await readFile(join(root, 'Doc/logs/baytools.log'), 'utf8')).toBe('keep me')
    expect(await readFile(join(root, 'Doc/markdown/sources.json'), 'utf8')).toBe('keep sources')
  })

  it('automatically restores a snapshot only when portable runtime data is empty', async () => {
    const { root, manager } = await createRoot()
    await write(root, 'Doc/settings.json', 'snapshot')
    await manager.sync()
    await rm(join(root, 'Doc/settings.json'))
    await write(root, 'Doc/logs/baytools.log', 'ignored')

    await expect(manager.autoRestoreIfEmpty()).resolves.toBe(true)
    expect(await readFile(join(root, 'Doc/settings.json'), 'utf8')).toBe('snapshot')
    await expect(manager.autoRestoreIfEmpty()).resolves.toBe(false)
  })

  it('rejects symbolic links in portable data', async ({ skip }) => {
    const { root, manager } = await createRoot()
    await write(root, 'outside.txt', 'outside')
    await mkdir(join(root, 'Doc/json'), { recursive: true })
    try {
      await symlink(join(root, 'outside.txt'), join(root, 'Doc/json/link.txt'), 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') skip()
      throw error
    }
    await expect(manager.sync()).rejects.toMatchObject({ code: 'PERSONAL_DATA_SYMLINK' })
  })
})

describe('Git branch isolation', () => {
  it('keeps ignored Doc data unchanged while switching main and a user branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'baytools-branch-isolation-'))
    roots.push(root)
    const git = (...args: string[]) => execFileAsync('git', args, { cwd: root, windowsHide: true })
    await git('init', '-b', 'main')
    await git('config', 'user.name', 'BayTools Test')
    await git('config', 'user.email', 'baytools@example.test')
    await write(root, 'Doc/.gitignore', '*\n!.gitignore\n')
    await write(root, 'Doc/settings.json', 'local runtime data')
    await write(root, 'UserData/.gitignore', '.*.tmp-*\n.*.bak-*\n')
    await git('add', 'Doc/.gitignore', 'UserData/.gitignore')
    await git('commit', '-m', 'base')
    await git('switch', '-c', 'user/alice')
    await write(root, 'UserData/alice/settings.json', 'branch snapshot')
    await git('add', 'UserData/alice/settings.json')
    await git('commit', '-m', 'snapshot')
    await git('switch', 'main')
    expect(await readFile(join(root, 'Doc/settings.json'), 'utf8')).toBe('local runtime data')
    await git('switch', 'user/alice')
    expect(await readFile(join(root, 'Doc/settings.json'), 'utf8')).toBe('local runtime data')
  })
})
