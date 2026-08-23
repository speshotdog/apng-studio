var __create = Object.create
var __defProp = Object.defineProperty
var __getOwnPropDesc = Object.getOwnPropertyDescriptor
var __getOwnPropNames = Object.getOwnPropertyNames
var __getProtoOf = Object.getPrototypeOf
var __hasOwnProp = Object.prototype.hasOwnProperty
var __commonJS = (cb, mod) =>
  function __require() {
    return (
      mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
      mod.exports
    )
  }
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === 'object') || typeof from === 'function') {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        })
  }
  return to
}
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule
      ? __defProp(target, 'default', { value: mod, enumerable: true })
      : target,
    mod,
  )
)

// node_modules/gifenc/dist/gifenc.js
var require_gifenc = __commonJS({
  'node_modules/gifenc/dist/gifenc.js'(exports) {
    var __defProp2 = Object.defineProperty
    var __markAsModule = (target) => __defProp2(target, '__esModule', { value: true })
    var __export = (target, all) => {
      for (var name in all) __defProp2(target, name, { get: all[name], enumerable: true })
    }
    __markAsModule(exports)
    __export(exports, {
      GIFEncoder: () => GIFEncoder2,
      applyPalette: () => applyPalette2,
      default: () => src_default,
      nearestColor: () => nearestColor,
      nearestColorIndex: () => nearestColorIndex,
      nearestColorIndexWithDistance: () => nearestColorIndexWithDistance,
      prequantize: () => prequantize,
      quantize: () => quantize2,
      snapColorsToPalette: () => snapColorsToPalette,
    })
    var constants_default = {
      signature: 'GIF',
      version: '89a',
      trailer: 59,
      extensionIntroducer: 33,
      applicationExtensionLabel: 255,
      graphicControlExtensionLabel: 249,
      imageSeparator: 44,
      signatureSize: 3,
      versionSize: 3,
      globalColorTableFlagMask: 128,
      colorResolutionMask: 112,
      sortFlagMask: 8,
      globalColorTableSizeMask: 7,
      applicationIdentifierSize: 8,
      applicationAuthCodeSize: 3,
      disposalMethodMask: 28,
      userInputFlagMask: 2,
      transparentColorFlagMask: 1,
      localColorTableFlagMask: 128,
      interlaceFlagMask: 64,
      idSortFlagMask: 32,
      localColorTableSizeMask: 7,
    }
    function createStream(initialCapacity = 256) {
      let cursor = 0
      let contents = new Uint8Array(initialCapacity)
      return {
        get buffer() {
          return contents.buffer
        },
        reset() {
          cursor = 0
        },
        bytesView() {
          return contents.subarray(0, cursor)
        },
        bytes() {
          return contents.slice(0, cursor)
        },
        writeByte(byte) {
          expand(cursor + 1)
          contents[cursor] = byte
          cursor++
        },
        writeBytes(data, offset = 0, byteLength = data.length) {
          expand(cursor + byteLength)
          for (let i = 0; i < byteLength; i++) {
            contents[cursor++] = data[i + offset]
          }
        },
        writeBytesView(data, offset = 0, byteLength = data.byteLength) {
          expand(cursor + byteLength)
          contents.set(data.subarray(offset, offset + byteLength), cursor)
          cursor += byteLength
        },
      }
      function expand(newCapacity) {
        var prevCapacity = contents.length
        if (prevCapacity >= newCapacity) return
        var CAPACITY_DOUBLING_MAX = 1024 * 1024
        newCapacity = Math.max(
          newCapacity,
          (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125)) >>> 0,
        )
        if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256)
        const oldContents = contents
        contents = new Uint8Array(newCapacity)
        if (cursor > 0) contents.set(oldContents.subarray(0, cursor), 0)
      }
    }
    var BITS = 12
    var DEFAULT_HSIZE = 5003
    var MASKS = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535]
    function lzwEncode(
      width,
      height,
      pixels,
      colorDepth,
      outStream = createStream(512),
      accum = new Uint8Array(256),
      htab = new Int32Array(DEFAULT_HSIZE),
      codetab = new Int32Array(DEFAULT_HSIZE),
    ) {
      const hsize = htab.length
      const initCodeSize = Math.max(2, colorDepth)
      accum.fill(0)
      codetab.fill(0)
      htab.fill(-1)
      let cur_accum = 0
      let cur_bits = 0
      const init_bits = initCodeSize + 1
      const g_init_bits = init_bits
      let clear_flg = false
      let n_bits = g_init_bits
      let maxcode = (1 << n_bits) - 1
      const ClearCode = 1 << (init_bits - 1)
      const EOFCode = ClearCode + 1
      let free_ent = ClearCode + 2
      let a_count = 0
      let ent = pixels[0]
      let hshift = 0
      for (let fcode = hsize; fcode < 65536; fcode *= 2) {
        ++hshift
      }
      hshift = 8 - hshift
      outStream.writeByte(initCodeSize)
      output(ClearCode)
      const length = pixels.length
      for (let idx = 1; idx < length; idx++) {
        next_block: {
          const c = pixels[idx]
          const fcode = (c << BITS) + ent
          let i = (c << hshift) ^ ent
          if (htab[i] === fcode) {
            ent = codetab[i]
            break next_block
          }
          const disp = i === 0 ? 1 : hsize - i
          while (htab[i] >= 0) {
            i -= disp
            if (i < 0) i += hsize
            if (htab[i] === fcode) {
              ent = codetab[i]
              break next_block
            }
          }
          output(ent)
          ent = c
          if (free_ent < 1 << BITS) {
            codetab[i] = free_ent++
            htab[i] = fcode
          } else {
            htab.fill(-1)
            free_ent = ClearCode + 2
            clear_flg = true
            output(ClearCode)
          }
        }
      }
      output(ent)
      output(EOFCode)
      outStream.writeByte(0)
      return outStream.bytesView()
      function output(code) {
        cur_accum &= MASKS[cur_bits]
        if (cur_bits > 0) cur_accum |= code << cur_bits
        else cur_accum = code
        cur_bits += n_bits
        while (cur_bits >= 8) {
          accum[a_count++] = cur_accum & 255
          if (a_count >= 254) {
            outStream.writeByte(a_count)
            outStream.writeBytesView(accum, 0, a_count)
            a_count = 0
          }
          cur_accum >>= 8
          cur_bits -= 8
        }
        if (free_ent > maxcode || clear_flg) {
          if (clear_flg) {
            n_bits = g_init_bits
            maxcode = (1 << n_bits) - 1
            clear_flg = false
          } else {
            ++n_bits
            maxcode = n_bits === BITS ? 1 << n_bits : (1 << n_bits) - 1
          }
        }
        if (code == EOFCode) {
          while (cur_bits > 0) {
            accum[a_count++] = cur_accum & 255
            if (a_count >= 254) {
              outStream.writeByte(a_count)
              outStream.writeBytesView(accum, 0, a_count)
              a_count = 0
            }
            cur_accum >>= 8
            cur_bits -= 8
          }
          if (a_count > 0) {
            outStream.writeByte(a_count)
            outStream.writeBytesView(accum, 0, a_count)
            a_count = 0
          }
        }
      }
    }
    var lzwEncode_default = lzwEncode
    function rgb888_to_rgb565(r, g, b) {
      return ((r << 8) & 63488) | ((g << 2) & 992) | (b >> 3)
    }
    function rgba8888_to_rgba4444(r, g, b, a) {
      return (r >> 4) | (g & 240) | ((b & 240) << 4) | ((a & 240) << 8)
    }
    function rgb888_to_rgb444(r, g, b) {
      return ((r >> 4) << 8) | (g & 240) | (b >> 4)
    }
    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value
    }
    function sqr(value) {
      return value * value
    }
    function find_nn(bins, idx, hasAlpha) {
      var nn = 0
      var err = 1e100
      const bin1 = bins[idx]
      const n1 = bin1.cnt
      const wa = bin1.ac
      const wr = bin1.rc
      const wg = bin1.gc
      const wb = bin1.bc
      for (var i = bin1.fw; i != 0; i = bins[i].fw) {
        const bin = bins[i]
        const n2 = bin.cnt
        const nerr2 = (n1 * n2) / (n1 + n2)
        if (nerr2 >= err) continue
        var nerr = 0
        if (hasAlpha) {
          nerr += nerr2 * sqr(bin.ac - wa)
          if (nerr >= err) continue
        }
        nerr += nerr2 * sqr(bin.rc - wr)
        if (nerr >= err) continue
        nerr += nerr2 * sqr(bin.gc - wg)
        if (nerr >= err) continue
        nerr += nerr2 * sqr(bin.bc - wb)
        if (nerr >= err) continue
        err = nerr
        nn = i
      }
      bin1.err = err
      bin1.nn = nn
    }
    function create_bin() {
      return {
        ac: 0,
        rc: 0,
        gc: 0,
        bc: 0,
        cnt: 0,
        nn: 0,
        fw: 0,
        bk: 0,
        tm: 0,
        mtm: 0,
        err: 0,
      }
    }
    function create_bin_list(data, format) {
      const bincount = format === 'rgb444' ? 4096 : 65536
      const bins = new Array(bincount)
      const size = data.length
      if (format === 'rgba4444') {
        for (let i = 0; i < size; ++i) {
          const color = data[i]
          const a = (color >> 24) & 255
          const b = (color >> 16) & 255
          const g = (color >> 8) & 255
          const r = color & 255
          const index = rgba8888_to_rgba4444(r, g, b, a)
          let bin = index in bins ? bins[index] : (bins[index] = create_bin())
          bin.rc += r
          bin.gc += g
          bin.bc += b
          bin.ac += a
          bin.cnt++
        }
      } else if (format === 'rgb444') {
        for (let i = 0; i < size; ++i) {
          const color = data[i]
          const b = (color >> 16) & 255
          const g = (color >> 8) & 255
          const r = color & 255
          const index = rgb888_to_rgb444(r, g, b)
          let bin = index in bins ? bins[index] : (bins[index] = create_bin())
          bin.rc += r
          bin.gc += g
          bin.bc += b
          bin.cnt++
        }
      } else {
        for (let i = 0; i < size; ++i) {
          const color = data[i]
          const b = (color >> 16) & 255
          const g = (color >> 8) & 255
          const r = color & 255
          const index = rgb888_to_rgb565(r, g, b)
          let bin = index in bins ? bins[index] : (bins[index] = create_bin())
          bin.rc += r
          bin.gc += g
          bin.bc += b
          bin.cnt++
        }
      }
      return bins
    }
    function quantize2(rgba, maxColors, opts = {}) {
      const {
        format = 'rgb565',
        clearAlpha = true,
        clearAlphaColor = 0,
        clearAlphaThreshold = 0,
        oneBitAlpha = false,
      } = opts
      if (!rgba || !rgba.buffer) {
        throw new Error('quantize() expected RGBA Uint8Array data')
      }
      if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
        throw new Error('quantize() expected RGBA Uint8Array data')
      }
      const data = new Uint32Array(rgba.buffer)
      let useSqrt = opts.useSqrt !== false
      const hasAlpha = format === 'rgba4444'
      const bins = create_bin_list(data, format)
      const bincount = bins.length
      const bincountMinusOne = bincount - 1
      const heap = new Uint32Array(bincount + 1)
      var maxbins = 0
      for (var i = 0; i < bincount; ++i) {
        const bin = bins[i]
        if (bin != null) {
          var d = 1 / bin.cnt
          if (hasAlpha) bin.ac *= d
          bin.rc *= d
          bin.gc *= d
          bin.bc *= d
          bins[maxbins++] = bin
        }
      }
      if (sqr(maxColors) / maxbins < 0.022) {
        useSqrt = false
      }
      var i = 0
      for (; i < maxbins - 1; ++i) {
        bins[i].fw = i + 1
        bins[i + 1].bk = i
        if (useSqrt) bins[i].cnt = Math.sqrt(bins[i].cnt)
      }
      if (useSqrt) bins[i].cnt = Math.sqrt(bins[i].cnt)
      var h, l, l2
      for (i = 0; i < maxbins; ++i) {
        find_nn(bins, i, false)
        var err = bins[i].err
        for (l = ++heap[0]; l > 1; l = l2) {
          l2 = l >> 1
          if (bins[(h = heap[l2])].err <= err) break
          heap[l] = h
        }
        heap[l] = i
      }
      var extbins = maxbins - maxColors
      for (i = 0; i < extbins;) {
        var tb
        for (;;) {
          var b1 = heap[1]
          tb = bins[b1]
          if (tb.tm >= tb.mtm && bins[tb.nn].mtm <= tb.tm) break
          if (tb.mtm == bincountMinusOne) b1 = heap[1] = heap[heap[0]--]
          else {
            find_nn(bins, b1, false)
            tb.tm = i
          }
          var err = bins[b1].err
          for (l = 1; (l2 = l + l) <= heap[0]; l = l2) {
            if (l2 < heap[0] && bins[heap[l2]].err > bins[heap[l2 + 1]].err) l2++
            if (err <= bins[(h = heap[l2])].err) break
            heap[l] = h
          }
          heap[l] = b1
        }
        var nb = bins[tb.nn]
        var n1 = tb.cnt
        var n2 = nb.cnt
        var d = 1 / (n1 + n2)
        if (hasAlpha) tb.ac = d * (n1 * tb.ac + n2 * nb.ac)
        tb.rc = d * (n1 * tb.rc + n2 * nb.rc)
        tb.gc = d * (n1 * tb.gc + n2 * nb.gc)
        tb.bc = d * (n1 * tb.bc + n2 * nb.bc)
        tb.cnt += nb.cnt
        tb.mtm = ++i
        bins[nb.bk].fw = nb.fw
        bins[nb.fw].bk = nb.bk
        nb.mtm = bincountMinusOne
      }
      let palette = []
      var k = 0
      for (i = 0; ; ++k) {
        let r = clamp(Math.round(bins[i].rc), 0, 255)
        let g = clamp(Math.round(bins[i].gc), 0, 255)
        let b = clamp(Math.round(bins[i].bc), 0, 255)
        let a = 255
        if (hasAlpha) {
          a = clamp(Math.round(bins[i].ac), 0, 255)
          if (oneBitAlpha) {
            const threshold = typeof oneBitAlpha === 'number' ? oneBitAlpha : 127
            a = a <= threshold ? 0 : 255
          }
          if (clearAlpha && a <= clearAlphaThreshold) {
            r = g = b = clearAlphaColor
            a = 0
          }
        }
        const color = hasAlpha ? [r, g, b, a] : [r, g, b]
        const exists = existsInPalette(palette, color)
        if (!exists) palette.push(color)
        if ((i = bins[i].fw) == 0) break
      }
      return palette
    }
    function existsInPalette(palette, color) {
      for (let i = 0; i < palette.length; i++) {
        const p = palette[i]
        let matchesRGB = p[0] === color[0] && p[1] === color[1] && p[2] === color[2]
        let matchesAlpha = p.length >= 4 && color.length >= 4 ? p[3] === color[3] : true
        if (matchesRGB && matchesAlpha) return true
      }
      return false
    }
    function euclideanDistanceSquared(a, b) {
      var sum = 0
      var n
      for (n = 0; n < a.length; n++) {
        const dx = a[n] - b[n]
        sum += dx * dx
      }
      return sum
    }
    function roundStep(byte, step) {
      return step > 1 ? Math.round(byte / step) * step : byte
    }
    function prequantize(rgba, { roundRGB = 5, roundAlpha = 10, oneBitAlpha = null } = {}) {
      const data = new Uint32Array(rgba.buffer)
      for (let i = 0; i < data.length; i++) {
        const color = data[i]
        let a = (color >> 24) & 255
        let b = (color >> 16) & 255
        let g = (color >> 8) & 255
        let r = color & 255
        a = roundStep(a, roundAlpha)
        if (oneBitAlpha) {
          const threshold = typeof oneBitAlpha === 'number' ? oneBitAlpha : 127
          a = a <= threshold ? 0 : 255
        }
        r = roundStep(r, roundRGB)
        g = roundStep(g, roundRGB)
        b = roundStep(b, roundRGB)
        data[i] = (a << 24) | (b << 16) | (g << 8) | (r << 0)
      }
    }
    function applyPalette2(rgba, palette, format = 'rgb565') {
      if (!rgba || !rgba.buffer) {
        throw new Error('quantize() expected RGBA Uint8Array data')
      }
      if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
        throw new Error('quantize() expected RGBA Uint8Array data')
      }
      if (palette.length > 256) {
        throw new Error('applyPalette() only works with 256 colors or less')
      }
      const data = new Uint32Array(rgba.buffer)
      const length = data.length
      const bincount = format === 'rgb444' ? 4096 : 65536
      const index = new Uint8Array(length)
      const cache = new Array(bincount)
      const hasAlpha = format === 'rgba4444'
      if (format === 'rgba4444') {
        for (let i = 0; i < length; i++) {
          const color = data[i]
          const a = (color >> 24) & 255
          const b = (color >> 16) & 255
          const g = (color >> 8) & 255
          const r = color & 255
          const key = rgba8888_to_rgba4444(r, g, b, a)
          const idx =
            key in cache ? cache[key] : (cache[key] = nearestColorIndexRGBA(r, g, b, a, palette))
          index[i] = idx
        }
      } else {
        const rgb888_to_key = format === 'rgb444' ? rgb888_to_rgb444 : rgb888_to_rgb565
        for (let i = 0; i < length; i++) {
          const color = data[i]
          const b = (color >> 16) & 255
          const g = (color >> 8) & 255
          const r = color & 255
          const key = rgb888_to_key(r, g, b)
          const idx =
            key in cache ? cache[key] : (cache[key] = nearestColorIndexRGB(r, g, b, palette))
          index[i] = idx
        }
      }
      return index
    }
    function nearestColorIndexRGBA(r, g, b, a, palette) {
      let k = 0
      let mindist = 1e100
      for (let i = 0; i < palette.length; i++) {
        const px2 = palette[i]
        const a2 = px2[3]
        let curdist = sqr2(a2 - a)
        if (curdist > mindist) continue
        const r2 = px2[0]
        curdist += sqr2(r2 - r)
        if (curdist > mindist) continue
        const g2 = px2[1]
        curdist += sqr2(g2 - g)
        if (curdist > mindist) continue
        const b2 = px2[2]
        curdist += sqr2(b2 - b)
        if (curdist > mindist) continue
        mindist = curdist
        k = i
      }
      return k
    }
    function nearestColorIndexRGB(r, g, b, palette) {
      let k = 0
      let mindist = 1e100
      for (let i = 0; i < palette.length; i++) {
        const px2 = palette[i]
        const r2 = px2[0]
        let curdist = sqr2(r2 - r)
        if (curdist > mindist) continue
        const g2 = px2[1]
        curdist += sqr2(g2 - g)
        if (curdist > mindist) continue
        const b2 = px2[2]
        curdist += sqr2(b2 - b)
        if (curdist > mindist) continue
        mindist = curdist
        k = i
      }
      return k
    }
    function snapColorsToPalette(palette, knownColors, threshold = 5) {
      if (!palette.length || !knownColors.length) return
      const paletteRGB = palette.map((p) => p.slice(0, 3))
      const thresholdSq = threshold * threshold
      const dim = palette[0].length
      for (let i = 0; i < knownColors.length; i++) {
        let color = knownColors[i]
        if (color.length < dim) {
          color = [color[0], color[1], color[2], 255]
        } else if (color.length > dim) {
          color = color.slice(0, 3)
        } else {
          color = color.slice()
        }
        const r = nearestColorIndexWithDistance(
          paletteRGB,
          color.slice(0, 3),
          euclideanDistanceSquared,
        )
        const idx = r[0]
        const distanceSq = r[1]
        if (distanceSq > 0 && distanceSq <= thresholdSq) {
          palette[idx] = color
        }
      }
    }
    function sqr2(a) {
      return a * a
    }
    function nearestColorIndex(colors, pixel, distanceFn = euclideanDistanceSquared) {
      let minDist = Infinity
      let minDistIndex = -1
      for (let j = 0; j < colors.length; j++) {
        const paletteColor = colors[j]
        const dist = distanceFn(pixel, paletteColor)
        if (dist < minDist) {
          minDist = dist
          minDistIndex = j
        }
      }
      return minDistIndex
    }
    function nearestColorIndexWithDistance(colors, pixel, distanceFn = euclideanDistanceSquared) {
      let minDist = Infinity
      let minDistIndex = -1
      for (let j = 0; j < colors.length; j++) {
        const paletteColor = colors[j]
        const dist = distanceFn(pixel, paletteColor)
        if (dist < minDist) {
          minDist = dist
          minDistIndex = j
        }
      }
      return [minDistIndex, minDist]
    }
    function nearestColor(colors, pixel, distanceFn = euclideanDistanceSquared) {
      return colors[nearestColorIndex(colors, pixel, distanceFn)]
    }
    function GIFEncoder2(opt = {}) {
      const { initialCapacity = 4096, auto = true } = opt
      const stream = createStream(initialCapacity)
      const HSIZE = 5003
      const accum = new Uint8Array(256)
      const htab = new Int32Array(HSIZE)
      const codetab = new Int32Array(HSIZE)
      let hasInit = false
      return {
        reset() {
          stream.reset()
          hasInit = false
        },
        finish() {
          stream.writeByte(constants_default.trailer)
        },
        bytes() {
          return stream.bytes()
        },
        bytesView() {
          return stream.bytesView()
        },
        get buffer() {
          return stream.buffer
        },
        get stream() {
          return stream
        },
        writeHeader,
        writeFrame(index, width, height, opts = {}) {
          const {
            transparent = false,
            transparentIndex = 0,
            delay = 0,
            palette = null,
            repeat = 0,
            colorDepth = 8,
            dispose = -1,
          } = opts
          let first = false
          if (auto) {
            if (!hasInit) {
              first = true
              writeHeader()
              hasInit = true
            }
          } else {
            first = Boolean(opts.first)
          }
          width = Math.max(0, Math.floor(width))
          height = Math.max(0, Math.floor(height))
          if (first) {
            if (!palette) {
              throw new Error('First frame must include a { palette } option')
            }
            encodeLogicalScreenDescriptor(stream, width, height, palette, colorDepth)
            encodeColorTable(stream, palette)
            if (repeat >= 0) {
              encodeNetscapeExt(stream, repeat)
            }
          }
          const delayTime = Math.round(delay / 10)
          encodeGraphicControlExt(stream, dispose, delayTime, transparent, transparentIndex)
          const useLocalColorTable = Boolean(palette) && !first
          encodeImageDescriptor(stream, width, height, useLocalColorTable ? palette : null)
          if (useLocalColorTable) encodeColorTable(stream, palette)
          encodePixels(stream, index, width, height, colorDepth, accum, htab, codetab)
        },
      }
      function writeHeader() {
        writeUTFBytes(stream, 'GIF89a')
      }
    }
    function encodeGraphicControlExt(stream, dispose, delay, transparent, transparentIndex) {
      stream.writeByte(33)
      stream.writeByte(249)
      stream.writeByte(4)
      if (transparentIndex < 0) {
        transparentIndex = 0
        transparent = false
      }
      var transp, disp
      if (!transparent) {
        transp = 0
        disp = 0
      } else {
        transp = 1
        disp = 2
      }
      if (dispose >= 0) {
        disp = dispose & 7
      }
      disp <<= 2
      const userInput = 0
      stream.writeByte(0 | disp | userInput | transp)
      writeUInt16(stream, delay)
      stream.writeByte(transparentIndex || 0)
      stream.writeByte(0)
    }
    function encodeLogicalScreenDescriptor(stream, width, height, palette, colorDepth = 8) {
      const globalColorTableFlag = 1
      const sortFlag = 0
      const globalColorTableSize = colorTableSize(palette.length) - 1
      const fields =
        (globalColorTableFlag << 7) |
        ((colorDepth - 1) << 4) |
        (sortFlag << 3) |
        globalColorTableSize
      const backgroundColorIndex = 0
      const pixelAspectRatio = 0
      writeUInt16(stream, width)
      writeUInt16(stream, height)
      stream.writeBytes([fields, backgroundColorIndex, pixelAspectRatio])
    }
    function encodeNetscapeExt(stream, repeat) {
      stream.writeByte(33)
      stream.writeByte(255)
      stream.writeByte(11)
      writeUTFBytes(stream, 'NETSCAPE2.0')
      stream.writeByte(3)
      stream.writeByte(1)
      writeUInt16(stream, repeat)
      stream.writeByte(0)
    }
    function encodeColorTable(stream, palette) {
      const colorTableLength = 1 << colorTableSize(palette.length)
      for (let i = 0; i < colorTableLength; i++) {
        let color = [0, 0, 0]
        if (i < palette.length) {
          color = palette[i]
        }
        stream.writeByte(color[0])
        stream.writeByte(color[1])
        stream.writeByte(color[2])
      }
    }
    function encodeImageDescriptor(stream, width, height, localPalette) {
      stream.writeByte(44)
      writeUInt16(stream, 0)
      writeUInt16(stream, 0)
      writeUInt16(stream, width)
      writeUInt16(stream, height)
      if (localPalette) {
        const interlace = 0
        const sorted = 0
        const palSize = colorTableSize(localPalette.length) - 1
        stream.writeByte(128 | interlace | sorted | 0 | palSize)
      } else {
        stream.writeByte(0)
      }
    }
    function encodePixels(stream, index, width, height, colorDepth = 8, accum, htab, codetab) {
      lzwEncode_default(width, height, index, colorDepth, stream, accum, htab, codetab)
    }
    function writeUInt16(stream, short) {
      stream.writeByte(short & 255)
      stream.writeByte((short >> 8) & 255)
    }
    function writeUTFBytes(stream, text) {
      for (var i = 0; i < text.length; i++) {
        stream.writeByte(text.charCodeAt(i))
      }
    }
    function colorTableSize(length) {
      return Math.max(Math.ceil(Math.log2(length)), 1)
    }
    var src_default = GIFEncoder2
  },
})

