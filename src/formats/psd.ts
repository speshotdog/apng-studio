import { initializeCanvas, readPsd, type Layer, type Psd } from 'ag-psd'
import {
  blank,
  compositeOver,
  FOLDER_TYPE,
  type Bitmap,
  type SourceDocument,
  type SourceLayer,
} from './types.js'

interface Placed {
  node: SourceLayer
  layer: Layer
}

// ag-psd 預設要有 DOM canvas 才能建 ImageData，但主程序沒有 DOM。
// `useImageData` 模式其實只需要一個裝像素的容器，給它一個純物件就夠了。
initializeCanvas(
  () => {
    throw new Error('讀取這個 PSD 需要 canvas（可能含有 JPEG 壓縮的圖層）')
  },
  (width, height) =>
    ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
)

/**
 * Photoshop（以及所有匯出成 .psd 的軟體）的圖層樹。
 * ag-psd 的 `useImageData` 會直接給我們每層裁切過的 RGBA，不需要 canvas。
 */
export function parsePsd(data: Buffer): SourceDocument {
  const psd: Psd = readPsd(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
    },
  )
  const canvas = { width: psd.width, height: psd.height, resolution: 72 }
  const flat = new Map<number, SourceLayer>()
  const placed = new Map<number, Placed>()
  let nextId = 1

  const build = (layer: Layer): SourceLayer => {
    const id = nextId++
    const isFolder = Array.isArray(layer.children)
    const node: SourceLayer = {
      id,
      name: layer.name ?? `圖層 ${id}`,
      type: isFolder ? FOLDER_TYPE : 0,
      isFolder,
      isAnimationFolder: false,
      visible: !layer.hidden,
      opacity: layer.opacity ?? 1,
      children: [],
    }
    flat.set(id, node)
    placed.set(id, { node, layer })
    // PSD 的 children 是由下往上排；我們的樹跟 CSP 一樣「先畫的排前面」。
    node.children = (layer.children ?? []).map(build)
    return node
  }

  const root: SourceLayer = {
    id: 0,
    name: psd.name ?? 'PSD',
    type: FOLDER_TYPE,
    isFolder: true,
    isAnimationFolder: false,
    visible: true,
    opacity: 1,
    children: (psd.children ?? []).map(build),
  }
  flat.set(0, root)

  const cache = new Map<number, Bitmap>()

  const renderNode = (layerId: number, overrides?: Map<number, boolean>): Bitmap => {
    const cached = overrides ? undefined : cache.get(layerId)
    if (cached) return cached
    const node = layerId === 0 ? root : flat.get(layerId)
    if (!node) throw new Error(`找不到圖層 ${layerId}`)
    if (overrides?.get(layerId) === false) return blank(canvas.width, canvas.height)
    const result = blank(canvas.width, canvas.height)
    if (node.isFolder) {
      // children[0] 是最底層，順著畫上去。
      for (const child of node.children)
        if (overrides?.get(child.id) ?? child.visible)
          compositeOver(result.data, renderNode(child.id, overrides).data, child.opacity)
    } else {
      const layer = placed.get(layerId)?.layer
      const image = layer?.imageData
      if (image) {
        const left = layer.left ?? 0
        const top = layer.top ?? 0
        for (let y = 0; y < image.height; y += 1) {
          const targetY = y + top
          if (targetY < 0 || targetY >= canvas.height) continue
          for (let x = 0; x < image.width; x += 1) {
            const targetX = x + left
            if (targetX < 0 || targetX >= canvas.width) continue
            const source = (y * image.width + x) * 4
            const target = (targetY * canvas.width + targetX) * 4
            result.data[target] = image.data[source]!
            result.data[target + 1] = image.data[source + 1]!
            result.data[target + 2] = image.data[source + 2]!
            result.data[target + 3] = image.data[source + 3]!
          }
        }
      }
    }
    if (!overrides) cache.set(layerId, result)
    return result
  }

  return { canvas, root, flat, timeline: null, cspTimelines: [], renderNode }
}
