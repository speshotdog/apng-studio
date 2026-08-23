import type { Database } from 'sql.js'
import { queryRows } from './db.js'

export interface ClipLayer {
  id: number
  name: string
  type: number
  isFolder: boolean
  isAnimationFolder: boolean
  visible: boolean
  opacity: number
  blendMode: number
  offsetX: number
  offsetY: number
  renderOffsetX: number
  renderOffsetY: number
  children: ClipLayer[]
  renderMipmapId: number
  uuid: string
}

interface LayerLink {
  layer: ClipLayer
  firstChild: number
  next: number
}

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value !== 'number') return 0
  return value
}

export function buildTree(db: Database): { root: ClipLayer; flat: Map<number, ClipLayer> } {
  const rows = queryRows(
    db,
    `SELECT MainId, LayerName, LayerType, LayerVisibility, LayerOpacity,
    LayerComposite, LayerFolder, LayerOffsetX, LayerOffsetY,
    LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY, LayerNextIndex,
    LayerFirstChildIndex, LayerRenderMipmap, AnimationFolder, LayerUuid FROM Layer`,
  )
  const links = new Map<number, LayerLink>()
  const flat = new Map<number, ClipLayer>()
  for (const row of rows) {
    const id = numberValue(row, 'MainId')
    const layer: ClipLayer = {
      id,
      name: typeof row.LayerName === 'string' ? row.LayerName : '',
      type: numberValue(row, 'LayerType'),
      isFolder: numberValue(row, 'LayerFolder') !== 0,
      isAnimationFolder: numberValue(row, 'AnimationFolder') !== 0,
      visible: numberValue(row, 'LayerVisibility') !== 0,
      opacity: numberValue(row, 'LayerOpacity') / 256,
      blendMode: numberValue(row, 'LayerComposite'),
      offsetX: numberValue(row, 'LayerOffsetX'),
      offsetY: numberValue(row, 'LayerOffsetY'),
      renderOffsetX: numberValue(row, 'LayerRenderOffscrOffsetX'),
      renderOffsetY: numberValue(row, 'LayerRenderOffscrOffsetY'),
      children: [],
      renderMipmapId: numberValue(row, 'LayerRenderMipmap'),
      uuid: typeof row.LayerUuid === 'string' ? row.LayerUuid : '',
    }
    flat.set(id, layer)
    links.set(id, {
      layer,
      firstChild: numberValue(row, 'LayerFirstChildIndex'),
      next: numberValue(row, 'LayerNextIndex'),
    })
  }
  const canvas = queryRows(db, 'SELECT CanvasRootFolder FROM Canvas')[0]
  const rootId = canvas ? numberValue(canvas, 'CanvasRootFolder') : 0
  const rootLink = links.get(rootId)
  if (!rootLink) throw new Error(`找不到畫布根圖層 ${rootId}`)
  const visited = new Set<number>()
  const attachChildren = (parent: LayerLink): void => {
    let childId = parent.firstChild
    while (childId !== 0) {
      if (visited.has(childId)) throw new Error(`圖層鏈結形成循環：${childId}`)
      visited.add(childId)
      const child = links.get(childId)
      if (!child) throw new Error(`找不到圖層鏈結指向的圖層 ${childId}`)
      parent.layer.children.push(child.layer)
      attachChildren(child)
      childId = child.next
    }
  }
  visited.add(rootId)
  attachChildren(rootLink)
  return { root: rootLink.layer, flat }
}