// scripts/smoke.ts
import assert from 'node:assert/strict'
import { mkdir, readFile as readFile2, writeFile as writeFile2 } from 'node:fs/promises'
import { join as join3, resolve } from 'node:path'
import { app, BrowserWindow } from 'electron'

// src/codec/apng.ts
import { deflateSync } from 'node:zlib'

// src/codec/png.ts
var CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let value = n
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) !== 0 ? 3988292384 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[n] = value >>> 0
}
function crc32(buf) {
  let crc = 4294967295
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 4294967295) >>> 0
}
function writeU32(target, offset, value) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value)
}
function chunk(type, data) {
  if (!/^[\x20-\x7e]{4}$/.test(type))
    throw new Error(
      `PNG chunk \u985E\u578B\u5FC5\u9808\u662F 4 \u500B ASCII \u5B57\u5143\uFF1A${type}`,
    )
  const output = new Uint8Array(12 + data.length)
  writeU32(output, 0, data.length)
  for (let i = 0; i < 4; i++) output[4 + i] = type.charCodeAt(i)
  output.set(data, 8)
  writeU32(output, 8 + data.length, crc32(output.subarray(4, 8 + data.length)))
  return output
}
function filterScanlines(rgba, w, h) {
  const rowBytes = w * 4
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w <= 0 ||
    h <= 0 ||
    rgba.length !== rowBytes * h
  ) {
    throw new Error(
      `RGBA \u8CC7\u6599\u9577\u5EA6 ${rgba.length} \u8207\u5C3A\u5BF8 ${w}\xD7${h} \u4E0D\u7B26`,
    )
  }
  const output = new Uint8Array((rowBytes + 1) * h)
  for (let y = 0; y < h; y++) {
    const inputOffset = y * rowBytes
    const outputOffset = y * (rowBytes + 1)
    output[outputOffset] = 1
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= 4 ? rgba[inputOffset + x - 4] : 0
      output[outputOffset + x + 1] = (rgba[inputOffset + x] - left) & 255
    }
  }
  return output
}

