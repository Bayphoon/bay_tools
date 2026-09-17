import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { cp, copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { CodeCard, CodeCardFolder, CodeCardImage, CodeCardLibrary, CodeCardWorkspace, CodeCardWorkspaceSummary, TrashItem } from '../shared/types.js'
import { CODE_CARD_IMAGE_MAX_UPLOAD_SIZE } from '../shared/types.js'
import { AppError, ConflictError } from './errors.js'
import { exists, readJson, writeJson } from './filesystem.js'

const now = () => new Date().toISOString()
const UUID_PATTERN = /^[0-9a-f-]{36}$/i
const MAX_CARDS = 100
const MAX_CODE_LENGTH = 2 * 1024 * 1024

interface TrashIndex {
  schemaVersion: 1
  updatedAt: string
  revision: number
  items: TrashItem[]
}

function validateId(id: string, label = '代码段卡片'): string {
  if (!UUID_PATTERN.test(id)) throw new AppError(400, 'INVALID_ID', `${label} ID 无效`)
  return id
}

function normalizeName(value: string | undefined, fallback: string, maxLength = 80): string {
  const name = value?.trim() || fallback
  if (name.length > maxLength) throw new AppError(400, 'NAME_TOO_LONG', `名称不能超过 ${maxLength} 个字符`)
  return name
}

function summary(workspace: CodeCardWorkspace): CodeCardWorkspaceSummary {
  const { id, title, folderId, createdAt, updatedAt } = workspace
  return { id, title, ...(folderId ? { folderId } : {}), createdAt, updatedAt }
}

function createCard(): CodeCard {
  const createdAt = now()
  return {
    id: randomUUID(),
    title: '未命名卡片',
    code: '',
    collapsed: false,
    height: 240,
    splitRatio: 55,
    createdAt,
    updatedAt: createdAt,
  }
}

export interface CodeCardImageUpload {
  mimeType: CodeCardImage['mimeType']
  size: number
  width: number
  height: number
  revision: number
}

export class CodeCardStore {
  private readonly root: string
  private readonly indexPath: string
  private readonly workspaceRoot: string
  private readonly imageRoot: string
  private readonly trashIndexPath: string
  private readonly trashItemsRoot: string

  constructor(projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
    this.root = join(projectRoot, 'Doc', 'code-cards')
    this.indexPath = join(this.root, 'index.json')
    this.workspaceRoot = join(this.root, 'workspaces')
    this.imageRoot = join(this.root, 'images')
    this.trashIndexPath = join(projectRoot, 'Doc', 'trash', 'index.json')
    this.trashItemsRoot = join(projectRoot, 'Doc', 'trash', 'items')
  }

  async init(): Promise<void> {
    await Promise.all([mkdir(this.workspaceRoot, { recursive: true }), mkdir(this.imageRoot, { recursive: true }), mkdir(this.trashItemsRoot, { recursive: true })])
    if (!(await exists(this.indexPath))) {
      await writeJson(this.indexPath, { schemaVersion: 1, revision: 1, updatedAt: now(), folders: [], workspaces: [] } satisfies CodeCardLibrary)
    }
    if (!(await exists(this.trashIndexPath))) {
      await writeJson(this.trashIndexPath, { schemaVersion: 1, revision: 1, updatedAt: now(), items: [] } satisfies TrashIndex)
    }
  }

  private workspacePath(id: string): string {
    return join(this.workspaceRoot, `${validateId(id, '代码段')}.json`)
  }

  private imageDirectory(workspaceId: string): string {
    return join(this.imageRoot, validateId(workspaceId, '代码段'))
  }

  private imagePath(workspaceId: string, fileName: string): string {
    if (!/^[0-9a-f-]{36}-[0-9a-f-]{36}\.(webp|png|jpg)$/i.test(fileName)) throw new AppError(400, 'INVALID_IMAGE_NAME', '卡片图片文件名无效')
    return join(this.imageDirectory(workspaceId), fileName)
  }

  private async library(): Promise<CodeCardLibrary> {
    return readJson<CodeCardLibrary>(this.indexPath)
  }

  private async assertFolder(folderId?: string): Promise<void> {
    if (!folderId) return
    validateId(folderId, '分组')
    if (!(await this.library()).folders.some((folder) => folder.id === folderId)) throw new AppError(404, 'FOLDER_NOT_FOUND', '代码段分组不存在')
  }

  async getLibrary(): Promise<CodeCardLibrary> {
    return this.library()
  }

  async createWorkspace(title?: string, folderId?: string): Promise<CodeCardWorkspace> {
    await this.assertFolder(folderId)
    const createdAt = now()
    const workspace: CodeCardWorkspace = {
      schemaVersion: 1,
      revision: 1,
      id: randomUUID(),
      title: normalizeName(title, '未命名代码段'),
      ...(folderId ? { folderId } : {}),
      createdAt,
      updatedAt: createdAt,
      cards: [createCard()],
    }
    await writeJson(this.workspacePath(workspace.id), workspace)
    const library = await this.library()
    library.workspaces.push(summary(workspace))
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.indexPath, library)
    return workspace
  }

  async getWorkspace(id: string): Promise<CodeCardWorkspace> {
    const path = this.workspacePath(id)
    if (!(await exists(path))) throw new AppError(404, 'NOT_FOUND', '代码段不存在')
    return readJson<CodeCardWorkspace>(path)
  }

  async updateWorkspace(input: CodeCardWorkspace): Promise<CodeCardWorkspace> {
    const current = await this.getWorkspace(input.id)
    if (current.revision !== input.revision) throw new ConflictError('代码段已在其他窗口中修改', current)
    if (!Array.isArray(input.cards) || input.cards.length > MAX_CARDS) throw new AppError(400, 'TOO_MANY_CARDS', `每个页签最多包含 ${MAX_CARDS} 张卡片`)
    const currentCards = new Map(current.cards.map((card) => [card.id, card]))
    const ids = new Set<string>()
    const updatedAt = now()
    const cards = input.cards.map((card): CodeCard => {
      validateId(card.id)
      if (ids.has(card.id)) throw new AppError(400, 'DUPLICATE_CARD', '卡片 ID 重复')
      ids.add(card.id)
      if (typeof card.code !== 'string' || card.code.length > MAX_CODE_LENGTH) throw new AppError(413, 'CODE_TOO_LARGE', '单张卡片代码不能超过 2 MiB')
      const previous = currentCards.get(card.id)
      return {
        id: card.id,
        title: normalizeName(card.title, '未命名卡片', 120),
        code: card.code,
        collapsed: Boolean(card.collapsed),
        height: Math.min(1000, Math.max(240, Math.round(Number(card.height) || 240))),
        splitRatio: Math.min(75, Math.max(25, Number(card.splitRatio) || 55)),
        ...(previous?.image ? { image: previous.image } : {}),
        createdAt: previous?.createdAt ?? updatedAt,
        updatedAt,
      }
    })
    const next: CodeCardWorkspace = { ...current, title: normalizeName(input.title, current.title), cards, revision: current.revision + 1, updatedAt }
    await writeJson(this.workspacePath(current.id), next)
    const removedImages = current.cards.filter((card) => card.image && !ids.has(card.id)).map((card) => card.image!)
    await Promise.all(removedImages.map((image) => rm(this.imagePath(current.id, image.fileName), { force: true }).catch(() => undefined)))
    await this.updateSummary(next)
    return next
  }

  private async updateSummary(workspace: CodeCardWorkspace): Promise<void> {
    const library = await this.library()
    const index = library.workspaces.findIndex((item) => item.id === workspace.id)
    if (index < 0) throw new AppError(404, 'NOT_FOUND', '代码段不存在')
    library.workspaces[index] = summary(workspace)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.indexPath, library)
  }

  async renameWorkspace(id: string, title: string): Promise<CodeCardWorkspaceSummary> {
    const current = await this.getWorkspace(id)
    const next = { ...current, title: normalizeName(title, current.title), revision: current.revision + 1, updatedAt: now() }
    await writeJson(this.workspacePath(id), next)
    await this.updateSummary(next)
    return summary(next)
  }

  async moveWorkspace(id: string, folderId?: string): Promise<CodeCardWorkspaceSummary> {
    await this.assertFolder(folderId)
    const current = await this.getWorkspace(id)
    const next: CodeCardWorkspace = { ...current, ...(folderId ? { folderId } : {}), revision: current.revision + 1, updatedAt: now() }
    if (!folderId) delete next.folderId
    await writeJson(this.workspacePath(id), next)
    await this.updateSummary(next)
    return summary(next)
  }

  async trashWorkspace(id: string): Promise<void> {
    const workspace = await this.getWorkspace(id)
    const library = await this.library()
    const workspaceSummary = library.workspaces.find((item) => item.id === id)
    if (!workspaceSummary) throw new AppError(404, 'NOT_FOUND', '代码段不存在')
    const trashId = randomUUID()
    const trashRoot = join(this.trashItemsRoot, trashId)
    const payloadRoot = join(trashRoot, 'payload')
    const payloadWorkspace = join(payloadRoot, 'workspace.json')
    const sourceWorkspace = this.workspacePath(id)
    const sourceImages = this.imageDirectory(id)
    await mkdir(payloadRoot, { recursive: true })
    try {
      await copyFile(sourceWorkspace, payloadWorkspace)
      if (await exists(sourceImages)) await cp(sourceImages, join(payloadRoot, 'images'), { recursive: true })
      const workspaceBuffer = await readFile(payloadWorkspace)
      let size = workspaceBuffer.byteLength
      for (const card of workspace.cards) {
        if (!card.image) continue
        const source = this.imagePath(id, card.image.fileName)
        const copied = join(payloadRoot, 'images', card.image.fileName)
        const [sourceInfo, copiedInfo] = await Promise.all([stat(source), stat(copied)])
        if (sourceInfo.size !== card.image.size || copiedInfo.size !== sourceInfo.size) throw new AppError(500, 'TRASH_VERIFY_FAILED', '代码段图片复制校验失败')
        size += copiedInfo.size
      }
      const item: TrashItem = {
        id: trashId,
        kind: 'code-card',
        displayName: workspace.title,
        originalLocation: sourceWorkspace,
        codeCardWorkspace: workspaceSummary,
        deletedAt: now(),
        size,
        sha256: createHash('sha256').update(workspaceBuffer).digest('hex'),
      }
      await writeJson(join(trashRoot, 'metadata.json'), item)
      await rm(sourceWorkspace, { force: true })
      await rm(sourceImages, { recursive: true, force: true })
      library.workspaces = library.workspaces.filter((entry) => entry.id !== id)
      library.revision += 1
      library.updatedAt = now()
      await writeJson(this.indexPath, library)
      const trash = await readJson<TrashIndex>(this.trashIndexPath)
      trash.items.push(item)
      trash.revision += 1
      trash.updatedAt = now()
      await writeJson(this.trashIndexPath, trash)
    } catch (error) {
      if (await exists(sourceWorkspace)) await rm(trashRoot, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async createFolder(name?: string): Promise<CodeCardFolder> {
    const createdAt = now()
    const folder: CodeCardFolder = { id: randomUUID(), name: normalizeName(name, '未命名分组'), createdAt, updatedAt: createdAt }
    const library = await this.library()
    library.folders.push(folder)
    library.revision += 1
    library.updatedAt = createdAt
    await writeJson(this.indexPath, library)
    return folder
  }

  async renameFolder(id: string, name: string): Promise<CodeCardFolder> {
    validateId(id, '分组')
    const library = await this.library()
    const index = library.folders.findIndex((folder) => folder.id === id)
    if (index < 0) throw new AppError(404, 'FOLDER_NOT_FOUND', '代码段分组不存在')
    const next = { ...library.folders[index]!, name: normalizeName(name, library.folders[index]!.name), updatedAt: now() }
    library.folders[index] = next
    library.revision += 1
    library.updatedAt = next.updatedAt
    await writeJson(this.indexPath, library)
    return next
  }

  async deleteFolder(id: string): Promise<void> {
    validateId(id, '分组')
    const library = await this.library()
    if (library.workspaces.some((workspace) => workspace.folderId === id)) throw new AppError(409, 'FOLDER_NOT_EMPTY', '请先移动分组内的代码段')
    const index = library.folders.findIndex((folder) => folder.id === id)
    if (index < 0) throw new AppError(404, 'FOLDER_NOT_FOUND', '代码段分组不存在')
    library.folders.splice(index, 1)
    library.revision += 1
    library.updatedAt = now()
    await writeJson(this.indexPath, library)
  }

  async uploadImage(workspaceId: string, cardId: string, stream: Readable, metadata: CodeCardImageUpload): Promise<CodeCardWorkspace> {
    if (!['image/webp', 'image/png', 'image/jpeg'].includes(metadata.mimeType)) throw new AppError(415, 'IMAGE_TYPE_UNSUPPORTED', '图片只支持 WebP、PNG 或 JPEG')
    if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > CODE_CARD_IMAGE_MAX_UPLOAD_SIZE) throw new AppError(413, 'IMAGE_TOO_LARGE', '缩略图不能超过 4 MiB')
    if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height) || metadata.width <= 0 || metadata.height <= 0 || metadata.width > 10000 || metadata.height > 10000) throw new AppError(400, 'INVALID_IMAGE_SIZE', '图片尺寸无效')
    const workspace = await this.getWorkspace(workspaceId)
    if (workspace.revision !== metadata.revision) throw new ConflictError('代码段已在其他窗口中修改', workspace)
    const card = workspace.cards.find((item) => item.id === validateId(cardId))
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', '卡片不存在')
    const extension = metadata.mimeType === 'image/webp' ? 'webp' : metadata.mimeType === 'image/png' ? 'png' : 'jpg'
    const fileName = `${card.id}-${randomUUID()}.${extension}`
    const directory = this.imageDirectory(workspace.id)
    const temporary = join(directory, `upload.tmp-${randomUUID()}`)
    const target = join(directory, fileName)
    await mkdir(directory, { recursive: true })
    let received = 0
    let workspaceCommitted = false
    try {
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.byteLength
          if (received > metadata.size || received > CODE_CARD_IMAGE_MAX_UPLOAD_SIZE) return callback(new AppError(413, 'IMAGE_TOO_LARGE', '图片大小超过声明值或限制'))
          callback(null, chunk)
        },
      })
      await pipeline(stream, counter, createWriteStream(temporary, { flags: 'wx' }))
      if (received !== metadata.size) throw new AppError(400, 'SIZE_MISMATCH', '图片上传不完整')
      await rename(temporary, target)
      const updatedAt = now()
      const previous = card.image
      card.image = { fileName, mimeType: metadata.mimeType, size: received, width: Math.round(metadata.width), height: Math.round(metadata.height), updatedAt }
      card.updatedAt = updatedAt
      workspace.revision += 1
      workspace.updatedAt = updatedAt
      await writeJson(this.workspacePath(workspace.id), workspace)
      workspaceCommitted = true
      await this.updateSummary(workspace)
      if (previous) await rm(this.imagePath(workspace.id, previous.fileName), { force: true }).catch(() => undefined)
      return workspace
    } catch (error) {
      await rm(temporary, { force: true })
      if (!workspaceCommitted) await rm(target, { force: true })
      throw error
    }
  }

  async deleteImage(workspaceId: string, cardId: string, revision: number): Promise<CodeCardWorkspace> {
    const workspace = await this.getWorkspace(workspaceId)
    if (workspace.revision !== revision) throw new ConflictError('代码段已在其他窗口中修改', workspace)
    const card = workspace.cards.find((item) => item.id === validateId(cardId))
    if (!card) throw new AppError(404, 'CARD_NOT_FOUND', '卡片不存在')
    if (!card.image) return workspace
    const image = card.image
    delete card.image
    card.updatedAt = now()
    workspace.updatedAt = card.updatedAt
    workspace.revision += 1
    await writeJson(this.workspacePath(workspace.id), workspace)
    await this.updateSummary(workspace)
    await rm(this.imagePath(workspace.id, image.fileName), { force: true }).catch(() => undefined)
    return workspace
  }

  async getImage(workspaceId: string, cardId: string): Promise<{ path: string; image: CodeCardImage }> {
    const workspace = await this.getWorkspace(workspaceId)
    const card = workspace.cards.find((item) => item.id === validateId(cardId))
    if (!card?.image) throw new AppError(404, 'IMAGE_NOT_FOUND', '卡片图片不存在')
    const path = this.imagePath(workspace.id, card.image.fileName)
    if (!(await exists(path))) throw new AppError(404, 'IMAGE_MISSING', '卡片图片文件不存在')
    return { path, image: card.image }
  }
}
