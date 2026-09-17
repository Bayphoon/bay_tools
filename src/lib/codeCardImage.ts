import { CODE_CARD_IMAGE_MAX_UPLOAD_SIZE } from '../../shared/types'

export interface PreparedCodeCardImage {
  blob: Blob
  width: number
  height: number
}

export function thumbnailDimensions(width: number, height: number, maxDimension = 1600): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效')
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('剪贴板图片无法读取')) }
    image.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片压缩失败')), type, quality))
}

export async function prepareCodeCardImage(source: Blob): Promise<PreparedCodeCardImage> {
  const image = await loadImage(source)
  let size = thumbnailDimensions(image.naturalWidth, image.naturalHeight)
  let result: Blob | undefined
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片画布')
    context.drawImage(image, 0, 0, size.width, size.height)
    result = await canvasBlob(canvas, 'image/webp', Math.max(.52, .84 - attempt * .08)).catch(() => canvasBlob(canvas, 'image/png'))
    if (result.size <= CODE_CARD_IMAGE_MAX_UPLOAD_SIZE) return { blob: result, ...size }
    size = thumbnailDimensions(size.width, size.height, Math.round(Math.max(size.width, size.height) * .78))
  }
  throw new Error('图片压缩后仍超过 4 MiB，请先裁剪后再添加')
}

async function imageBlobToPng(source: Blob): Promise<Blob> {
  if (source.type === 'image/png') return source
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建图片画布')
  context.drawImage(image, 0, 0)
  return canvasBlob(canvas, 'image/png')
}

export async function copyCodeCardImage(image: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') throw new Error('当前浏览器不支持复制图片')
  const png = await imageBlobToPng(image)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