// src/codec/apng.ts
var PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
function equalRgba(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 64) if (a[i] !== b[i]) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
function validateFrame(frame, index) {
  if (
    !Number.isFinite(frame.delayMs) ||
    !Number.isInteger(frame.delayMs) ||
    frame.delayMs < 0 ||
    frame.delayMs > 65535
  ) {
    throw new Error(
      `\u7B2C ${index + 1} \u5E40\u5EF6\u9072\u5FC5\u9808\u662F 0\u201365535 \u7684\u6574\u6578\u6BEB\u79D2`,
    )
  }
}
function planApng(frames, opts) {
  if (frames.length === 0) throw new Error('APNG \u81F3\u5C11\u9700\u8981\u4E00\u5E40')
  frames.forEach(validateFrame)
  const planned = []
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const previous = i > 0 ? frames[i - 1] : void 0
    if (opts.mergeIdentical && previous && equalRgba(previous.rgba, frame.rgba)) {
      const target = planned[planned.length - 1]
      target.sourceIndices.push(i)
      target.delayMs += frame.delayMs
      if (target.delayMs > 65535)
        throw new Error(
          '\u5408\u4F75\u5F8C\u7684\u55AE\u5E40\u5EF6\u9072\u8D85\u904E APNG \u53EF\u8868\u793A\u7684 65535 \u6BEB\u79D2',
        )
    } else {
      planned.push({ sourceIndices: [i], delayMs: frame.delayMs })
    }
  }
  const allIdentical = frames.every((frame) => equalRgba(frames[0].rgba, frame.rgba))
  return {
    frames: planned,
    timelineFrameCount: frames.length,
    actualFrameCount: planned.length,
    totalDurationMs: frames.reduce((sum, frame) => sum + frame.delayMs, 0),
    allIdentical,
    firstFrameRgba: frames[0].rgba,
  }
}
function u32(...values) {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setUint32(index * 4, value))
  return bytes
}
function frameControl(sequence, width, height, delayMs) {
  const data = new Uint8Array(26)
  const view = new DataView(data.buffer)
  view.setUint32(0, sequence)
  view.setUint32(4, width)
  view.setUint32(8, height)
  view.setUint32(12, 0)
  view.setUint32(16, 0)
  view.setUint16(20, delayMs)
  view.setUint16(22, 1e3)
  data[24] = 0
  data[25] = 0
  return data
}
function concat(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
function encodeApng(frames, width, height, opts) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('APNG \u5C3A\u5BF8\u5FC5\u9808\u662F\u6B63\u6574\u6578')
  if (!Number.isInteger(opts.numPlays) || opts.numPlays < 0 || opts.numPlays > 4294967295)
    throw new Error('\u64AD\u653E\u6B21\u6578\u5FC5\u9808\u662F\u975E\u8CA0\u6574\u6578')
  const expectedLength = width * height * 4
  frames.forEach((frame, index) => {
    if (frame.rgba.length !== expectedLength)
      throw new Error(`\u7B2C ${index + 1} \u5E40 RGBA \u9577\u5EA6\u8207\u5C3A\u5BF8\u4E0D\u7B26`)
  })
  const plan = planApng(frames, opts)
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('acTL', u32(plan.actualFrameCount, opts.numPlays)),
  ]
  let sequence = 0
  plan.frames.forEach((planned, index) => {
    parts.push(chunk('fcTL', frameControl(sequence++, width, height, planned.delayMs)))
    const rgba = frames[planned.sourceIndices[0]].rgba
    const compressed = new Uint8Array(
      deflateSync(filterScanlines(rgba, width, height), { level: 9 }),
    )
    parts.push(
      index === 0
        ? chunk('IDAT', compressed)
        : chunk('fdAT', concat([u32(sequence++), compressed])),
    )
  })
  parts.push(chunk('IEND', new Uint8Array()))
  const bytes = concat(parts)
  const info = verifyApng(bytes)
  if (
    info.numFrames !== plan.actualFrameCount ||
    info.numPlays !== opts.numPlays ||
    info.delaysMs.length !== plan.frames.length ||
    info.delaysMs.some((delay, i) => delay !== plan.frames[i].delayMs)
  ) {
    throw new Error(
      'APNG \u81EA\u6211\u9A57\u8B49\u5931\u6557\uFF1A\u5E40\u6578\u3001\u64AD\u653E\u6B21\u6578\u6216\u5EF6\u9072\u8207\u7DE8\u78BC\u8A08\u756B\u4E0D\u7B26',
    )
  }
  return bytes
}
function verifyApng(bytes) {
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, i) => bytes[i] === byte))
    throw new Error('\u4E0D\u662F\u6709\u6548\u7684 PNG \u6A94\u6848')
  let offset = 8
  let width
  let height
  let numFrames
  let numPlays
  const delaysMs = []
  let ended = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('PNG chunk \u6A19\u982D\u4E0D\u5B8C\u6574')
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
    const length = view.getUint32(0)
    if (offset + 12 + length > bytes.length)
      throw new Error('PNG chunk \u8CC7\u6599\u4E0D\u5B8C\u6574')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const dataOffset = offset + 8
    const data = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, length)
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('IHDR \u9577\u5EA6\u932F\u8AA4')
      width = data.getUint32(0)
      height = data.getUint32(4)
    } else if (type === 'acTL') {
      if (length !== 8) throw new Error('acTL \u9577\u5EA6\u932F\u8AA4')
      numFrames = data.getUint32(0)
      numPlays = data.getUint32(4)
    } else if (type === 'fcTL') {
      if (length !== 26) throw new Error('fcTL \u9577\u5EA6\u932F\u8AA4')
      const numerator = data.getUint16(20)
      const denominator = data.getUint16(22) || 100
      delaysMs.push((numerator * 1e3) / denominator)
    } else if (type === 'IEND') {
      ended = true
      offset += 12 + length
      break
    }
    offset += 12 + length
  }
  if (!ended || offset !== bytes.length) throw new Error('PNG \u7F3A\u5C11\u6709\u6548\u7684 IEND')
  if (width === void 0 || height === void 0 || numFrames === void 0 || numPlays === void 0)
    throw new Error('\u7F3A\u5C11 APNG \u5FC5\u8981 chunk')
  if (delaysMs.length !== numFrames)
    throw new Error(
      `acTL \u5BA3\u544A ${numFrames} \u5E40\uFF0C\u4F46\u627E\u5230 ${delaysMs.length} \u500B fcTL`,
    )
  return { width, height, numFrames, numPlays, delaysMs, byteLength: bytes.length }
}

