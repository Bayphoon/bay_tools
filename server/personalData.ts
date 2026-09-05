import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { PersonalDataStatus, PersonalDataSyncResult, PersonalDataSyncState } from '../shared/types.js'
import { AppError } from './errors.js'
import { exists, readJson, writeJson } from './filesystem.js'

const execFileAsync = promisify(execFile)
const USER_BRANCH = /^user\/([A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?)$/

export const PERSONAL_DATA_PATHS = [
  'settings.json',
  'color',
  'json',
  'language',
  'markdown/ui-state.json',
  'markdown/documents',
  'file-workbench',
] as const

interface DataDigest {
  digest: string
  fileCount: number
  totalBytes: number
}

interface PersonalDataManifest extends DataDigest {
  schemaVersion: 1
  user: string
  branch: string
  updatedAt: string
}

interface LocalSyncState {
  schemaVersion: 1
  user: string
  runtimeDigest: string
  snapshotDigest: string
  syncedAt: string
}

interface PersonalDataManagerOptions {
  branchResolver?: () => Promise<string | null>
  now?: () => string
}

interface BranchContext {
  branch: string | null
  user?: string
  eligible: boolean
  snapshotRoot?: string
}

interface SelectedFile {
  absolutePath: string
  relativePath: string
  size: number
}

function portablePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function isAtomicArtifact(name: string): boolean {
  return name.includes('.tmp-') || name.endsWith('.bak')
}

async function assertNotSymlink(path: string): Promise<void> {
  if (!(await exists(path))) return
  if ((await lstat(path)).isSymbolicLink()) {
    throw new AppError(422, 'PERSONAL_DATA_SYMLINK', `个人数据中不允许符号链接：${path}`)
  }
}

async function collectPath(root: string, relativePath: string, files: SelectedFile[]): Promise<void> {
  const absolutePath = join(root, relativePath)
  if (!(await exists(absolutePath))) return
  const information = await lstat(absolutePath)
  if (information.isSymbolicLink()) {
    throw new AppError(422, 'PERSONAL_DATA_SYMLINK', `个人数据中不允许符号链接：${relativePath}`)
  }
  if (information.isDirectory()) {
    const entries = await readdir(absolutePath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (isAtomicArtifact(entry.name)) continue
      await collectPath(root, join(relativePath, entry.name), files)
    }
    return
  }
  if (information.isFile() && !isAtomicArtifact(basename(relativePath))) {
    files.push({ absolutePath, relativePath: portablePath(relativePath), size: information.size })
  }
}

async function selectedFiles(root: string): Promise<SelectedFile[]> {
  await assertNotSymlink(root)
  const files: SelectedFile[] = []
  for (const relativePath of PERSONAL_DATA_PATHS) await collectPath(root, relativePath, files)
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function digestFiles(files: SelectedFile[]): Promise<DataDigest> {
  const hash = createHash('sha256')
  let totalBytes = 0
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    for await (const chunk of createReadStream(file.absolutePath)) hash.update(chunk as Buffer)
    hash.update('\0')
    totalBytes += file.size
  }
  return { digest: hash.digest('hex'), fileCount: files.length, totalBytes }
}

async function inspectData(root: string): Promise<DataDigest> {
  return digestFiles(await selectedFiles(root))
}

async function copySelected(sourceRoot: string, targetRoot: string): Promise<DataDigest> {
  const files = await selectedFiles(sourceRoot)
  for (const file of files) {
    const target = join(targetRoot, file.relativePath)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(file.absolutePath, target)
  }
  return inspectData(targetRoot)
}

async function replaceDirectory(stage: string, target: string): Promise<void> {
  const backup = `${target}.bak-${randomUUID()}`
  const hadTarget = await exists(target)
  try {
    if (hadTarget) await rename(target, backup)
    await rename(stage, target)
    if (hadTarget) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (await exists(target)) await rm(target, { recursive: true, force: true })
    if (hadTarget && await exists(backup)) await rename(backup, target)
    throw error
  } finally {
    if (await exists(stage)) await rm(stage, { recursive: true, force: true })
  }
}

async function defaultBranchResolver(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-c', `safe.directory=${portablePath(root)}`,
      'branch', '--show-current',
    ], { cwd: root, windowsHide: true })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export class PersonalDataManager {
  readonly root: string
  readonly docRoot: string
  readonly userDataRoot: string
  private readonly statePath: string
  private readonly branchResolver: () => Promise<string | null>
  private readonly now: () => string

  constructor(root: string, options: PersonalDataManagerOptions = {}) {
    this.root = resolve(root)
    this.docRoot = join(this.root, 'Doc')
    this.userDataRoot = join(this.root, 'UserData')
    this.statePath = join(this.docRoot, '.personal-data-sync.json')
    this.branchResolver = options.branchResolver ?? (() => defaultBranchResolver(this.root))
    this.now = options.now ?? (() => new Date().toISOString())
  }

  private async context(): Promise<BranchContext> {
    const branch = await this.branchResolver()
    const match = branch ? USER_BRANCH.exec(branch) : null
    if (!match) return { branch, eligible: false }
    const user = match[1]!
    return { branch, user, eligible: true, snapshotRoot: join(this.userDataRoot, user) }
  }

  private async localState(user: string): Promise<LocalSyncState | undefined> {
    if (!(await exists(this.statePath))) return undefined
    try {
      const value = await readJson<LocalSyncState>(this.statePath)
      return value.schemaVersion === 1 && value.user === user ? value : undefined
    } catch {
      return undefined
    }
  }

  private async manifest(snapshotRoot: string, user: string): Promise<PersonalDataManifest | undefined> {
    const path = join(snapshotRoot, 'manifest.json')
    if (!(await exists(path))) return undefined
    try {
      const value = await readJson<PersonalDataManifest>(path)
      return value.schemaVersion === 1 && value.user === user ? value : undefined
    } catch {
      return undefined
    }
  }

  async getStatus(): Promise<PersonalDataStatus> {
    const context = await this.context()
    const runtime = await inspectData(this.docRoot)
    if (!context.eligible || !context.user || !context.snapshotRoot) {
      return {
        branch: context.branch,
        eligible: false,
        state: 'unavailable',
        runtimeHasData: runtime.fileCount > 0,
        snapshotExists: false,
        fileCount: runtime.fileCount,
        totalBytes: runtime.totalBytes,
      }
    }

    const snapshot = await inspectData(context.snapshotRoot)
    const snapshotExists = snapshot.fileCount > 0
    const [localState, manifest] = await Promise.all([
      this.localState(context.user),
      this.manifest(context.snapshotRoot, context.user),
    ])
    let state: PersonalDataSyncState
    if (!snapshotExists) state = runtime.fileCount > 0 ? 'runtime-newer' : 'ready'
    else if (runtime.digest === snapshot.digest) state = 'ready'
    else if (!localState) state = runtime.fileCount === 0 ? 'snapshot-newer' : 'diverged'
    else {
      const runtimeChanged = runtime.digest !== localState.runtimeDigest
      const snapshotChanged = snapshot.digest !== localState.snapshotDigest
      state = runtimeChanged && snapshotChanged
        ? 'diverged'
        : runtimeChanged
          ? 'runtime-newer'
          : 'snapshot-newer'
    }

    return {
      branch: context.branch,
      user: context.user,
      eligible: true,
      state,
      runtimeHasData: runtime.fileCount > 0,
      snapshotExists,
      snapshotPath: context.snapshotRoot,
      fileCount: snapshotExists ? snapshot.fileCount : runtime.fileCount,
      totalBytes: snapshotExists ? snapshot.totalBytes : runtime.totalBytes,
      lastSyncedAt: localState?.syncedAt ?? manifest?.updatedAt,
    }
  }

  async sync(force = false): Promise<PersonalDataSyncResult> {
    const context = await this.context()
    if (!context.eligible || !context.user || !context.branch || !context.snapshotRoot) {
      throw new AppError(409, 'USER_BRANCH_REQUIRED', '只有 user/<用户名> 分支可以同步个人数据')
    }
    const before = await this.getStatus()
    if (!force && (before.state === 'snapshot-newer' || before.state === 'diverged')) {
      throw new AppError(409, 'PERSONAL_DATA_DIVERGED', '分支快照包含尚未恢复的修改，请先恢复或确认用本机数据覆盖', before)
    }

    const runtime = await inspectData(this.docRoot)
    if (runtime.fileCount === 0) throw new AppError(409, 'PERSONAL_DATA_EMPTY', '本机没有可同步的个人数据')
    const snapshot = await inspectData(context.snapshotRoot)
    const syncedAt = this.now()
    let snapshotDigest = snapshot.digest
    let changed = snapshot.fileCount === 0 || runtime.digest !== snapshot.digest
    if (changed) {
      await mkdir(this.userDataRoot, { recursive: true })
      const stage = join(this.userDataRoot, `.${context.user}.tmp-${randomUUID()}`)
      await mkdir(stage, { recursive: true })
      try {
        const copied = await copySelected(this.docRoot, stage)
        const manifest: PersonalDataManifest = {
          schemaVersion: 1,
          user: context.user,
          branch: context.branch,
          updatedAt: syncedAt,
          ...copied,
        }
        await writeJson(join(stage, 'manifest.json'), manifest)
        await replaceDirectory(stage, context.snapshotRoot)
        snapshotDigest = copied.digest
      } catch (error) {
        await rm(stage, { recursive: true, force: true })
        throw error
      }
    } else {
      changed = false
    }

    const currentRuntime = await inspectData(this.docRoot)
    await writeJson(this.statePath, {
      schemaVersion: 1,
      user: context.user,
      runtimeDigest: currentRuntime.digest,
      snapshotDigest,
      syncedAt,
    } satisfies LocalSyncState)
    return { changed, status: await this.getStatus() }
  }

  async restore(confirm = false): Promise<PersonalDataSyncResult> {
    if (!confirm) throw new AppError(400, 'RESTORE_CONFIRMATION_REQUIRED', '恢复个人数据需要明确确认')
    const context = await this.context()
    if (!context.eligible || !context.user || !context.snapshotRoot) {
      throw new AppError(409, 'USER_BRANCH_REQUIRED', '只有 user/<用户名> 分支可以恢复个人数据')
    }
    const snapshot = await inspectData(context.snapshotRoot)
    if (snapshot.fileCount === 0) throw new AppError(404, 'PERSONAL_DATA_SNAPSHOT_MISSING', '当前用户分支没有个人数据快照')

    await mkdir(this.docRoot, { recursive: true })
    const stage = join(this.docRoot, `.personal-data-stage-${randomUUID()}`)
    const backup = join(this.docRoot, `.personal-data-backup-${randomUUID()}`)
    const movedOld: string[] = []
    const placedNew: string[] = []
    try {
      await mkdir(stage, { recursive: true })
      await copySelected(context.snapshotRoot, stage)
      for (const relativePath of PERSONAL_DATA_PATHS) {
        const target = join(this.docRoot, relativePath)
        const staged = join(stage, relativePath)
        const saved = join(backup, relativePath)
        if (await exists(target)) {
          await mkdir(dirname(saved), { recursive: true })
          await rename(target, saved)
          movedOld.push(relativePath)
        }
        if (await exists(staged)) {
          await mkdir(dirname(target), { recursive: true })
          await rename(staged, target)
          placedNew.push(relativePath)
        }
      }
      await rm(stage, { recursive: true, force: true })
      await rm(backup, { recursive: true, force: true })
    } catch (error) {
      for (const relativePath of [...placedNew].reverse()) {
        await rm(join(this.docRoot, relativePath), { recursive: true, force: true })
      }
      for (const relativePath of [...movedOld].reverse()) {
        const saved = join(backup, relativePath)
        const target = join(this.docRoot, relativePath)
        if (await exists(saved)) {
          await mkdir(dirname(target), { recursive: true })
          await rename(saved, target)
        }
      }
      throw error
    } finally {
      await rm(stage, { recursive: true, force: true })
      await rm(backup, { recursive: true, force: true })
    }

    const runtime = await inspectData(this.docRoot)
    const syncedAt = this.now()
    await writeJson(this.statePath, {
      schemaVersion: 1,
      user: context.user,
      runtimeDigest: runtime.digest,
      snapshotDigest: snapshot.digest,
      syncedAt,
    } satisfies LocalSyncState)
    return { changed: true, status: await this.getStatus() }
  }

  async autoRestoreIfEmpty(): Promise<boolean> {
    const context = await this.context()
    if (!context.eligible || !context.snapshotRoot) return false
    const [runtime, snapshot] = await Promise.all([
      inspectData(this.docRoot),
      inspectData(context.snapshotRoot),
    ])
    if (runtime.fileCount > 0 || snapshot.fileCount === 0) return false
    await this.restore(true)
    return true
  }
}
