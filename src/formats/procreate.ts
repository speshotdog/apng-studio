import JSZip from 'jszip'
import { decompressBlock } from 'lz4js'
import type { Bitmap, SourceDocument, SourceLayer } from './types.js'

/**
 * Procreate `.procreate` 讀取器。
 *
 * 由 Codex 逆向樣本檔後實作，逐位元組驗證過的重點：
 * - 檔案是 ZIP；`Document.archive` 是 NSKeyedArchiver binary plist
 * - 圖層像素放在以 UUID 命名的資料夾裡，檔名 `{col}~{row}.lz4`
 * - 這些 .lz4 **不是** 裸 LZ4 block，而是 Apple 的 chunk 包裝：
 *   `bv41`（壓縮）／`bv4-`（未壓縮）／`bv4$`（結束）
 * - 像素是 **預乘的 RGBA**（不是 BGRA），輸出前要 un-premultiply
 * - 頂層 `layers` 陣列是「上到下」，合成時要反過來畫
 *
 * 未支援：normal 以外的混合模式、遮罩、剪裁遮色片、文字／向量圖層。
 */

interface SourceCanvas {
  width: number
  height: number
  resolution: number
}

type PlistValue =
  null | boolean | number | string | Date | Uint8Array | Uid | PlistArray | PlistDict
type PlistArray = PlistValue[]
type PlistDict = { [key: string]: PlistValue }

class Uid {
  constructor(readonly value: number) {}
}