// src/codec/gif.ts
var import_gifenc = __toESM(require_gifenc(), 1)
var { GIFEncoder, applyPalette, quantize } = import_gifenc.default
function encodeGif(frames, width, height, opts) {
  if (frames.length === 0) throw new Error('GIF \u81F3\u5C11\u9700\u8981\u4E00\u5E40')
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('GIF \u5C3A\u5BF8\u5FC5\u9808\u662F\u6B63\u6574\u6578')
  if (!Number.isInteger(opts.maxColors) || opts.maxColors < 2 || opts.maxColors > 256)
    throw new Error('GIF \u8272\u5F69\u6578\u5FC5\u9808\u4ECB\u65BC 2\u2013256')
  if (!Number.isInteger(opts.numPlays) || opts.numPlays < 0)
    throw new Error('\u64AD\u653E\u6B21\u6578\u5FC5\u9808\u662F\u975E\u8CA0\u6574\u6578')
  const pixelLength = width * height * 4
  const gif = GIFEncoder()
  const actualDelaysMs = frames.map((frame) => Math.round(frame.delayMs / 10) * 10)
  const warnings = []
  if (frames.some((frame, i) => frame.delayMs !== actualDelaysMs[i])) {
    warnings.push(
      'GIF \u5EF6\u9072\u7CBE\u5EA6\u70BA 10 \u6BEB\u79D2\uFF0C\u90E8\u5206\u5F71\u683C\u6642\u9593\u5DF2\u56DB\u6368\u4E94\u5165',
    )
  }
  frames.forEach((frame, frameIndex) => {
    if (frame.rgba.length !== pixelLength)
      throw new Error(
        `\u7B2C ${frameIndex + 1} \u5E40 RGBA \u9577\u5EA6\u8207\u5C3A\u5BF8\u4E0D\u7B26`,
      )
    const rgba = new Uint8Array(frame.rgba)
    let hasTransparency = false
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) {
        rgba[i] = 0
        rgba[i + 1] = 0
        rgba[i + 2] = 0
        rgba[i + 3] = 0
        hasTransparency = true
      } else {
        rgba[i + 3] = 255
      }
    }
    const palette = quantize(rgba, opts.maxColors, { format: 'rgba4444', oneBitAlpha: 127 })
    const indexed = applyPalette(rgba, palette, 'rgba4444')
    const transparentIndex = hasTransparency ? palette.findIndex((color) => color[3] === 0) : -1
    const repeat = opts.numPlays === 0 ? 0 : opts.numPlays - 1
    gif.writeFrame(indexed, width, height, {
      palette,
      delay: actualDelaysMs[frameIndex],
      repeat,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
    })
  })
  gif.finish()
  return { bytes: gif.bytes(), actualDelaysMs, warnings }
}

// src/main/ipc.ts
import { dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join as join2 } from 'node:path'

// src/clip/index.ts
import { Buffer as Buffer3 } from 'node:buffer'

