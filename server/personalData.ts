import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, copyFile, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { PersonalDataPublishResult, PersonalDataStatus, PersonalDataSyncResult, PersonalDataSyncState } from '../shared/types.js'
import { AppError } from './errors.js'
import { exists, readJson, writeJson } from './filesystem.js'

const execFileAsync = promisify(execFile)
const USER_BRANCH = /^user\/([A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?)$/
export const PERSONAL_DATA_GIT_FILE_LIMIT = 90 * 1024 * 1024

export const PERSONAL_DATA_PATHS = [
  'settings.json',
  'color',
  'json',
  'language',
  'markdown/ui-state.json',
  'markdown/documents',
  'file-workbench',
  'code-cards',
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

interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

function portablePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function safeGitMessage(value: string): string {
  return value.trim().replace(/:\/\/[^/@\s]+@/g, '://***@')
}

function sanitizeRemoteUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
    }
    return url.toString()
  } catch {
    return safeGitMessage(value)
  }
}

async function runGit(root: string, args: string[], allowFailure = false): Promise<GitResult> {
  try {
    const result = await execFileAsync('git', ['-c', `safe.directory=${portablePath(root)}`, ...args], {
      cwd: root,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string }
    const result = {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
    }
    if (allowFailure) return result
    throw new AppError(502, 'GIT_COMMAND_FAILED', safeGitMessage(result.stderr) || 'Git 命令执行失败')
  }
}

function isAtomicArtifact(name: string): boolean {
  return name.includes('.tmp-') || name.endsWith('.bak')
}

function commitTimestamp(value: string): string {
  const date = new Date(value)
  const part = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`
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

interface DirectoryTree {
  directories: Set<string>
  files: Set<string>
}

type RenamePath = typeof rename

async function inspectDirectoryTree(root: string): Promise<DirectoryTree> {
  const tree: DirectoryTree = { directories: new Set(), files: new Set() }
  if (!(await exists(root))) return tree
  await assertNotSymlink(root)

  async function visit(relativePath: string): Promise<void> {
    const directory = join(root, relativePath)
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const child = join(relativePath, entry.name)
      const absolutePath = join(root, child)
      const information = await lstat(absolutePath)
      if (information.isSymbolicLink()) {
        throw new AppError(422, 'PERSONAL_DATA_SYMLINK', `个人数据中不允许符号链接：${child}`)
      }
      if (information.isDirectory()) {
        tree.directories.add(child)
        await visit(child)
      } else if (information.isFile()) {
        tree.files.add(child)
      }
    }
  }

  await visit('')
  return tree
}

function pathDepth(path: string): number {
  return path.split(/[\\/]/).length
}

async function atomicCopyFile(source: string, target: string): Promise<void> {
  const temporary = `${target}.tmp-${randomUUID()}`
  await mkdir(dirname(target), { recursive: true })
  try {
    await copyFile(source, temporary)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function mirrorDirectory(source: string, target: string): Promise<void> {
  const [sourceTree, targetTree] = await Promise.all([
    inspectDirectoryTree(source),
    inspectDirectoryTree(target),
  ])

  for (const relativePath of [...targetTree.files].filter((path) => !sourceTree.files.has(path))) {
    await rm(join(target, relativePath), { force: true })
  }
  for (const relativePath of [...targetTree.directories]
    .filter((path) => !sourceTree.directories.has(path))
    .sort((left, right) => pathDepth(right) - pathDepth(left))) {
    await rm(join(target, relativePath), { recursive: true, force: true })
  }

  await mkdir(target, { recursive: true })
  for (const relativePath of [...sourceTree.directories].sort((left, right) => pathDepth(left) - pathDepth(right))) {
    await mkdir(join(target, relativePath), { recursive: true })
  }
  for (const relativePath of sourceTree.files) {
    await atomicCopyFile(join(source, relativePath), join(target, relativePath))
  }
}

function isBlockedDirectoryRename(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

async function replaceDirectoryInPlace(stage: string, target: string, backup: string, hadTarget: boolean): Promise<void> {
  if (hadTarget) {
    await inspectDirectoryTree(target)
    await cp(target, backup, { recursive: true, force: false, errorOnExist: true })
  }
  try {
    await mirrorDirectory(stage, target)
  } catch (error) {
    try {
      if (hadTarget) await mirrorDirectory(backup, target)
      else await rm(target, { recursive: true, force: true })
    } catch (rollbackError) {
      throw new AppError(500, 'PERSONAL_DATA_ROLLBACK_FAILED', '个人数据快照更新失败，自动恢复也未完成；旧快照备份已保留', {
        backup,
        cause: error instanceof Error ? error.message : String(error),
        rollbackCause: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      })
    }
    if (hadTarget) await rm(backup, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  if (hadTarget) await rm(backup, { recursive: true, force: true }).catch(() => undefined)
}

export async function replaceDirectory(stage: string, target: string, renamePath: RenamePath = rename): Promise<void> {
  const backup = join(dirname(target), `.${basename(target)}.bak-${randomUUID()}`)
  const hadTarget = await exists(target)
  let targetMoved = false
  let stageMoved = false
  try {
    if (hadTarget) {
      try {
        await renamePath(target, backup)
        targetMoved = true
      } catch (error) {
        if (!isBlockedDirectoryRename(error)) throw error
        await replaceDirectoryInPlace(stage, target, backup, true)
        return
      }
    }
    await renamePath(stage, target)
    stageMoved = true
  } catch (error) {
    if (targetMoved && !stageMoved && await exists(backup) && !(await exists(target))) {
      await renamePath(backup, target)
      targetMoved = false
    }
    throw error
  } finally {
    if (await exists(stage)) await rm(stage, { recursive: true, force: true })
    if (stageMoved && targetMoved && await exists(backup)) {
      await rm(backup, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function defaultBranchResolver(root: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(root, ['branch', '--show-current'])
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
  private publishing = false

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

  private async remoteUrl(): Promise<string | undefined> {
    const result = await runGit(this.root, ['remote', 'get-url', 'origin'], true)
    return result.exitCode === 0 && result.stdout.trim() ? sanitizeRemoteUrl(result.stdout.trim()) : undefined
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

    const [snapshot, remoteUrl] = await Promise.all([
      inspectData(context.snapshotRoot),
      this.remoteUrl(),
    ])
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
      remoteName: remoteUrl ? 'origin' : undefined,
      remoteUrl,
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

  async publish(confirm = false, force = false): Promise<PersonalDataPublishResult> {
    if (!confirm) throw new AppError(400, 'PUBLISH_CONFIRMATION_REQUIRED', '提交并推送个人数据需要明确确认')
    if (this.publishing) throw new AppError(409, 'PERSONAL_DATA_PUBLISH_BUSY', '个人数据正在提交或推送，请稍后重试')
    this.publishing = true
    try {
      const context = await this.context()
      if (!context.eligible || !context.user || !context.branch || !context.snapshotRoot) {
        throw new AppError(409, 'USER_BRANCH_REQUIRED', '只有 user/<用户名> 分支可以提交并推送个人数据')
      }
      const remoteUrl = await this.remoteUrl()
      if (!remoteUrl) throw new AppError(409, 'GIT_REMOTE_REQUIRED', '未找到 Git 远端 origin')
      const snapshotRelative = `UserData/${context.user}`

      const staged = await runGit(this.root, ['diff', '--cached', '--name-only', '-z'])
      const stagedOutside = staged.stdout.split('\0').filter(Boolean).filter((path) => path !== snapshotRelative && !path.startsWith(`${snapshotRelative}/`))
      if (stagedOutside.length > 0) {
        throw new AppError(409, 'UNRELATED_STAGED_CHANGES', '存在个人数据目录之外的已暂存修改，请先提交或取消暂存', { paths: stagedOutside })
      }

      const remoteBranchRef = `refs/heads/${context.branch}`
      const remoteTrackingRef = `refs/remotes/origin/${context.branch}`
      const remoteCheck = await runGit(this.root, ['ls-remote', '--exit-code', '--heads', 'origin', remoteBranchRef], true)
      if (remoteCheck.exitCode !== 0 && remoteCheck.exitCode !== 2) {
        throw new AppError(502, 'GIT_REMOTE_UNAVAILABLE', safeGitMessage(remoteCheck.stderr) || '无法访问 Git 远端，请先在终端完成认证')
      }
      const remoteExists = remoteCheck.exitCode === 0 && Boolean(remoteCheck.stdout.trim())
      if (remoteExists) {
        const fetched = await runGit(this.root, ['fetch', '--no-tags', 'origin', `+${remoteBranchRef}:${remoteTrackingRef}`], true)
        if (fetched.exitCode !== 0) {
          throw new AppError(502, 'GIT_FETCH_FAILED', safeGitMessage(fetched.stderr) || '获取远端用户分支失败')
        }
        const ancestor = await runGit(this.root, ['merge-base', '--is-ancestor', remoteTrackingRef, 'HEAD'], true)
        if (ancestor.exitCode === 1) {
          throw new AppError(409, 'REMOTE_BRANCH_DIVERGED', '远端用户分支包含本机尚未合并的提交，请先拉取并恢复个人数据')
        }
        if (ancestor.exitCode !== 0) {
          throw new AppError(502, 'GIT_ANCESTRY_CHECK_FAILED', safeGitMessage(ancestor.stderr) || '无法比较本地与远端用户分支')
        }
      }

      const oversized = (await selectedFiles(this.docRoot))
        .filter((file) => file.size > PERSONAL_DATA_GIT_FILE_LIMIT)
        .map((file) => ({ path: file.relativePath, size: file.size }))
      if (oversized.length > 0) {
        throw new AppError(413, 'PERSONAL_DATA_FILE_TOO_LARGE', '个人数据包含超过 90 MiB 的文件，请移除该文件或配置 Git LFS', { files: oversized })
      }

      const syncResult = await this.sync(force)
      const added = await runGit(this.root, ['add', '-A', '--', snapshotRelative], true)
      if (added.exitCode !== 0) throw new AppError(502, 'GIT_ADD_FAILED', safeGitMessage(added.stderr) || '暂存个人数据失败')

      const difference = await runGit(this.root, ['diff', '--cached', '--quiet', '--', snapshotRelative], true)
      if (difference.exitCode !== 0 && difference.exitCode !== 1) {
        throw new AppError(502, 'GIT_DIFF_FAILED', safeGitMessage(difference.stderr) || '检查个人数据变更失败')
      }
      const commitCreated = difference.exitCode === 1
      if (commitCreated) {
        const message = `[${context.user}] 同步个人数据 ${commitTimestamp(this.now())}`
        const committed = await runGit(this.root, ['commit', '--only', '-m', message, '--', snapshotRelative], true)
        if (committed.exitCode !== 0) {
          throw new AppError(502, 'GIT_COMMIT_FAILED', safeGitMessage(committed.stderr || committed.stdout) || '提交个人数据失败')
        }
      }
      const commit = (await runGit(this.root, ['rev-parse', 'HEAD'])).stdout.trim()
      const pushed = await runGit(this.root, ['push', '--porcelain', '--set-upstream', 'origin', `HEAD:${remoteBranchRef}`], true)
      if (pushed.exitCode !== 0) {
        throw new AppError(502, 'GIT_PUSH_FAILED', safeGitMessage(pushed.stderr || pushed.stdout) || '推送个人数据失败', {
          commitCreated,
          commit,
          branch: context.branch,
          remoteName: 'origin',
        })
      }
      return {
        syncChanged: syncResult.changed,
        commitCreated,
        commit,
        pushed: true,
        branch: context.branch,
        remoteName: 'origin',
        remoteUrl,
        status: await this.getStatus(),
      }
    } finally {
      this.publishing = false
    }
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
