export interface BincNode {
  name: string
  type: string
  value: unknown
  attrs: Record<string, string>
  children: BincNode[]
}

const TYPES = [
  'null',
  'Byte',
  'SByte',
  'UInt16',
  'Int16',
  'UInt32',
  'Int32',
  'Single',
  'Double',
  'String',
  'Float2',
  'Float3',
  'Quat',
  'Matrix44',
  'Single[]',
  'Byte[]',
  'Int32[]',
  'String[]',
  'Float2[]',
  'Float3[]',
  'Quat[]',
  'Matrix44[]',
] as const

export function parseBinc(data: Buffer): BincNode {
  let offset = 0
  const need = (count: number): void => {
    if (offset + count > data.length) throw new Error(`Unexpected end of BINC at ${offset}`)
  }
  const u8 = (): number => {
    need(1)
    return data[offset++]!
  }
  const u16 = (): number => {
    need(2)
    const v = data.readUInt16LE(offset)
    offset += 2
    return v
  }
  const i16 = (): number => {
    need(2)
    const v = data.readInt16LE(offset)
    offset += 2
    return v
  }
  const u32 = (): number => {
    need(4)
    const v = data.readUInt32LE(offset)
    offset += 4
    return v
  }
  const i32 = (): number => {
    need(4)
    const v = data.readInt32LE(offset)
    offset += 4
    return v
  }
  const f32 = (): number => {
    need(4)
    const v = data.readFloatLE(offset)
    offset += 4
    return v
  }
  const f64 = (): number => {
    need(8)
    const v = data.readDoubleLE(offset)
    offset += 8
    return v
  }
  const bytes = (count: number): Buffer => {
    need(count)
    const v = data.subarray(offset, offset + count)
    offset += count
    return v
  }
  if (bytes(12).toString('ascii') !== 'cmt 0100binc') throw new Error('Invalid BINC magic')
  bytes(4)
  const strings = Array.from({ length: u32() }, () => bytes(u8()).toString('utf8'))
  TYPES.forEach((type, index) => {
    if (strings[index] !== type) throw new Error(`Invalid BINC type ${index}`)
  })
  const stringAt = (index: number): string => {
    const v = strings[index]
    if (v === undefined) throw new Error(`Invalid BINC string index ${index}`)
    return v
  }
  const vector = (count: number): number[] => Array.from({ length: count }, f32)
  const readValue = (type: number): unknown => {
    switch (type) {
      case 0:
        return null
      case 1:
        return u8()
      case 2: {
        const v = u8()
        return v > 127 ? v - 256 : v
      }
      case 3:
        return u16()
      case 4:
        return i16()
      case 5:
        return u32()
      case 6:
        return i32()
      case 7:
        return f32()
      case 8:
        return f64()
      case 9:
        return stringAt(u32())
      case 10:
        return vector(2)
      case 11:
        return vector(3)
      case 12:
        return vector(4)
      case 13:
        return vector(16)
      case 14:
        return Array.from({ length: u32() }, f32)
      case 15:
        return [...bytes(u32())]
      case 16:
        return Array.from({ length: u32() }, i32)
      case 17:
        return Array.from({ length: u32() }, () => stringAt(u32()))
      case 18:
        return Array.from({ length: u32() }, () => vector(2))
      case 19:
        return Array.from({ length: u32() }, () => vector(3))
      case 20:
        return Array.from({ length: u32() }, () => vector(4))
      case 21:
        return Array.from({ length: u32() }, () => vector(16))
      default:
        throw new Error(`Unknown BINC type ${type}`)
    }
  }
  const readNode = (): BincNode => {
    const name = stringAt(u32())
    const typeIndex = u32()
    const value = readValue(typeIndex)
    const attrs: Record<string, string> = {}
    for (let count = u32(); count > 0; count -= 1) attrs[stringAt(u32())] = stringAt(u32())
    const children = Array.from({ length: u32() }, readNode)
    return { name, type: TYPES[typeIndex] ?? String(typeIndex), value, attrs, children }
  }
  const root = readNode()
  if (offset !== data.length) throw new Error(`BINC has ${data.length - offset} unparsed bytes`)
  return root
}