// src/clip/chunks.ts
function safeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${label} \u8D85\u51FA\u53EF\u8655\u7406\u7BC4\u570D`)
  return Number(value)
}
function readChunks(data) {
  if (data.length < 24 || data.subarray(0, 8).toString('ascii') !== 'CSFCHUNK') {
    throw new Error(
      '\u4E0D\u662F\u6709\u6548\u7684 CLIP \u6A94\u6848\uFF1A\u7F3A\u5C11 CSFCHUNK \u6A94\u982D',
    )
  }
  let offset = 24
  let sqlite
  const external = /* @__PURE__ */ new Map()
  while (offset < data.length) {
    if (
      offset + 16 > data.length ||
      data.subarray(offset, offset + 4).toString('ascii') !== 'CHNK'
    ) {
      throw new Error(`CLIP chunk \u683C\u5F0F\u932F\u8AA4\uFF0C\u4F4D\u79FB ${offset}`)
    }
    const name = data.subarray(offset + 4, offset + 8).toString('ascii')
    const size = safeNumber(data.readBigUInt64BE(offset + 8), `${name} chunk \u9577\u5EA6`)
    const start = offset + 16
    const end = start + size
    if (end > data.length) throw new Error(`${name} chunk \u8D85\u51FA\u6A94\u6848\u7BC4\u570D`)
    const payload = data.subarray(start, end)
    if (name === 'SQLi') sqlite = payload
    if (name === 'Exta') {
      if (payload.length < 16) throw new Error('Exta chunk \u904E\u77ED')
      const idLength = safeNumber(payload.readBigUInt64BE(0), 'Exta id \u9577\u5EA6')
      if (8 + idLength + 8 > payload.length)
        throw new Error('Exta chunk id \u8D85\u51FA\u7BC4\u570D')
      const id = payload.subarray(8, 8 + idLength).toString('ascii')
      const bodyLength = safeNumber(
        payload.readBigUInt64BE(8 + idLength),
        'Exta \u8CC7\u6599\u9577\u5EA6',
      )
      const bodyStart = 16 + idLength
      if (bodyStart + bodyLength > payload.length)
        throw new Error(`Exta ${id} \u8CC7\u6599\u8D85\u51FA\u7BC4\u570D`)
      external.set(id, payload.subarray(bodyStart, bodyStart + bodyLength))
    }
    offset = end
  }
  if (!sqlite) throw new Error('CLIP \u6A94\u6848\u7F3A\u5C11 SQLi chunk')
  return { sqlite, external }
}

// src/clip/db.ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
async function openClipDatabase(sqlite) {
  const candidates = [
    join(import.meta.dirname, 'sql-wasm.wasm'),
    join(import.meta.dirname, '../out/main/sql-wasm.wasm'),
    join(import.meta.dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
  ]
  const wasmPath = candidates.find(existsSync)
  if (!wasmPath) throw new Error('\u627E\u4E0D\u5230 sql.js \u7684 sql-wasm.wasm')
  const SQL = await initSqlJs({ wasmBinary: readFileSync(wasmPath) })
  return new SQL.Database(sqlite)
}
function queryRows(db, sql) {
  const result = db.exec(sql)[0]
  if (!result) return []
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
  )
}

// src/clip/offscreen.ts
import { Buffer as Buffer2 } from 'node:buffer'
import { inflateSync } from 'node:zlib'
var Reader = class {
  constructor(data) {
    this.data = data
  }
  offset = 0
  u32() {
    if (this.offset + 4 > this.data.length)
      throw new Error('Offscreen Attribute \u8CC7\u6599\u4E0D\u5B8C\u6574')
    const value = this.data.readUInt32BE(this.offset)
    this.offset += 4
    return value
  }
  string() {
    const length = this.u32()
    const bytes = length * 2
    if (this.offset + bytes > this.data.length)
      throw new Error('Offscreen Attribute \u5B57\u4E32\u4E0D\u5B8C\u6574')
    const chars = []
    for (let index = 0; index < length; index += 1)
      chars.push(this.data.readUInt16BE(this.offset + index * 2))
    this.offset += bytes
    return String.fromCharCode(...chars)
  }
}
function parseAttribute(buf) {
  const reader = new Reader(buf)
  const headerSize = reader.u32()
  const infoSize = reader.u32()
  const extraSize = reader.u32()
  reader.u32()
  if (headerSize !== 16 || infoSize !== 102 || (extraSize !== 42 && extraSize !== 58)) {
    throw new Error(
      `\u4E0D\u652F\u63F4\u7684 Offscreen Attribute \u683C\u5F0F\uFF1A${headerSize}/${infoSize}/${extraSize}`,
    )
  }
  if (reader.string() !== 'Parameter') throw new Error('Offscreen Attribute \u7F3A\u5C11 Parameter')
  const bitmapWidth = reader.u32()
  const bitmapHeight = reader.u32()
  const blockGridWidth = reader.u32()
  const blockGridHeight = reader.u32()
  const attributes = Array.from({ length: 16 }, () => reader.u32())
  if (reader.string() !== 'InitColor') throw new Error('Offscreen Attribute \u7F3A\u5C11 InitColor')
  reader.u32()
  const defaultFillBlackWhite = reader.u32()
  reader.u32()
  reader.u32()
  reader.u32()
  const initColor = [0, 0, 0, 0]
  if (extraSize === 58) {
    for (let channel = 0; channel < 4; channel += 1) initColor[channel] = reader.u32() >>> 24
  }
  return {
    bitmapWidth,
    bitmapHeight,
    blockGridWidth,
    blockGridHeight,
    defaultFillBlackWhite,
    packing: [attributes[1], attributes[2]],
    initColor,
  }
}
var blockStatus = Buffer2.from('BlockStatus', 'utf16le').swap16()
var blockCheckSum = Buffer2.from('BlockCheckSum', 'utf16le').swap16()
var blockBegin = Buffer2.from('BlockDataBeginChunk', 'utf16le').swap16()
var blockEnd = Buffer2.from('BlockDataEndChunk', 'utf16le').swap16()
function parseBlockChunk(buf) {
  const blocks = []
  let offset = 0
  while (offset < buf.length) {
    let size
    if (
      buf.subarray(offset, offset + 4).equals(Buffer2.from([0, 0, 0, 11])) &&
      buf.subarray(offset + 4, offset + 4 + blockStatus.length).equals(blockStatus)
    ) {
      if (offset + 34 > buf.length)
        throw new Error(`BlockStatus \u4E0D\u5B8C\u6574\uFF0C\u4F4D\u79FB ${offset}`)
      const count = buf.readUInt32BE(offset + 30)
      size = count * 4 + 12 + 4 + blockStatus.length
    } else if (
      buf.subarray(offset, offset + 4).equals(Buffer2.from([0, 0, 0, 13])) &&
      buf.subarray(offset + 4, offset + 4 + blockCheckSum.length).equals(blockCheckSum)
    ) {
      size = 4 + blockCheckSum.length + 12 + blocks.length * 4
    } else if (buf.subarray(offset + 8, offset + 8 + blockBegin.length).equals(blockBegin)) {
      if (offset + 4 > buf.length)
        throw new Error(`BlockData \u9577\u5EA6\u4E0D\u5B8C\u6574\uFF0C\u4F4D\u79FB ${offset}`)
      size = buf.readUInt32BE(offset)
      if (size <= 0 || offset + size > buf.length)
        throw new Error(`BlockData \u9577\u5EA6\u7121\u6548\uFF0C\u4F4D\u79FB ${offset}`)
      const endMarker = Buffer2.concat([Buffer2.from([0, 0, 0, 17]), blockEnd])
      if (!buf.subarray(offset + size - endMarker.length, offset + size).equals(endMarker)) {
        throw new Error(
          `BlockData \u7D50\u5C3E\u6A19\u8A18\u932F\u8AA4\uFF0C\u4F4D\u79FB ${offset}`,
        )
      }
      const bodyStart = offset + 8 + blockBegin.length
      const bodyEnd = offset + size - endMarker.length
      const body = buf.subarray(bodyStart, bodyEnd)
      if (body.length < 20)
        throw new Error(`BlockData \u672C\u9AD4\u904E\u77ED\uFF0C\u4F4D\u79FB ${offset}`)
      const hasData = body.readUInt32BE(16)
      if (hasData === 0) blocks.push(null)
      else if (hasData === 1) {
        if (body.length < 28)
          throw new Error(
            `BlockData \u58D3\u7E2E\u6A19\u982D\u904E\u77ED\uFF0C\u4F4D\u79FB ${offset}`,
          )
        const subblockLength = body.readUInt32BE(20)
        if (body.length !== subblockLength + 24)
          throw new Error(
            `BlockData \u58D3\u7E2E\u9577\u5EA6\u4E0D\u7B26\uFF0C\u4F4D\u79FB ${offset}`,
          )
        blocks.push(body.subarray(28))
      } else throw new Error(`BlockData has_data \u7121\u6548\uFF1A${hasData}`)
    } else {
      throw new Error(
        `\u7121\u6CD5\u8FA8\u8B58 BlockData \u5B50\u5340\u584A\uFF0C\u4F4D\u79FB ${offset}\uFF0C\u8CC7\u6599 ${buf.subarray(offset, offset + 24).toString('hex')}`,
      )
    }
    if (offset + size > buf.length)
      throw new Error(
        `BlockData \u5B50\u5340\u584A\u8D85\u51FA\u7BC4\u570D\uFF0C\u4F4D\u79FB ${offset}`,
      )
    offset += size
  }
  return blocks
}
function decodeBitmap(attr, blocks) {
  const expectedBlocks = attr.blockGridWidth * attr.blockGridHeight
  if (blocks.length !== expectedBlocks)
    throw new Error(
      `\u78DA\u584A\u6578\u91CF\u4E0D\u7B26\uFF1A\u9810\u671F ${expectedBlocks}\uFF0C\u5BE6\u969B ${blocks.length}`,
    )
  const rgba = new Uint8ClampedArray(attr.bitmapWidth * attr.bitmapHeight * 4)
  if (attr.defaultFillBlackWhite) rgba.fill(255)
  const pixelsPerBlock = 256 * 256
  const color = attr.packing[0] === 1 && attr.packing[1] === 4
  const grayscale = attr.packing[0] + attr.packing[1] === 1
  if (!color && !grayscale)
    throw new Error(`\u4E0D\u652F\u63F4\u7684\u50CF\u7D20 packing\uFF1A${attr.packing.join(',')}`)
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const compressed = blocks[blockIndex]
    if (!compressed) continue
    let source
    try {
      source = inflateSync(compressed)
    } catch (error) {
      console.warn(
        `\u7121\u6CD5\u89E3\u58D3\u7B2C ${blockIndex} \u500B\u78DA\u584A\uFF0C\u5DF2\u8DF3\u904E`,
        error,
      )
      continue
    }
    const expectedLength = color ? pixelsPerBlock * 5 : pixelsPerBlock
    if (source.length !== expectedLength) {
      console.warn(
        `\u7B2C ${blockIndex} \u500B\u78DA\u584A\u9577\u5EA6\u4E0D\u7B26\uFF1A\u9810\u671F ${expectedLength}\uFF0C\u5BE6\u969B ${source.length}\uFF0C\u5DF2\u8DF3\u904E`,
      )
      continue
    }
    const blockX = (blockIndex % attr.blockGridWidth) * 256
    const blockY = Math.floor(blockIndex / attr.blockGridWidth) * 256
    const copyWidth = Math.min(256, attr.bitmapWidth - blockX)
    const copyHeight = Math.min(256, attr.bitmapHeight - blockY)
    for (let y = 0; y < copyHeight; y += 1) {
      for (let x = 0; x < copyWidth; x += 1) {
        const sourcePixel = y * 256 + x
        const destination = ((blockY + y) * attr.bitmapWidth + blockX + x) * 4
        if (color) {
          const bgrx = pixelsPerBlock + sourcePixel * 4
          rgba[destination] = source[bgrx + 2]
          rgba[destination + 1] = source[bgrx + 1]
          rgba[destination + 2] = source[bgrx]
          rgba[destination + 3] = source[sourcePixel]
        } else {
          const value = source[sourcePixel]
          rgba[destination] = value
          rgba[destination + 1] = value
          rgba[destination + 2] = value
          rgba[destination + 3] = 255
        }
      }
    }
  }
  return { width: attr.bitmapWidth, height: attr.bitmapHeight, data: rgba }
}

// src/clip/tree.ts
function numberValue(row, key) {
  const value = row[key]
  if (typeof value !== 'number') return 0
  return value
}
function buildTree(db) {
  const rows = queryRows(
    db,
    `SELECT MainId, LayerName, LayerType, LayerVisibility, LayerOpacity,
    LayerComposite, LayerFolder, LayerOffsetX, LayerOffsetY,
    LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY, LayerNextIndex,
    LayerFirstChildIndex, LayerRenderMipmap, AnimationFolder, LayerUuid FROM Layer`,
  )
  const links = /* @__PURE__ */ new Map()
  const flat = /* @__PURE__ */ new Map()
  for (const row of rows) {
    const id = numberValue(row, 'MainId')
    const layer = {
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
  if (!rootLink) throw new Error(`\u627E\u4E0D\u5230\u756B\u5E03\u6839\u5716\u5C64 ${rootId}`)
  const visited = /* @__PURE__ */ new Set()
  const attachChildren = (parent) => {
    let childId = parent.firstChild
    while (childId !== 0) {
      if (visited.has(childId))
        throw new Error(`\u5716\u5C64\u93C8\u7D50\u5F62\u6210\u5FAA\u74B0\uFF1A${childId}`)
      visited.add(childId)
      const child = links.get(childId)
      if (!child)
        throw new Error(
          `\u627E\u4E0D\u5230\u5716\u5C64\u93C8\u7D50\u6307\u5411\u7684\u5716\u5C64 ${childId}`,
        )
      parent.layer.children.push(child.layer)
      attachChildren(child)
      childId = child.next
    }
  }
  visited.add(rootId)
  attachChildren(rootLink)
  return { root: rootLink.layer, flat }
}

// src/clip/timeline.ts
import { inflateSync as inflateSync2 } from 'node:zlib'

// src/clip/binc.ts
var TYPES = [
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
]
function parseBinc(data) {
  let offset = 0
  const need = (count) => {
    if (offset + count > data.length) throw new Error(`Unexpected end of BINC at ${offset}`)
  }
  const u8 = () => {
    need(1)
    return data[offset++]
  }
  const u16 = () => {
    need(2)
    const v = data.readUInt16LE(offset)
    offset += 2
    return v
  }
  const i16 = () => {
    need(2)
    const v = data.readInt16LE(offset)
    offset += 2
    return v
  }
  const u322 = () => {
    need(4)
    const v = data.readUInt32LE(offset)
    offset += 4
    return v
  }
  const i32 = () => {
    need(4)
    const v = data.readInt32LE(offset)
    offset += 4
    return v
  }
  const f32 = () => {
    need(4)
    const v = data.readFloatLE(offset)
    offset += 4
    return v
  }
  const f64 = () => {
    need(8)
    const v = data.readDoubleLE(offset)
    offset += 8
    return v
  }
  const bytes = (count) => {
    need(count)
    const v = data.subarray(offset, offset + count)
    offset += count
    return v
  }
  if (bytes(12).toString('ascii') !== 'cmt 0100binc') throw new Error('Invalid BINC magic')
  bytes(4)
  const strings = Array.from({ length: u322() }, () => bytes(u8()).toString('utf8'))
  TYPES.forEach((type, index) => {
    if (strings[index] !== type) throw new Error(`Invalid BINC type ${index}`)
  })
  const stringAt = (index) => {
    const v = strings[index]
    if (v === void 0) throw new Error(`Invalid BINC string index ${index}`)
    return v
  }
  const vector = (count) => Array.from({ length: count }, f32)
  const readValue = (type) => {
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
        return u322()
      case 6:
        return i32()
      case 7:
        return f32()
      case 8:
        return f64()
      case 9:
        return stringAt(u322())
      case 10:
        return vector(2)
      case 11:
        return vector(3)
      case 12:
        return vector(4)
      case 13:
        return vector(16)
      case 14:
        return Array.from({ length: u322() }, f32)
      case 15:
        return [...bytes(u322())]
      case 16:
        return Array.from({ length: u322() }, i32)
      case 17:
        return Array.from({ length: u322() }, () => stringAt(u322()))
      case 18:
        return Array.from({ length: u322() }, () => vector(2))
      case 19:
        return Array.from({ length: u322() }, () => vector(3))
      case 20:
        return Array.from({ length: u322() }, () => vector(4))
      case 21:
        return Array.from({ length: u322() }, () => vector(16))
      default:
        throw new Error(`Unknown BINC type ${type}`)
    }
  }
  const readNode = () => {
    const name = stringAt(u322())
    const typeIndex = u322()
    const value = readValue(typeIndex)
    const attrs = {}
    for (let count = u322(); count > 0; count -= 1) attrs[stringAt(u322())] = stringAt(u322())
    const children = Array.from({ length: u322() }, readNode)
    return { name, type: TYPES[typeIndex] ?? String(typeIndex), value, attrs, children }
  }
  const root = readNode()
  if (offset !== data.length) throw new Error(`BINC has ${data.length - offset} unparsed bytes`)
  return root
}

// src/clip/timeline.ts
function numberValue2(row, key) {
  return typeof row[key] === 'number' ? row[key] : 0
}
function textValue(value) {
  if (typeof value === 'string') return value
  return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : ''
}
function find(node2, name) {
  if (node2.name === name) return node2
  for (const child of node2.children) {
    const result = find(child, name)
    if (result) return result
  }
  return void 0
}
function findCurve(node2) {
  if (node2.name === 'FCurve' && node2.attrs.Type === 'ImageCelName') return node2
  for (const child of node2.children) {
    const result = findCurve(child)
    if (result) return result
  }
  return void 0
}
function readCspTimelines(db, chunks) {
  const layers = /* @__PURE__ */ new Map()
  for (const row of queryRows(
    db,
    'SELECT MainId, LayerName, LayerUuid FROM Layer WHERE AnimationFolder = 1',
  )) {
    layers.set(textValue(row.LayerUuid).replaceAll('-', '').toLowerCase(), {
      id: numberValue2(row, 'MainId'),
      name: textValue(row.LayerName),
    })
  }
  const results = []
  for (const timeline of queryRows(
    db,
    'SELECT FrameRate, StartFrame, EndFrame, FirstTrack FROM TimeLine',
  )) {
    const frameRate = numberValue2(timeline, 'FrameRate')
    const frameCount = numberValue2(timeline, 'EndFrame') - numberValue2(timeline, 'StartFrame')
    let trackId = numberValue2(timeline, 'FirstTrack')
    const visited = /* @__PURE__ */ new Set()
    while (trackId !== 0) {
      if (visited.has(trackId))
        throw new Error(`Track \u93C8\u7D50\u5F62\u6210\u5FAA\u74B0\uFF1A${trackId}`)
      visited.add(trackId)
      const track = queryRows(
        db,
        `SELECT MainId, TrackKind, TrackActionMixer, TrackNextIndex, LayerUuidWithTrack FROM Track WHERE MainId = ${trackId}`,
      )[0]
      if (!track) throw new Error(`\u627E\u4E0D\u5230 Track ${trackId}`)
      trackId = numberValue2(track, 'TrackNextIndex')
      if (numberValue2(track, 'TrackKind') !== 2e3) continue
      const uuid =
        track.LayerUuidWithTrack instanceof Uint8Array
          ? Buffer.from(track.LayerUuidWithTrack).toString('hex')
          : ''
      const layer = layers.get(uuid)
      if (!layer) continue
      const externalId = textValue(track.TrackActionMixer)
      const packed = chunks.get(externalId)
      if (!packed)
        throw new Error(
          `\u627E\u4E0D\u5230\u6642\u9593\u8EF8\u5916\u90E8\u8CC7\u6599 ${externalId}`,
        )
      const compressedLength = packed.readUInt32LE(0)
      if (compressedLength !== packed.length - 4)
        throw new Error(
          `\u6642\u9593\u8EF8\u58D3\u7E2E\u9577\u5EA6\u4E0D\u7B26\uFF1A${compressedLength}/${packed.length - 4}`,
        )
      const root = parseBinc(inflateSync2(packed.subarray(4)))
      const warnings = []
      const rateNode = find(root, 'TimeInfo')?.children.find((child) => child.name === 'Rate')
      let curveRate = typeof rateNode?.value === 'number' ? rateNode.value : 0
      if (curveRate === 0) {
        curveRate = frameRate
        warnings.push(
          '\u627E\u4E0D\u5230\u6709\u6548\u7684 TimeInfo/Rate\uFF0C\u5DF2\u4F7F\u7528\u6587\u4EF6 FPS',
        )
      }
      const curve = findCurve(root)
      if (!curve) continue
      const frames = curve.children.find((child) => child.name === 'Frame')?.value
      const tags = curve.children.find((child) => child.name === 'Tag')?.value
      if (!Array.isArray(frames) || !Array.isArray(tags) || frames.length !== tags.length)
        throw new Error(
          'ImageCelName FCurve \u7684 Frame \u8207 Tag \u9663\u5217\u4E0D\u5B8C\u6574\u6216\u9577\u5EA6\u4E0D\u7B26',
        )
      results.push({
        animationFolderId: layer.id,
        animationFolderName: layer.name,
        frameRate,
        frameCount,
        keys: frames.map((frame, index) => ({
          frame: Math.round((Number(frame) * frameRate) / curveRate),
          celName: String(tags[index]),
        })),
        warnings,
      })
    }
  }
  return results
}

// src/clip/index.ts
function numeric(row, key) {
  const value = row[key]
  if (typeof value !== 'number')
    throw new Error(`\u8CC7\u6599\u5EAB\u6B04\u4F4D ${key} \u4E0D\u662F\u6578\u5B57`)
  return value
}
function compositeOver(target, source, opacity) {
  for (let index = 0; index < target.length; index += 4) {
    const sourceAlpha = (source[index + 3] / 255) * opacity
    if (sourceAlpha === 0) continue
    const targetAlpha = target[index + 3] / 255
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
    for (let channel = 0; channel < 3; channel += 1) {
      target[index + channel] = Math.round(
        (source[index + channel] * sourceAlpha +
          target[index + channel] * targetAlpha * (1 - sourceAlpha)) /
          outputAlpha,
      )
    }
    target[index + 3] = Math.round(outputAlpha * 255)
  }
}
function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}
function databaseMaps(db) {
  const mipmaps = /* @__PURE__ */ new Map()
  for (const row of queryRows(db, 'SELECT MainId, BaseMipmapInfo FROM Mipmap'))
    mipmaps.set(numeric(row, 'MainId'), numeric(row, 'BaseMipmapInfo'))
  const mipmapInfo = /* @__PURE__ */ new Map()
  for (const row of queryRows(db, 'SELECT MainId, Offscreen FROM MipmapInfo'))
    mipmapInfo.set(numeric(row, 'MainId'), numeric(row, 'Offscreen'))
  const offscreens = /* @__PURE__ */ new Map()
  for (const row of queryRows(db, 'SELECT MainId, BlockData, Attribute FROM Offscreen')) {
    const blockData =
      typeof row.BlockData === 'string'
        ? row.BlockData
        : row.BlockData instanceof Uint8Array
          ? Buffer3.from(row.BlockData).toString('utf8')
          : null
    if (blockData === null || !(row.Attribute instanceof Uint8Array)) continue
    offscreens.set(numeric(row, 'MainId'), { blockData, attribute: Buffer3.from(row.Attribute) })
  }
  return { mipmaps, mipmapInfo, offscreens }
}
async function parseClip(data) {
  const chunks = readChunks(data)
  const db = await openClipDatabase(chunks.sqlite)
  try {
    const canvasRow = queryRows(
      db,
      'SELECT CanvasWidth, CanvasHeight, CanvasResolution FROM Canvas',
    )[0]
    if (!canvasRow) throw new Error('Canvas \u8CC7\u6599\u8868\u6C92\u6709\u756B\u5E03\u8CC7\u6599')
    const canvas = {
      width: numeric(canvasRow, 'CanvasWidth'),
      height: numeric(canvasRow, 'CanvasHeight'),
      resolution: numeric(canvasRow, 'CanvasResolution'),
    }
    const { root, flat } = buildTree(db)
    const timelineRow = queryRows(
      db,
      'SELECT FrameRate, StartFrame, EndFrame, TimeLineName FROM TimeLine',
    )[0]
    const timeline = timelineRow
      ? {
          frameRate: numeric(timelineRow, 'FrameRate'),
          startFrame: numeric(timelineRow, 'StartFrame'),
          endFrame: numeric(timelineRow, 'EndFrame'),
          name: typeof timelineRow.TimeLineName === 'string' ? timelineRow.TimeLineName : '',
        }
      : null
    const maps = databaseMaps(db)
    const cspTimelines = readCspTimelines(db, chunks.external)
    const cache = /* @__PURE__ */ new Map()
    const rawCache = /* @__PURE__ */ new Map()
    const warned = /* @__PURE__ */ new Set()
    const renderRawBitmap = (layerId) => {
      const cached = rawCache.get(layerId)
      if (cached) return cached
      const layer = flat.get(layerId)
      if (!layer) throw new Error(`\u627E\u4E0D\u5230\u5716\u5C64 ${layerId}`)
      if (layer.isFolder || layer.renderMipmapId === 0) {
        throw new Error(
          `\u5716\u5C64\u300C${layer.name}\u300D\u6C92\u6709\u53EF\u89E3\u78BC\u7684\u539F\u59CB bitmap`,
        )
      }
      const mipmapInfoId = maps.mipmaps.get(layer.renderMipmapId)
      const offscreenId = mipmapInfoId === void 0 ? void 0 : maps.mipmapInfo.get(mipmapInfoId)
      const offscreen = offscreenId === void 0 ? void 0 : maps.offscreens.get(offscreenId)
      if (!offscreen)
        throw new Error(
          `\u5716\u5C64\u300C${layer.name}\u300D\u7684 Mipmap \u93C8\u7D50\u4E0D\u5B8C\u6574`,
        )
      const external = chunks.external.get(offscreen.blockData)
      if (!external)
        throw new Error(
          `\u627E\u4E0D\u5230\u5716\u5C64\u300C${layer.name}\u300D\u7684\u5916\u90E8\u8CC7\u6599 ${offscreen.blockData}`,
        )
      const bitmap = decodeBitmap(parseAttribute(offscreen.attribute), parseBlockChunk(external))
      rawCache.set(layerId, bitmap)
      return bitmap
    }
    const renderNode = (layerId, overrides) => {
      const cached = overrides ? void 0 : cache.get(layerId)
      if (cached) return cached
      const layer = flat.get(layerId)
      if (!layer) throw new Error(`\u627E\u4E0D\u5230\u5716\u5C64 ${layerId}`)
      if (overrides?.get(layerId) === false) return blank(canvas.width, canvas.height)
      if (layer.blendMode !== 0 && !warned.has(layer.id)) {
        console.warn(
          `\u5716\u5C64\u300C${layer.name}\u300D\u4F7F\u7528\u5C1A\u672A\u652F\u63F4\u7684\u6DF7\u5408\u6A21\u5F0F ${layer.blendMode}\uFF0C\u66AB\u4EE5 normal \u8655\u7406`,
        )
        warned.add(layer.id)
      }
      const result = blank(canvas.width, canvas.height)
      if (layer.isFolder) {
        for (const child of layer.children) {
          if (overrides?.get(child.id) ?? child.visible)
            compositeOver(result.data, renderNode(child.id, overrides).data, child.opacity)
        }
      } else if (layer.renderMipmapId !== 0) {
        const bitmap = renderRawBitmap(layerId)
        const offsetX = layer.offsetX + layer.renderOffsetX
        const offsetY = layer.offsetY + layer.renderOffsetY
        for (let y = 0; y < bitmap.height; y += 1) {
          const targetY = y + offsetY
          if (targetY < 0 || targetY >= canvas.height) continue
          for (let x = 0; x < bitmap.width; x += 1) {
            const targetX = x + offsetX
            if (targetX < 0 || targetX >= canvas.width) continue
            const source = (y * bitmap.width + x) * 4
            const target = (targetY * canvas.width + targetX) * 4
            result.data[target] = bitmap.data[source]
            result.data[target + 1] = bitmap.data[source + 1]
            result.data[target + 2] = bitmap.data[source + 2]
            result.data[target + 3] = bitmap.data[source + 3]
          }
        }
      }
      if (!overrides) cache.set(layerId, result)
      return result
    }
    return { canvas, root, flat, timeline, cspTimelines, renderRawBitmap, renderNode }
  } finally {
    db.close()
  }
}

// src/main/ipc.ts
var current = null
var currentPath = ''
var rendered = /* @__PURE__ */ new Map()
function timestampName(now = /* @__PURE__ */ new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}
function visibilityKey(layerId, overrides) {
  return `${layerId}|${overrides
    .slice()
    .sort(([a], [b]) => a - b)
    .map(([id, visible]) => `${id}:${visible ? 1 : 0}`)
    .join(',')}`
}
function node(layer) {
  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    isFolder: layer.isFolder,
    isAnimationFolder: layer.isAnimationFolder,
    visible: layer.visible,
    opacity: layer.opacity,
    children: layer.children.map(node),
  }
}
async function writeExport(filePath, payload) {
  try {
    if (payload.format === 'apng') {
      const bytes = encodeApng(payload.frames, payload.width, payload.height, {
        numPlays: payload.numPlays,
        mergeIdentical: payload.mergeIdentical,
      })
      const info = verifyApng(bytes)
      await writeFile(filePath, bytes)
      return { ok: true, filePath, info, warnings: [], byteLength: bytes.length }
    }
    const result = encodeGif(payload.frames, payload.width, payload.height, {
      numPlays: payload.numPlays,
      maxColors: payload.gif?.maxColors ?? 256,
    })
    await writeFile(filePath, result.bytes)
    return { ok: true, filePath, warnings: result.warnings, byteLength: result.bytes.length }
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
function registerIpc(getWindow) {
  ipcMain.handle('clip:open', async (_event, requested) => {
    let filePath = requested
    if (!filePath) {
      const picked = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Clip Studio Paint', extensions: ['clip'] }],
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      filePath = picked.filePaths[0]
    }
    const doc = await parseClip(await readFile(filePath))
    current = doc
    currentPath = filePath
    rendered.clear()
    return {
      filePath,
      canvas: doc.canvas,
      timeline: doc.timeline,
      tree: node(doc.root),
      cspTimelines: doc.cspTimelines,
    }
  })
  ipcMain.handle('clip:openBuffer', async (_event, bytes) => {
    const doc = await parseClip(Buffer.from(bytes))
    current = doc
    currentPath = ''
    rendered.clear()
    return {
      filePath: '\u62D6\u653E\u7684 .clip',
      canvas: doc.canvas,
      timeline: doc.timeline,
      tree: node(doc.root),
      cspTimelines: doc.cspTimelines,
    }
  })
  ipcMain.handle('clip:render', (_event, layerId, overrides) => {
    if (!current) throw new Error('\u8ACB\u5148\u958B\u555F .clip \u6A94\u6848')
    const key = visibilityKey(layerId, overrides)
    const cached = rendered.get(key)
    if (cached) return cached
    const bitmap = current.renderNode(layerId, new Map(overrides))
    const value = { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(bitmap.data) }
    rendered.set(key, value)
    return value
  })
  ipcMain.handle('export:save', async (_event, payload) => {
    try {
      const extension = payload.format === 'apng' ? 'png' : 'gif'
      const picked = await dialog.showSaveDialog(getWindow() ?? void 0, {
        defaultPath: currentPath
          ? join2(dirname(currentPath), `${timestampName()}.${extension}`)
          : `${timestampName()}.${extension}`,
        filters: [
          { name: payload.format === 'apng' ? 'Animated PNG' : 'GIF', extensions: [extension] },
        ],
      })
      if (picked.canceled || !picked.filePath)
        return { ok: false, warnings: [], error: '\u5DF2\u53D6\u6D88\u532F\u51FA' }
      return writeExport(picked.filePath, payload)
    } catch (error) {
      return {
        ok: false,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  ipcMain.handle('export:to', (_event, filePath, payload) => writeExport(filePath, payload))
}

// scripts/smoke.ts
var projectRoot = resolve(import.meta.dirname, '..')
var outputDir = join3(projectRoot, 'out', 'smoke')
var window = null
function gifFrameCount(bytes) {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a')
  let offset = 13
  if (bytes[10] & 128) offset += 3 * 2 ** ((bytes[10] & 7) + 1)
  let frames = 0
  const skipBlocks = () => {
    while (bytes[offset] !== 0) {
      offset += 1 + bytes[offset]
    }
    offset += 1
  }
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 59) break
    if (marker === 33) {
      offset += 1
      skipBlocks()
      continue
    }
    assert.equal(marker, 44, `\u672A\u77E5\u7684 GIF block 0x${marker?.toString(16)}`)
    frames += 1
    const packed = bytes[offset + 8]
    offset += 9
    if (packed & 128) offset += 3 * 2 ** ((packed & 7) + 1)
    offset += 1
    skipBlocks()
  }
  return frames
}
async function run() {
  await mkdir(outputDir, { recursive: true })
  registerIpc(() => window)
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join3(projectRoot, 'out', 'preload', 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  await window.loadFile(join3(projectRoot, 'out', 'renderer', 'index.html'), {
    query: { smoke: '1' },
  })
  const samplePath = join3(projectRoot, 'assets', 'samples', '11.clip')
  await window.webContents.executeJavaScript(`(async () => {
    const smoke = window.__smoke
    if (!smoke) throw new Error('\u627E\u4E0D\u5230 smoke \u6E2C\u8A66\u9264\u5B50')
    await smoke.openClip(${JSON.stringify(samplePath)})
    const cels = smoke.getAnimationCels()
    const positions = [0, 1, 2, 4, 6, 7]
    positions.forEach((slot, index) => smoke.store.getState().setSlot(slot, cels[index].id))
    smoke.store.getState().set({ playhead: 0, selectedSlot: 0, playCount: 2, format: 'apng' })
    await smoke.waitIdle()
  })()`)
  const assertVisibleThumbsLoaded = async () => {
    const pending = await window.webContents.executeJavaScript(`[
      ...document.querySelectorAll('.layer-row .thumb[data-thumb-loaded="false"]')
    ].filter((thumb) => { const row = thumb.closest('.layer-row'); const rect = row.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight }).map((thumb) => thumb.dataset.layerId)`)
    assert.deepEqual(
      pending,
      [],
      `\u53EF\u898B\u5716\u5C64\u7E2E\u5716\u5C1A\u672A\u8F09\u5165\uFF1A${pending.join(', ')}`,
    )
  }
  await assertVisibleThumbsLoaded()
  const slotThumbs = await window.webContents.executeJavaScript(
    `[...document.querySelectorAll('.slot canvas')].map((canvas) => {
      const box = canvas.getBoundingClientRect()
      const slot = canvas.closest('.slot').getBoundingClientRect()
      return { width: Math.round(box.width), height: Math.round(box.height), slotWidth: Math.round(slot.width), slotHeight: Math.round(slot.height), intrinsic: canvas.width }
    })`,
  )
  assert.ok(slotThumbs.length > 0, '\u5F71\u683C\u8ECC\u5FC5\u9808\u6709\u7E2E\u5716')
  for (const thumb of slotThumbs) {
    assert.ok(
      thumb.width <= thumb.slotWidth && thumb.height <= thumb.slotHeight,
      `\u5F71\u683C\u8ECC\u7E2E\u5716\u6EA2\u51FA\u683C\u5B50\uFF1A${thumb.width}\xD7${thumb.height} > ${thumb.slotWidth}\xD7${thumb.slotHeight}`,
    )
  }
  const mainPng = (await window.webContents.capturePage()).toPNG()
  await writeFile2(join3(outputDir, 'ui-main.png'), mainPng)
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const smoke = window.__smoke
    const state = smoke.store.getState()
    const cels = smoke.getAnimationCels()
    const canvas = document.querySelector('.stage canvas')
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const stats = [...document.querySelectorAll('.stats b')].map((node) => node.textContent)
    let opaquePixels = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaquePixels++
    return { celNames: cels.map((cel) => cel.name), celIds: cels.map((cel) => cel.id), slots: state.slots, inheritedId: state.resolveSlot(3), sourceId: state.slots[2].layerId, timelineFrameCount: Number(stats[0]), actualFrameCount: Number(stats[1]), opaquePixels }
  })()`)
  assert.deepEqual(snapshot.celNames, ['1', '1a', '1b', '2', '3', '4'])
  assert.equal(snapshot.slots.length, 8)
  assert.equal(snapshot.slots[3]?.layerId, null)
  assert.equal(snapshot.slots[5]?.layerId, null)
  assert.equal(snapshot.inheritedId, snapshot.sourceId)
  assert.equal(snapshot.actualFrameCount, 6)
  assert.equal(snapshot.timelineFrameCount, 8)
  assert.ok(snapshot.opaquePixels > 0, '\u9810\u89BD canvas \u4E0D\u53EF\u5168\u900F\u660E')
  const controls = await window.webContents.executeJavaScript(`(async () => {
    const store = window.__smoke.store
    const beforePlayCount = store.getState().playCount
    const originalSlots = store.getState().slots
    document.querySelector('.transport button[title="\u5FAA\u74B0\u9810\u89BD"]').click()
    const loop = store.getState().previewLoop
    store.getState().set({ selectedSlot: 7, playhead: 7 })
    await window.__smoke.waitIdle()
    document.querySelectorAll('.timeline-tools button')[1].click()
    const shrunk = store.getState()
    store.getState().set({ slots: originalSlots, selectedSlot: 0, playhead: 0, previewLoop: true })
    return { beforePlayCount, afterPlayCount: store.getState().playCount, loop, selectedSlot: shrunk.selectedSlot, playhead: shrunk.playhead }
  })()`)
  assert.equal(
    controls.afterPlayCount,
    controls.beforePlayCount,
    '\u9810\u89BD\u5FAA\u74B0\u4E0D\u53EF\u6539\u8B8A\u532F\u51FA\u64AD\u653E\u6B21\u6578',
  )
  assert.equal(controls.loop, false)
  assert.equal(controls.selectedSlot, 6)
  assert.equal(controls.playhead, 6)
  const visibilityChanged = await window.webContents.executeJavaScript(`(async () => {
    const before = [...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data]
    const id = window.__smoke.store.getState().resolveSlot(0)
    const node = [...document.querySelectorAll('.layer-row')].find((row) => row.querySelector('.thumb')?.dataset.layerId === String(id))
    node.querySelector('input[type=checkbox]').click()
    await window.__smoke.waitIdle()
    const after = [...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data]
    return before.some((value, index) => value !== after[index])
  })()`)
  assert.equal(
    visibilityChanged,
    true,
    '\u5207\u63DB\u5716\u5C64\u53EF\u898B\u6027\u5FC5\u9808\u6539\u8B8A\u9810\u89BD RGBA',
  )
  await writeFile2(
    join3(outputDir, 'ui-visibility.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  const sourcePixels = await window.webContents.executeJavaScript(
    `(async () => { window.__smoke.store.getState().set({ playhead: 2, selectedSlot: 2 }); await window.__smoke.waitIdle(); return [...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data] })()`,
  )
  await window.webContents.executeJavaScript(
    `(async () => { window.__smoke.store.getState().set({ playhead: 3, selectedSlot: 3 }); await window.__smoke.waitIdle() })()`,
  )
  const inheritedPixels = await window.webContents.executeJavaScript(
    `[...document.querySelector('.stage canvas').getContext('2d').getImageData(0, 0, 360, 360).data]`,
  )
  assert.deepEqual(
    inheritedPixels,
    sourcePixels,
    '\u7B2C 4 \u683C\u9810\u89BD\u5FC5\u9808\u8207\u5EF6\u7E8C\u4F86\u6E90\u7B2C 3 \u683C\u76F8\u540C',
  )
  const inheritPng = (await window.webContents.capturePage()).toPNG()
  assert.notDeepEqual(
    inheritPng,
    mainPng,
    'ui-inherit.png \u4E0D\u53EF\u8207 ui-main.png \u76F8\u540C',
  )
  await writeFile2(join3(outputDir, 'ui-inherit.png'), inheritPng)
  window.setSize(1024, 640)
  window.webContents.setZoomFactor(0.8)
  await window.webContents.executeJavaScript(`window.__smoke.waitIdle()`)
  await assertVisibleThumbsLoaded()
  const smallLayout = await window.webContents.executeJavaScript(
    `(() => { const button = document.querySelector('.export-button').getBoundingClientRect(); const names = [...document.querySelectorAll('.layer-name')].map((node) => node.textContent); return { button: { top: button.top, bottom: button.bottom }, viewportHeight: innerHeight, names } })()`,
  )
  assert.ok(
    smallLayout.button.top >= 0 && smallLayout.button.bottom <= smallLayout.viewportHeight,
    '1024\xD7640 \u6642\u532F\u51FA\u6309\u9215\u5FC5\u9808\u5B8C\u6574\u53EF\u898B',
  )
  assert.deepEqual(smallLayout.names.slice(0, 3), [
    '\u7D19\u5F35',
    '\u5716\u5C64 1',
    '\u8CC7\u6599\u593E 1',
  ])
  assert.ok(
    !smallLayout.names.includes('\u672A\u547D\u540D\u5716\u5C64'),
    '\u5716\u5C64\u6A39\u4E0D\u53EF\u6E32\u67D3\u672A\u547D\u540D\u7684\u6839\u7BC0\u9EDE',
  )
  await writeFile2(
    join3(outputDir, 'ui-small.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  const exportPath = join3(outputDir, 'export.png')
  const result = await window.webContents.executeJavaScript(
    `window.__smoke.exportTo(${JSON.stringify(exportPath)})`,
  )
  assert.equal(result.ok, true, result.error)
  const info = verifyApng(new Uint8Array(await readFile2(exportPath)))
  assert.equal(info.numFrames, 6)
  assert.equal(info.numPlays, 2)
  assert.equal(info.delaysMs.length, 6)
  const gifPath = join3(outputDir, 'export.gif')
  const gifResult = await window.webContents.executeJavaScript(
    `(async () => { window.__smoke.store.getState().set({ format: 'gif' }); return window.__smoke.exportTo(${JSON.stringify(gifPath)}) })()`,
  )
  assert.equal(gifResult.ok, true, gifResult.error)
  const gifUi = await window.webContents.executeJavaScript(`({
    frameLabel: [...document.querySelectorAll('.stats span')].map((node) => node.textContent).find((text) => text.includes('GIF')),
    lineWarning: [...document.querySelectorAll('.issues .warning')].some((node) => node.textContent.includes('\u53EA\u63A5\u53D7 APNG')),
    hasDither: document.body.textContent.includes('\u6296\u8272')
  })`)
  assert.match(gifUi.frameLabel, /實際 GIF 幀數/)
  assert.equal(gifUi.lineWarning, true)
  assert.equal(gifUi.hasDither, false)
  const gif = new Uint8Array(await readFile2(gifPath))
  assert.ok(gif.length > 0)
  assert.equal(gifFrameCount(gif), 6)
  const warningProbe = encodeGif([{ rgba: new Uint8Array(4), delayMs: 1e3 / 24 }], 1, 1, {
    numPlays: 1,
    maxColors: 2,
  })
  assert.ok(warningProbe.warnings.some((warning) => warning.includes('\u5EF6\u9072\u7CBE\u5EA6')))
  const lineCheck = await window.webContents.executeJavaScript(`(async () => {
    window.__smoke.store.getState().set({ format: 'apng' })
    await window.__smoke.waitIdle()
    const started = performance.now()
    document.querySelectorAll('.quick button')[1].click()
    await window.__smoke.waitIdle()
    const resizeMs = performance.now() - started
    const first = window.__smoke.store.getState()
    const warning = [...document.querySelectorAll('.issues .warning')].some((node) => node.textContent.includes('0.4 \u79D2'))
    const cels = window.__smoke.getAnimationCels()
    window.__smoke.store.getState().set({ slots: cels.map((cel) => ({ layerId: cel.id })), fps: 6, playCount: 4, format: 'apng' })
    await window.__smoke.waitIdle()
    const state = window.__smoke.store.getState()
    return { width: state.exportWidth, height: state.exportHeight, resizeMs, warning, errors: document.querySelectorAll('.issues .error').length, pass: document.querySelector('.issues .pass')?.textContent ?? '' }
  })()`)
  assert.ok(lineCheck.width === 320 || lineCheck.height === 270)
  assert.ok(lineCheck.width <= 320 && lineCheck.height <= 270)
  assert.ok(
    lineCheck.resizeMs < 500,
    `\u8ABF\u6574\u8F38\u51FA\u5C3A\u5BF8\u8017\u6642 ${lineCheck.resizeMs}ms\uFF0C\u61C9\u4F4E\u65BC 500ms`,
  )
  assert.equal(lineCheck.warning, true)
  assert.equal(lineCheck.errors, 0)
  assert.match(lineCheck.pass, /符合 LINE 動態貼圖規格/)
  const lineFooter = await window.webContents.executeJavaScript(
    `(() => { const issues = document.querySelector('.export-footer .issues').getBoundingClientRect(); const button = document.querySelector('.export-button').getBoundingClientRect(); return { issues: { top: issues.top, bottom: issues.bottom }, button: { top: button.top, bottom: button.bottom }, height: innerHeight } })()`,
  )
  assert.ok(
    lineFooter.issues.top >= 0 && lineFooter.issues.bottom <= lineFooter.height,
    'LINE \u6AA2\u67E5\u7D50\u679C\u5FC5\u9808\u5B8C\u6574\u53EF\u898B',
  )
  assert.ok(
    lineFooter.button.top >= 0 && lineFooter.button.bottom <= lineFooter.height,
    '\u532F\u51FA\u6309\u9215\u5FC5\u9808\u5B8C\u6574\u53EF\u898B',
  )
  await writeFile2(
    join3(outputDir, 'ui-line-ok.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  const lineFail = await window.webContents.executeJavaScript(`(async () => {
    window.__smoke.store.getState().set({ exportWidth: 360, exportHeight: 360, playCount: 0 })
    await window.__smoke.waitIdle()
    return { errors: [...document.querySelectorAll('.export-footer .issues .error')].map((node) => node.textContent), buttonVisible: document.querySelector('.export-button').getBoundingClientRect().bottom <= innerHeight }
  })()`)
  assert.ok(
    lineFail.errors.length >= 2,
    'LINE \u4E0D\u5408\u898F\u60C5\u5883\u5FC5\u9808\u5217\u51FA\u932F\u8AA4',
  )
  assert.ok(
    lineFail.buttonVisible,
    'LINE \u4E0D\u5408\u898F\u6642\u532F\u51FA\u6309\u9215\u4ECD\u9808\u53EF\u898B',
  )
  await new Promise((resolve2) => setTimeout(resolve2, 100))
  await writeFile2(
    join3(outputDir, 'ui-line-fail.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  await window.webContents.executeJavaScript(`(() => {
    const smoke = window.__smoke
    smoke.store.getState().set({ slots: Array.from({ length: 8 }, () => ({ layerId: null })), playCount: 4, format: 'apng' })
    window.confirm = () => true
    document.querySelectorAll('.timeline-tools button')[2].click()
  })()`)
  await new Promise((resolve2) => setTimeout(resolve2, 100))
  await window.webContents.executeJavaScript(
    `document.querySelectorAll('.quick button')[1].click()`,
  )
  await new Promise((resolve2) => setTimeout(resolve2, 100))
  const importedTimeline = await window.webContents.executeJavaScript(`(() => {
    const smoke = window.__smoke
    const state = smoke.store.getState()
    const cels = smoke.getAnimationCels()
    const stats = [...document.querySelectorAll('.stats b')].map((node) => node.textContent)
    return {
      slots: state.slots,
      fps: state.fps,
      cel1: cels.find((cel) => cel.name === '1').id,
      cel1a: cels.find((cel) => cel.name === '1a').id,
      stats,
      errors: document.querySelectorAll('.issues .error').length,
    }
  })()`)
  assert.equal(importedTimeline.slots.length, 20)
  assert.equal(importedTimeline.fps, 20)
  assert.equal(importedTimeline.slots[0].layerId, importedTimeline.cel1)
  assert.equal(importedTimeline.slots[1].layerId, null)
  assert.equal(importedTimeline.slots[2].layerId, importedTimeline.cel1a)
  assert.equal(Number(importedTimeline.stats[0]), 20)
  assert.ok(importedTimeline.stats.some((value) => value.includes('1.00')))
  assert.equal(importedTimeline.errors, 0)
  await writeFile2(
    join3(outputDir, 'ui-timeline.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  const timelineExportPath = join3(outputDir, 'export-timeline.png')
  const timelineResult = await window.webContents.executeJavaScript(
    `window.__smoke.exportTo(${JSON.stringify(timelineExportPath)})`,
  )
  assert.equal(timelineResult.ok, true, timelineResult.error)
  const timelineInfo = verifyApng(new Uint8Array(await readFile2(timelineExportPath)))
  assert.equal(timelineInfo.numPlays, 4)
  assert.equal(timelineInfo.numFrames, Number(importedTimeline.stats[1]))
  const sampleBase64 = (await readFile2(samplePath)).toString('base64')
  const dropped = await window.webContents.executeJavaScript(`(async () => {
    const binary = atob(${JSON.stringify(sampleBase64)})
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const summary = await window.api.openClipBuffer(bytes)
    const animation = summary.tree.children.find((child) => child.isAnimationFolder)
    return {
      width: summary.canvas.width,
      height: summary.canvas.height,
      frameRate: summary.timeline ? summary.timeline.frameRate : null,
      celNames: animation ? animation.children.map((child) => child.name) : [],
    }
  })()`)
  assert.equal(
    dropped.width,
    360,
    '\u62D6\u653E\u89E3\u6790\u7684\u756B\u5E03\u5BEC\u5EA6\u5FC5\u9808\u8207\u6A94\u6848\u8DEF\u5F91\u89E3\u6790\u4E00\u81F4',
  )
  assert.equal(
    dropped.height,
    360,
    '\u62D6\u653E\u89E3\u6790\u7684\u756B\u5E03\u9AD8\u5EA6\u5FC5\u9808\u8207\u6A94\u6848\u8DEF\u5F91\u89E3\u6790\u4E00\u81F4',
  )
  assert.equal(
    dropped.frameRate,
    20,
    '\u62D6\u653E\u89E3\u6790\u7684\u6642\u9593\u8EF8\u5FC5\u9808\u8207\u6A94\u6848\u8DEF\u5F91\u89E3\u6790\u4E00\u81F4',
  )
  assert.deepEqual(
    dropped.celNames,
    snapshot.celNames,
    '\u62D6\u653E\u89E3\u6790\u7684\u5716\u5C64\u6A39\u5FC5\u9808\u8207\u6A94\u6848\u8DEF\u5F91\u89E3\u6790\u4E00\u81F4',
  )
  console.table({
    cels: snapshot.celNames.join(', '),
    dropCels: dropped.celNames.join(', '),
    timelineFrames: snapshot.timelineFrameCount,
    apngFrames: info.numFrames,
    gifFrames: gifFrameCount(gif),
    plays: info.numPlays,
    opaquePixels: snapshot.opaquePixels,
  })
  console.log(`Smoke \u901A\u904E\uFF1A${outputDir}`)
}
app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
app.on('before-quit', () => {
  if (window && !window.isDestroyed()) window.destroy()
  window = null
})