interface InternalLayer extends SourceLayer {
  uuid: string | null
  blend: number
  clipped: boolean
  contentsRect: Rect | null
  children: InternalLayer[]
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface ArchiveContext {
  objects: PlistArray
  deref(value: PlistValue | undefined): PlistValue | undefined
}

interface Background {
  hidden: boolean
  color: [number, number, number, number]
}

const ROOT_FOLDER_TYPE = 1584
const NORMAL_LAYER_TYPE = 0
const DEFAULT_DPI = 132
const DEFAULT_TILE_SIZE = 256

export async function parseProcreate(data: Buffer): Promise<SourceDocument> {
  const zip = await JSZip.loadAsync(data)
  const archiveFile = zip.file('Document.archive')
  if (!archiveFile) {
    throw new Error('Document.archive not found')
  }

  const archiveBytes = await archiveFile.async('uint8array')
  const archiveRoot = parseBinaryPlist(archiveBytes)
  const keyed = keyedArchive(archiveRoot)
  const documentDict = expectDict(
    keyed.deref(getDict(keyed.root, '$root') ?? getDict(keyed.root, 'root')),
  )
  const canvas = parseCanvas(documentDict, keyed)
  const tileSize = numberFrom(keyed.deref(documentDict.tileSize)) ?? DEFAULT_TILE_SIZE
  const background = parseBackground(documentDict, keyed)

  let nextId = 1
  const flatInternal = new Map<number, InternalLayer>()
  const sourceFlat = new Map<number, SourceLayer>()
  const layerByUuid = new Map<string, InternalLayer>()

  const root: InternalLayer = {
    id: 0,
    name: 'Root',
    type: ROOT_FOLDER_TYPE,
    isFolder: true,
    isAnimationFolder: false,
    visible: true,
    opacity: 1,
    children: [],
    uuid: null,
    blend: 0,
    clipped: false,
    contentsRect: null,
  }

  flatInternal.set(root.id, root)
  sourceFlat.set(root.id, root)

  const rootLayerRefs = resolveArray(documentDict.layers, keyed)
  for (const layerRef of rootLayerRefs) {
    const layer = buildLayer(layerRef, keyed, () => nextId++)
    root.children.push(layer)
    collectLayer(layer, flatInternal, sourceFlat, layerByUuid)
  }

  const tileBytes = await loadTiles(zip)
  const timeline = parseTimeline(documentDict, keyed)

  const renderNode = (layerId: number, overrides?: Map<number, boolean>): Bitmap => {
    const layer = flatInternal.get(layerId)
    if (!layer) {
      throw new Error(`Layer id ${layerId} not found`)
    }
    return renderLayer(layer, canvas, tileSize, tileBytes, background, overrides)
  }

  return {
    canvas,
    root,
    flat: sourceFlat,
    timeline,
    cspTimelines: [],
    cspTimelineGroups: [],
    renderNode,
  }
}

async function loadTiles(zip: JSZip): Promise<Map<string, Uint8Array>> {
  const entries: Array<Promise<void>> = []
  const result = new Map<string, Uint8Array>()
  zip.forEach((relativePath, file) => {
    if (!file.dir && relativePath.endsWith('.lz4')) {
      entries.push(
        file.async('uint8array').then((bytes) => {
          result.set(relativePath, bytes)
        }),
      )
    }
  })
  await Promise.all(entries)
  return result
}

function keyedArchive(value: PlistValue): ArchiveContext & { root: PlistDict } {
  const archive = expectDict(value)
  const objects = expectArray(archive.$objects)
  const top = expectDict(archive.$top)
  const root = top.root ?? top.$root
  if (!root) {
    throw new Error('NSKeyedArchiver top root not found')
  }
  return {
    root: { root },
    objects,
    deref(candidate: PlistValue | undefined): PlistValue | undefined {
      if (candidate instanceof Uid) {
        return objects[candidate.value]
      }
      return candidate
    },
  }
}

function parseCanvas(documentDict: PlistDict, archive: ArchiveContext): SourceCanvas {
  const size = stringFrom(archive.deref(documentDict.size)) ?? '{0, 0}'
  const parsed = parseSize(size)
  const resolution =
    numberFrom(archive.deref(documentDict.SilicaDocumentArchiveDPIKey)) ?? DEFAULT_DPI
  return { width: parsed.width, height: parsed.height, resolution }
}

function parseSize(value: string): { width: number; height: number } {
  const match = /\{\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\}/.exec(value)
  if (!match) {
    throw new Error(`Unsupported canvas size: ${value}`)
  }
  return { width: Math.round(Number(match[1])), height: Math.round(Number(match[2])) }
}

function parseRectValue(value: PlistValue | undefined, archive: ArchiveContext): Rect | null {
  const resolved = archive.deref(value)
  if (typeof resolved === 'string') {
    return parseRectString(resolved)
  }
  if (resolved instanceof Uint8Array && resolved.length >= 32) {
    const view = new DataView(resolved.buffer, resolved.byteOffset, resolved.byteLength)
    return {
      x: Math.round(view.getFloat64(0, true)),
      y: Math.round(view.getFloat64(8, true)),
      width: Math.round(view.getFloat64(16, true)),
      height: Math.round(view.getFloat64(24, true)),
    }
  }
  return null
}

function parseRectString(value: string): Rect | null {
  if (value.length === 0) {
    return null
  }
  const match =
    /\{\s*\{\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*\}\s*,\s*\{\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\}\s*\}/.exec(
      value,
    )
  if (!match) {
    return null
  }
  return {
    x: Math.round(Number(match[1])),
    y: Math.round(Number(match[2])),
    width: Math.round(Number(match[3])),
    height: Math.round(Number(match[4])),
  }
}

function buildLayer(
  value: PlistValue,
  archive: ArchiveContext,
  allocateId: () => number,
): InternalLayer {
  const dict = expectDict(archive.deref(value))
  const kind = className(dict, archive)
  const isFolder = kind.includes('Group')
  const hidden =
    boolFrom(archive.deref(dict.hidden)) ?? boolFrom(archive.deref(dict.isHidden)) ?? false
  const name =
    stringFrom(archive.deref(dict.name)) ??
    stringFrom(archive.deref(dict.UUID)) ??
    (isFolder ? 'Group' : 'Layer')
  const opacity = normalizeOpacity(numberFrom(archive.deref(dict.opacity)) ?? 1)
  const uuid = stringFrom(archive.deref(dict.UUID))
  const layer: InternalLayer = {
    id: allocateId(),
    name,
    type: isFolder ? ROOT_FOLDER_TYPE : NORMAL_LAYER_TYPE,
    isFolder,
    isAnimationFolder: false,
    visible: !hidden,
    opacity,
    children: [],
    uuid: isFolder ? null : uuid,
    blend: numberFrom(archive.deref(dict.blend)) ?? 0,
    clipped: boolFrom(archive.deref(dict.clipped)) ?? false,
    contentsRect: parseRectValue(dict.contentsRect, archive),
  }

  if (isFolder) {
    const childRefs = resolveArray(dict.children, archive)
    for (const childRef of childRefs) {
      layer.children.push(buildLayer(childRef, archive, allocateId))
    }
  }

  return layer
}

function collectLayer(
  layer: InternalLayer,
  flatInternal: Map<number, InternalLayer>,
  sourceFlat: Map<number, SourceLayer>,
  layerByUuid: Map<string, InternalLayer>,
): void {
  flatInternal.set(layer.id, layer)
  sourceFlat.set(layer.id, layer)
  if (layer.uuid) {
    layerByUuid.set(layer.uuid, layer)
  }
  for (const child of layer.children) {
    collectLayer(child, flatInternal, sourceFlat, layerByUuid)
  }
}

function parseTimeline(
  documentDict: PlistDict,
  archive: ArchiveContext,
): SourceDocument['timeline'] {
  const animation = archive.deref(documentDict.animation)
  if (!isDict(animation)) {
    return null
  }
  const frameRate =
    numberFrom(archive.deref(animation.frameRate)) ??
    numberFrom(archive.deref(animation.framerate)) ??
    numberFrom(archive.deref(animation.framesPerSecond)) ??
    0
  const startFrame =
    numberFrom(archive.deref(animation.startFrame)) ??
    numberFrom(archive.deref(animation.start)) ??
    0
  const endFrame =
    numberFrom(archive.deref(animation.endFrame)) ?? numberFrom(archive.deref(animation.end)) ?? 0
  const name = stringFrom(archive.deref(animation.name)) ?? ''
  if (frameRate === 0 && startFrame === 0 && endFrame === 0 && name.length === 0) {
    return null
  }
  return { frameRate, startFrame, endFrame, name }
}

function parseBackground(documentDict: PlistDict, archive: ArchiveContext): Background {
  const hidden = boolFrom(archive.deref(documentDict.backgroundHidden)) ?? false
  const parsed = parseColor(archive.deref(documentDict.backgroundColor), archive)
  return { hidden, color: parsed ?? [255, 255, 255, 255] }
}

function parseColor(
  value: PlistValue | undefined,
  archive: ArchiveContext,
): [number, number, number, number] | null {
  const resolved = archive.deref(value)
  if (isArray(resolved)) {
    const numbers = resolved
      .map((entry) => numberFrom(archive.deref(entry)))
      .filter((entry): entry is number => entry !== null)
    if (numbers.length >= 3) {
      return [
        toByte(numbers[0] <= 1 ? numbers[0] * 255 : numbers[0]),
        toByte(numbers[1] <= 1 ? numbers[1] * 255 : numbers[1]),
        toByte(numbers[2] <= 1 ? numbers[2] * 255 : numbers[2]),
        toByte((numbers[3] ?? 1) <= 1 ? (numbers[3] ?? 1) * 255 : (numbers[3] ?? 255)),
      ]
    }
  }
  if (isDict(resolved)) {
    const components = resolveArray(resolved['NS.objects'] ?? resolved.components, archive)
    const numbers = components
      .map((entry) => numberFrom(archive.deref(entry)))
      .filter((entry): entry is number => entry !== null)
    if (numbers.length >= 3) {
      return [
        toByte(numbers[0] <= 1 ? numbers[0] * 255 : numbers[0]),
        toByte(numbers[1] <= 1 ? numbers[1] * 255 : numbers[1]),
        toByte(numbers[2] <= 1 ? numbers[2] * 255 : numbers[2]),
        toByte((numbers[3] ?? 1) <= 1 ? (numbers[3] ?? 1) * 255 : (numbers[3] ?? 255)),
      ]
    }
  }
  return null
}

function renderLayer(
  layer: InternalLayer,
  canvas: SourceCanvas,
  tileSize: number,
  tileBytes: Map<string, Uint8Array>,
  background: Background,
  overrides?: Map<number, boolean>,
): Bitmap {
  const visible = overrides?.get(layer.id) ?? layer.visible
  if (!visible) {
    return emptyBitmap(canvas.width, canvas.height)
  }

  let bitmap: Bitmap
  if (layer.isFolder) {
    bitmap =
      layer.id === 0 && !background.hidden
        ? filledBitmap(canvas.width, canvas.height, background.color)
        : emptyBitmap(canvas.width, canvas.height)
    for (let index = layer.children.length - 1; index >= 0; index -= 1) {
      const child = renderLayer(
        layer.children[index],
        canvas,
        tileSize,
        tileBytes,
        background,
        overrides,
      )
      alphaOver(bitmap, child)
    }
  } else {
    bitmap = renderTileLayer(layer, canvas, tileSize, tileBytes)
  }

  if (layer.id !== 0 && layer.opacity < 1) {
    applyOpacity(bitmap, layer.opacity)
  }
  return bitmap
}

function renderTileLayer(
  layer: InternalLayer,
  canvas: SourceCanvas,
  tileSize: number,
  tileBytes: Map<string, Uint8Array>,
): Bitmap {
  const bitmap = emptyBitmap(canvas.width, canvas.height)
  if (!layer.uuid) {
    return bitmap
  }

  const cols = Math.ceil(canvas.width / tileSize)
  const rows = Math.ceil(canvas.height / tileSize)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const tilePath = `${layer.uuid}/${col}~${row}.lz4`
      const compressed = tileBytes.get(tilePath)
      if (!compressed) {
        continue
      }
      const tileBounds: Rect = {
        x: col * tileSize,
        y: row * tileSize,
        width: Math.min(tileSize, canvas.width - col * tileSize),
        height: Math.min(tileSize, canvas.height - row * tileSize),
      }
      const drawBounds = tileBounds
      const expectedBytes = drawBounds.width * drawBounds.height * 4
      const raw = decodeTilePayload(compressed, expectedBytes)
      blitPremultipliedRgbaTile(
        bitmap,
        raw,
        raw.length,
        drawBounds.x,
        drawBounds.y,
        drawBounds.width,
        drawBounds.height,
      )
    }
  }
  return bitmap
}

