import { closeSync, existsSync, openSync } from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stateRoot = join(projectRoot, '.baytools')
const logRoot = join(projectRoot, 'Doc', 'logs')
const logPath = join(logRoot, 'baytools.log')
const runtimeLogPath = join(logRoot, 'baytools-runtime.log')
const errorLogPath = join(logRoot, 'baytools-error.log')
const statusPath = join(logRoot, 'baytools-startup.status')
const dependencyMarkerPath = join(projectRoot, 'node_modules', '.baytools-dependency-hash')
const buildMetaPath = join(projectRoot, 'dist-server', 'build-meta.json')
const address = 'http://127.0.0.1:4319'

export function parseArguments(argv) {
  const result = { restart: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--restart') result.restart = true
    else if (value?.startsWith('--')) result[value.slice(2).replaceAll('-', '_')] = argv[index += 1]
  }
  return result
}

export function isBuildMetadataCurrent(metadata, expected) {
  return Boolean(metadata
    && metadata.schemaVersion === 1
    && metadata.sourceVersion === expected.sourceVersion
    && metadata.dependencyVersion === expected.dependencyVersion
    && metadata.apiVersion === expected.apiVersion)
}

async function log(message) {
  await mkdir(logRoot, { recursive: true })
  await appendFile(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
}

async function writeStatus(runId, stage, detail = '') {
  await mkdir(logRoot, { recursive: true })
  const temporary = `${statusPath}.${process.pid}.tmp`
  const normalizedDetail = detail.replace(/[\r\n|]+/g, ' ').slice(0, 500)
  await writeFile(temporary, `${runId}|${stage}|${normalizedDetail}`, 'utf8')
  await rm(statusPath, { force: true })
  await rename(temporary, statusPath)
}

async function readText(path) {
  try { return (await readFile(path, 'utf8')).trim() } catch { return '' }
}

async function readBuildMetadata() {
  try { return JSON.parse(await readFile(buildMetaPath, 'utf8')) } catch { return undefined }
}

async function runCommand(command, args, label) {
  await log(`${label}: ${command} ${args.join(' ')}`)
  const output = openSync(logPath, 'a')
  try {
    const exitCode = await new Promise((resolveExit, reject) => {
      const child = spawn(command, args, {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ['ignore', output, output],
      })
      child.once('error', reject)
      child.once('exit', (code) => resolveExit(code ?? 1))
    })
    if (exitCode !== 0) throw new Error(`${label}失败，退出码 ${exitCode}`)
  } finally {
    closeSync(output)
  }
}

async function runNpmCi() {
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
    await runCommand(shell, ['/d', '/s', '/c', 'npm.cmd ci --no-audit --no-fund'], '安装依赖')
    return
  }
  await runCommand('npm', ['ci', '--no-audit', '--no-fund'], '安装依赖')
}

async function installDependencies(runId, dependencyVersion) {
  const vite = process.platform === 'win32'
    ? join(projectRoot, 'node_modules', '.bin', 'vite.cmd')
    : join(projectRoot, 'node_modules', '.bin', 'vite')
  const marker = await readText(dependencyMarkerPath)
  const pnpmLayout = join(projectRoot, 'node_modules', '.modules.yaml')
  const required = !existsSync(vite) || marker !== dependencyVersion || existsSync(pnpmLayout)
  if (!required) return false

  await writeStatus(runId, 'installing')
  const nodeModules = join(projectRoot, 'node_modules')
  const backup = join(stateRoot, `node_modules-backup-${runId}`)
  let movedExistingModules = false
  await mkdir(stateRoot, { recursive: true })
  if (existsSync(nodeModules)) {
    await log(existsSync(pnpmLayout)
      ? '检测到 pnpm node_modules，迁移为 npm 管理的依赖目录'
      : '备份现有 node_modules，依赖更新失败时将自动恢复')
    await rm(backup, { recursive: true, force: true })
    await rename(nodeModules, backup)
    movedExistingModules = true
  }

  try {
    await runNpmCi()
    await writeFile(dependencyMarkerPath, dependencyVersion, 'utf8')
    if (movedExistingModules) await rm(backup, { recursive: true, force: true })
    return true
  } catch (error) {
    if (movedExistingModules) {
      await rm(nodeModules, { recursive: true, force: true })
      await rename(backup, nodeModules)
    }
    throw error
  }
}

