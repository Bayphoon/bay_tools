import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const queues = new Map<string, Promise<unknown>>()

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function serialized<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  queues.set(path, next)
  return next.finally(() => {
    if (queues.get(path) === next) queues.delete(path)
  })
}

export function atomicWrite(path: string, content: string): Promise<void> {
  return serialized(path, async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${randomUUID()}`
    const backup = `${path}.bak`
    await writeFile(temporary, content, 'utf8')
    const handle = await open(temporary, 'r+')
    await handle.sync()
    await handle.close()
    if (await exists(path)) await copyFile(path, backup)
    await rename(temporary, path)
    if (await exists(backup)) await rm(backup, { force: true })
  })
}

export function writeJson(path: string, value: unknown): Promise<void> {
  return atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function recoverAtomicArtifacts(root: string): Promise<void> {
  if (!(await exists(root))) return
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await recoverAtomicArtifacts(path)
    else if (entry.name.includes('.tmp-')) await rm(path, { force: true })
    else if (entry.name.endsWith('.bak')) {
      const target = path.slice(0, -4)
      if (await exists(target)) await rm(path, { force: true })
      else await rename(path, target)
    }
  }
}