function decodeTilePayload(bytes: Uint8Array, expectedBytes: number): Uint8Array {
  const marker = ascii(bytes.subarray(0, Math.min(4, bytes.length)))
  if (marker === 'bv41' || marker === 'bv4-' || marker === 'bv4$') {
    return decodeAppleLz4Stream(bytes, expectedBytes)
  }

  const raw = new Uint8Array(expectedBytes)
  const written = decompressBlock(bytes, raw, 0, bytes.length, 0)
  if (written > raw.length) {
    throw new Error(`Raw LZ4 block decoded to ${written} bytes, expected at most ${raw.length}`)
  }
  return raw
}

function decodeAppleLz4Stream(bytes: Uint8Array, expectedBytes: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0
  while (offset + 4 <= bytes.length) {
    const marker = ascii(bytes.subarray(offset, offset + 4))
    if (marker === 'bv4$') {
      offset += 4
      break
    }
    if (marker === 'bv4-') {
      if (offset + 8 > bytes.length) {
        throw new Error('Truncated bv4- tile chunk')
      }
      const size = readUInt32LE(bytes, offset + 4)
      chunks.push(bytes.slice(offset + 8, offset + 8 + size))
      offset += 8 + size
      continue
    }
    if (marker === 'bv41') {
      if (offset + 12 > bytes.length) {
        throw new Error('Truncated bv41 tile chunk')
      }
      const uncompressedSize = readUInt32LE(bytes, offset + 4)
      const compressedSize = readUInt32LE(bytes, offset + 8)
      const chunk = new Uint8Array(uncompressedSize)
      const written = decompressBlock(bytes, chunk, offset + 12, compressedSize, 0)
      if (written !== uncompressedSize) {
        throw new Error(`bv41 chunk decoded to ${written} bytes, expected ${uncompressedSize}`)
      }
      chunks.push(chunk)
      offset += 12 + compressedSize
      continue
    }
    throw new Error(`Unknown tile chunk marker ${JSON.stringify(marker)} at offset ${offset}`)
  }

  const decodedSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(Math.max(expectedBytes, decodedSize))
  let writeOffset = 0
  for (const chunk of chunks) {
    result.set(chunk, writeOffset)
    writeOffset += chunk.length
  }
  return result
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function blitPremultipliedRgbaTile(
  bitmap: Bitmap,
  raw: Uint8Array,
  rawLength: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
): void {
  const pixelOffset = 0
  for (let row = 0; row < tileHeight; row += 1) {
    for (let col = 0; col < tileWidth; col += 1) {
      const dst = ((y + row) * bitmap.width + x + col) * 4
      const src = pixelOffset + (row * tileWidth + col) * 4
      if (src + 3 >= rawLength) {
        bitmap.data[dst] = 0
        bitmap.data[dst + 1] = 0
        bitmap.data[dst + 2] = 0
        bitmap.data[dst + 3] = 0
        continue
      }
      const alpha = raw[src + 3]
      bitmap.data[dst + 3] = alpha
      if (alpha === 0) {
        bitmap.data[dst] = 0
        bitmap.data[dst + 1] = 0
        bitmap.data[dst + 2] = 0
      } else {
        bitmap.data[dst] = toByte((raw[src] * 255) / alpha)
        bitmap.data[dst + 1] = toByte((raw[src + 1] * 255) / alpha)
        bitmap.data[dst + 2] = toByte((raw[src + 2] * 255) / alpha)
      }
    }
  }
}

function emptyBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function filledBitmap(
  width: number,
  height: number,
  color: [number, number, number, number],
): Bitmap {
  const bitmap = emptyBitmap(width, height)
  for (let offset = 0; offset < bitmap.data.length; offset += 4) {
    bitmap.data[offset] = color[0]
    bitmap.data[offset + 1] = color[1]
    bitmap.data[offset + 2] = color[2]
    bitmap.data[offset + 3] = color[3]
  }
  return bitmap
}

function applyOpacity(bitmap: Bitmap, opacity: number): void {
  for (let offset = 3; offset < bitmap.data.length; offset += 4) {
    bitmap.data[offset] = toByte(bitmap.data[offset] * opacity)
  }
}

function alphaOver(dst: Bitmap, src: Bitmap): void {
  if (dst.width !== src.width || dst.height !== src.height) {
    throw new Error('Bitmap sizes do not match')
  }

  for (let offset = 0; offset < dst.data.length; offset += 4) {
    const sa = src.data[offset + 3] / 255
    if (sa === 0) {
      continue
    }
    const da = dst.data[offset + 3] / 255
    const oa = sa + da * (1 - sa)
    if (oa === 0) {
      dst.data[offset] = 0
      dst.data[offset + 1] = 0
      dst.data[offset + 2] = 0
      dst.data[offset + 3] = 0
      continue
    }
    dst.data[offset] = toByte((src.data[offset] * sa + dst.data[offset] * da * (1 - sa)) / oa)
    dst.data[offset + 1] = toByte(
      (src.data[offset + 1] * sa + dst.data[offset + 1] * da * (1 - sa)) / oa,
    )
    dst.data[offset + 2] = toByte(
      (src.data[offset + 2] * sa + dst.data[offset + 2] * da * (1 - sa)) / oa,
    )
    dst.data[offset + 3] = toByte(oa * 255)
  }
}

function normalizeOpacity(value: number): number {
  const normalized = value > 1 ? value / 255 : value
  return Math.max(0, Math.min(1, normalized))
}

function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function resolveArray(value: PlistValue | undefined, archive: ArchiveContext): PlistArray {
  const resolved = archive.deref(value)
  if (isArray(resolved)) {
    return resolved
  }
  if (isDict(resolved)) {
    const nsObjects = archive.deref(resolved['NS.objects'])
    if (isArray(nsObjects)) {
      return nsObjects
    }
  }
  return []
}

function className(dict: PlistDict, archive: ArchiveContext): string {
  const classDict = archive.deref(dict.$class)
  if (!isDict(classDict)) {
    return ''
  }
  return stringFrom(archive.deref(classDict.$classname)) ?? ''
}

function getDict(dict: PlistDict, key: string): PlistValue | undefined {
  return dict[key]
}

function expectDict(value: PlistValue | undefined): PlistDict {
  if (!isDict(value)) {
    throw new Error('Expected plist dictionary')
  }
  return value
}

function expectArray(value: PlistValue | undefined): PlistArray {
  if (!isArray(value)) {
    throw new Error('Expected plist array')
  }
  return value
}

function isDict(value: PlistValue | undefined): value is PlistDict {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Uid) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    !Array.isArray(value)
  )
}