async function stageBuild(runId, metadata) {
  await writeStatus(runId, 'building')
  const stageRoot = join(stateRoot, `build-${runId}`)
  await rm(stageRoot, { recursive: true, force: true })
  await mkdir(stageRoot, { recursive: true })
  const stagedClient = join(stageRoot, 'dist')
  const stagedServer = join(stageRoot, 'dist-server')
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  const vite = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')

  await runCommand(process.execPath, [tsc, '-b'], '前端类型检查')
  await runCommand(process.execPath, [tsc, '-p', 'tsconfig.server.json', '--outDir', stagedServer], '本地服务构建')
  await runCommand(process.execPath, [vite, 'build', '--outDir', stagedClient, '--emptyOutDir'], '前端构建')
  await writeFile(join(stagedServer, 'build-meta.json'), `${JSON.stringify({ schemaVersion: 1, ...metadata, builtAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  return stageRoot
}

async function currentSession() {
  try {
    const response = await fetch(`${address}/api/session`, { signal: AbortSignal.timeout(1000) })
    return response.ok ? await response.json() : undefined
  } catch { return undefined }
}

async function listenerPid() {
  if (process.platform !== 'win32') return undefined
  const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true })
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*TCP\s+127\.0\.0\.1:4319\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line)
    if (match) return Number(match[1])
  }
  return undefined
}

async function stopExistingService(runId) {
  const pid = await listenerPid()
  if (!pid) return
  if (!(await currentSession())) throw new Error(`端口 4319 已被其他程序占用（PID ${pid}）`)
  await writeStatus(runId, 'stopping')
  if (process.platform === 'win32') {
    await runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F'], '停止旧服务')
  } else {
    process.kill(pid, 'SIGTERM')
  }
  for (let attempt = 0; attempt < 20 && await listenerPid(); attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (await listenerPid()) throw new Error('旧服务未能在限定时间内停止')
}

async function promoteBuild(stageRoot, runId) {
  const backupRoot = join(stateRoot, `previous-build-${runId}`)
  const targets = ['dist', 'dist-server']
  const backedUp = new Set()
  const promoted = new Set()
  await rm(backupRoot, { recursive: true, force: true })
  await mkdir(backupRoot, { recursive: true })
  try {
    for (const name of targets) {
      const current = join(projectRoot, name)
      if (existsSync(current)) {
        await rename(current, join(backupRoot, name))
        backedUp.add(name)
      }
      await rename(join(stageRoot, name), current)
      promoted.add(name)
    }
    await rm(stageRoot, { recursive: true, force: true })
    return backupRoot
  } catch (error) {
    for (const name of targets) {
      const current = join(projectRoot, name)
      const backup = join(backupRoot, name)
      if (promoted.has(name)) await rm(current, { recursive: true, force: true })
      if (backedUp.has(name) && existsSync(backup)) await rename(backup, current)
    }
    throw error
  }
}

async function restorePreviousBuild(backupRoot) {
  if (!backupRoot || !existsSync(backupRoot)) return false
  for (const name of ['dist', 'dist-server']) {
    await rm(join(projectRoot, name), { recursive: true, force: true })
    const backup = join(backupRoot, name)
    if (existsSync(backup)) await rename(backup, join(projectRoot, name))
  }
  await rm(backupRoot, { recursive: true, force: true })
  return existsSync(join(projectRoot, 'dist-server', 'server', 'index.js'))
}

function spawnService(sourceVersion) {
  const output = openSync(runtimeLogPath, 'a')
  const error = openSync(errorLogPath, 'a')
  const child = spawn(process.execPath, [join(projectRoot, 'dist-server', 'server', 'index.js')], {
    cwd: projectRoot,
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', BAYTOOLS_SOURCE_VERSION: sourceVersion },
    stdio: ['ignore', output, error],
  })
  const closeLogs = () => { closeSync(output); closeSync(error) }
  child.once('error', closeLogs)
  child.once('exit', closeLogs)
  return child
}

async function waitForCompatibleService(expected, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await currentSession()
    if (session?.apiVersion === expected.apiVersion && session?.sourceVersion === expected.sourceVersion) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  return false
}

async function waitForExit(child) {
  if (child.exitCode !== null) return child.exitCode
  return new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code ?? 1)))
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const runId = options.run_id
  const sourceVersion = options.source_version
  const dependencyVersion = options.dependency_version
  const apiVersion = Number(options.api_version)
  if (!runId || !sourceVersion || !dependencyVersion || !Number.isInteger(apiVersion)) throw new Error('启动参数不完整')
  const expected = { sourceVersion, dependencyVersion, apiVersion }
  let failureStage = 'service-failed'
  let backupRoot
  let stageRoot
  let service

  await writeStatus(runId, 'checking')
  await log(`启动任务 ${runId}，源码 ${sourceVersion}，依赖 ${dependencyVersion}`)
  try {
    failureStage = 'install-failed'
    await installDependencies(runId, dependencyVersion)

    const metadata = await readBuildMetadata()
    const buildRequired = !isBuildMetadataCurrent(metadata, expected)
      || !existsSync(join(projectRoot, 'dist', 'index.html'))
      || !existsSync(join(projectRoot, 'dist-server', 'server', 'index.js'))
    if (buildRequired) {
      failureStage = 'build-failed'
      stageRoot = await stageBuild(runId, expected)
    }

    failureStage = 'service-failed'
    await stopExistingService(runId)
    if (stageRoot) backupRoot = await promoteBuild(stageRoot, runId)
    await writeStatus(runId, 'starting')
    service = spawnService(sourceVersion)
    if (!await waitForCompatibleService(expected)) throw new Error('新服务未在限定时间内就绪')

    await writeStatus(runId, 'ready')
    await log(`服务已就绪，PID ${service.pid}`)
    if (backupRoot) await rm(backupRoot, { recursive: true, force: true })
    const exitCode = await waitForExit(service)
    await writeStatus(runId, exitCode === 0 ? 'stopped' : 'service-failed', `退出码 ${exitCode}`)
    process.exitCode = exitCode
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log(`ERROR ${message}`)
    if (service && service.exitCode === null) {
      service.kill()
      await Promise.race([
        waitForExit(service),
        new Promise((resolveWait) => setTimeout(resolveWait, 2000)),
      ])
    }
    if (stageRoot && existsSync(stageRoot)) await rm(stageRoot, { recursive: true, force: true })
    if (await restorePreviousBuild(backupRoot)) {
      const restored = spawnService('restored-previous-build')
      restored.unref()
      await writeStatus(runId, 'rollback', message)
    } else {
      await writeStatus(runId, failureStage, message)
    }
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