function isArray(value: PlistValue | undefined): value is PlistArray {
  return Array.isArray(value)
}

function stringFrom(value: PlistValue | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function numberFrom(value: PlistValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boolFrom(value: PlistValue | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  const reader = new BinaryPlistReader(bytes)
  return reader.parse()
}

class BinaryPlistReader {
  private readonly offsetSize: number
  private readonly refSize: number
  private readonly numObjects: number
  private readonly topObject: number
  private readonly offsetTableOffset: number
  private readonly offsets: number[]
  private readonly cache = new Map<number, PlistValue>()

  constructor(private readonly bytes: Uint8Array) {
    const header = ascii(bytes.subarray(0, 8))
    if (header !== 'bplist00') {
      throw new Error(`Unsupported plist header: ${header}`)
    }
    const trailer = bytes.length - 32
    this.offsetSize = bytes[trailer + 6]
    this.refSize = bytes[trailer + 7]
    this.numObjects = Number(readUInt(bytes, trailer + 8, 8))
    this.topObject = Number(readUInt(bytes, trailer + 16, 8))
    this.offsetTableOffset = Number(readUInt(bytes, trailer + 24, 8))
    this.offsets = []
    for (let index = 0; index < this.numObjects; index += 1) {
      this.offsets.push(
        Number(readUInt(bytes, this.offsetTableOffset + index * this.offsetSize, this.offsetSize)),
      )
    }
  }

  parse(): PlistValue {
    return this.readObject(this.topObject)
  }

  private readObject(index: number): PlistValue {
    const cached = this.cache.get(index)
    if (cached !== undefined) {
      return cached
    }
    const offset = this.offsets[index]
    const marker = this.bytes[offset]
    const type = marker >> 4
    const info = marker & 0x0f
    const object = this.readObjectAt(offset, type, info)
    this.cache.set(index, object)
    return object
  }

  private readObjectAt(offset: number, type: number, info: number): PlistValue {
    switch (type) {
      case 0x0:
        if (info === 0x0) return null
        if (info === 0x8) return false
        if (info === 0x9) return true
        throw new Error(`Unsupported simple plist object 0x${info.toString(16)}`)
      case 0x1:
        return Number(readUInt(this.bytes, offset + 1, 1 << info))
      case 0x2:
        return readReal(this.bytes, offset + 1, 1 << info)
      case 0x3:
        return new Date((readReal(this.bytes, offset + 1, 8) + 978307200) * 1000)
      case 0x4: {
        const length = this.readCount(offset, info)
        return this.bytes.slice(length.offset, length.offset + length.count)
      }
      case 0x5: {
        const length = this.readCount(offset, info)
        return ascii(this.bytes.subarray(length.offset, length.offset + length.count))
      }
      case 0x6: {
        const length = this.readCount(offset, info)
        return utf16be(this.bytes.subarray(length.offset, length.offset + length.count * 2))
      }
      case 0x8: {
        const length = info + 1
        return new Uid(Number(readUInt(this.bytes, offset + 1, length)))
      }
      case 0xa:
      case 0xb:
      case 0xc: {
        const length = this.readCount(offset, info)
        const result: PlistArray = []
        for (let item = 0; item < length.count; item += 1) {
          const ref = Number(
            readUInt(this.bytes, length.offset + item * this.refSize, this.refSize),
          )
          result.push(this.readObject(ref))
        }
        return result
      }
      case 0xd: {
        const length = this.readCount(offset, info)
        const keysOffset = length.offset
        const valuesOffset = keysOffset + length.count * this.refSize
        const result: PlistDict = {}
        for (let item = 0; item < length.count; item += 1) {
          const keyRef = Number(
            readUInt(this.bytes, keysOffset + item * this.refSize, this.refSize),
          )
          const valueRef = Number(
            readUInt(this.bytes, valuesOffset + item * this.refSize, this.refSize),
          )
          const key = this.readObject(keyRef)
          if (typeof key !== 'string') {
            throw new Error('Non-string dictionary key')
          }
          result[key] = this.readObject(valueRef)
        }
        return result
      }
      default:
        throw new Error(`Unsupported plist object type 0x${type.toString(16)}`)
    }
  }

  private readCount(offset: number, info: number): { count: number; offset: number } {
    if (info < 0x0f) {
      return { count: info, offset: offset + 1 }
    }
    const intMarker = this.bytes[offset + 1]
    if (intMarker >> 4 !== 0x1) {
      throw new Error('Extended plist count is not encoded as integer')
    }
    const byteLength = 1 << (intMarker & 0x0f)
    return {
      count: Number(readUInt(this.bytes, offset + 2, byteLength)),
      offset: offset + 2 + byteLength,
    }
  }
}

function readUInt(bytes: Uint8Array, offset: number, length: number): bigint {
  let value = 0n
  for (let index = 0; index < length; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index])
  }
  return value
}

function readReal(bytes: Uint8Array, offset: number, length: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, length)
  if (length === 4) {
    return view.getFloat32(0, false)
  }
  if (length === 8) {
    return view.getFloat64(0, false)
  }
  throw new Error(`Unsupported real byte length ${length}`)
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

function utf16be(bytes: Uint8Array): string {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 2) {
    result += String.fromCharCode((bytes[offset] << 8) | bytes[offset + 1])
  }
  return result
}
