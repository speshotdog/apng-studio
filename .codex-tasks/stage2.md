# Stage 2 — 匯出編碼器（APNG / GIF / LINE 驗證）

## 先讀

`AGENTS.md` §4 §6 §7。工作目錄 `D:\claude研究\apng-studio`。

Stage 1 已完成 `src/clip/`。本階段只碰 `src/codec/`，**不要改 `src/clip/`**。

---

## 重要決策：APNG 自己組，不用 upng-js 的 encode

`upng-js` 的 `encode()` 不讓我們控制 `acTL.num_plays`（播放次數），而播放次數正是委託人
的核心需求（LINE 限 1–4 次）。而且它的 frame diff 最佳化可能產生跟 LINE 驗證器不一致的
幀數。

→ **自己寫 APNG 組裝器。** 只保留 `upng-js` 當作可選的減色量化器（`UPNG.quantize`）。

---

## 1. `src/codec/png.ts` — 底層 PNG 位元組工具

```ts
export function crc32(buf: Uint8Array): number
export function chunk(type: string, data: Uint8Array): Uint8Array   // len + type + data + crc
export function filterScanlines(rgba: Uint8Array, w: number, h: number): Uint8Array
```

`filterScanlines`：每列前面加 filter byte。Phase 1 用 **filter 1 (Sub)** 對每一列，
或直接全部 filter 0；兩種都試，選壓縮後比較小的（逐列各自選，這是標準做法，成本很低）。
輸出後交給 `zlib.deflateSync(data, { level: 9 })`。

---

## 2. `src/codec/apng.ts`

```ts
export interface ApngFrame {
  rgba: Uint8Array;   // w*h*4
  delayMs: number;
}

export interface ApngOptions {
  numPlays: number;        // 0 = 無限循環
  mergeIdentical: boolean; // true = 連續相同影格合併成一幀、延遲相加
}

export interface ApngPlan {
  /** 合併後實際會寫進檔案的幀 */
  frames: { sourceIndices: number[]; delayMs: number }[];
  timelineFrameCount: number;
  actualFrameCount: number;
  totalDurationMs: number;
  allIdentical: boolean;
}

/** 只算不編碼，給 UI 即時顯示「實際 APNG 幀數」用 */
export function planApng(frames: ApngFrame[], opts: ApngOptions): ApngPlan

export function encodeApng(
  frames: ApngFrame[], width: number, height: number, opts: ApngOptions
): Uint8Array

export interface ApngInfo {
  width: number; height: number;
  numFrames: number; numPlays: number;
  delaysMs: number[];
  byteLength: number;
}
/** 重新解析產生出來的位元組，用來自我驗證 */
export function verifyApng(bytes: Uint8Array): ApngInfo
```

### 檔案結構（全幀寫入，不做 rect 最佳化）

```
PNG signature (89 50 4E 47 0D 0A 1A 0A)
IHDR   w, h, bitDepth=8, colorType=6 (RGBA), compression=0, filter=0, interlace=0
acTL   num_frames (= 合併後的幀數), num_plays
fcTL   sequence_number=0, width=w, height=h, x=0, y=0,
       delay_num=delayMs, delay_den=1000,
       dispose_op=0 (NONE), blend_op=0 (SOURCE)
IDAT   第 0 幀的壓縮資料
對第 1..n-1 幀：
  fcTL sequence_number=seq++, 同上參數、各自的 delay
  fdAT sequence_number=seq++, 該幀壓縮資料
IEND
```

- `delay_den` 固定 1000，`delay_num` 直接放毫秒 → 精度完全可控，這點很重要。
- `dispose_op=0 / blend_op=0`（每幀完整覆蓋）→ 不會有殘影，也不會被誤判成可合併。
- `sequence_number` 必須連續遞增，fcTL 與 fdAT 共用同一個計數器。

### 相同影格判定

`mergeIdentical === true` 時，逐 byte 比較相鄰兩幀的 rgba。相同就合併，延遲相加。
用長度 + 每 64 bytes 抽樣先快篩，再做完整比對（避免 20 幀全比太慢）。

### `verifyApng`

實際掃過產生的位元組，讀 `IHDR`、`acTL.num_frames`、`acTL.num_plays`、每個 `fcTL` 的
`delay_num/delay_den`（換算成毫秒）。**`encodeApng` 內部最後一定要呼叫它自我核對**，
`numFrames` 或 `delaysMs` 跟 plan 不符就 `throw new Error(...)`，不要回傳壞檔案。

---

## 3. `src/codec/gif.ts`

```ts
export interface GifOptions { numPlays: number; maxColors: number; dither: boolean }
export function encodeGif(
  frames: ApngFrame[], width: number, height: number, opts: GifOptions
): Uint8Array
```

用 `gifenc`：`GIFEncoder()` + `quantize()` + `applyPalette()`。
- 透明度：GIF 只有 1-bit alpha。alpha < 128 的像素視為透明，指派給調色盤中的透明索引
  （`transparentIndex`），其餘像素 alpha 強制設 255 後再量化。
- `numPlays`：`GIFEncoder` 的 `repeat` 參數（0 = 無限，n = 重複 n 次）。
  注意 GIF 的 Netscape loop count 語意跟 APNG 不同，`repeat: n` 表示「額外再放 n 次」，
  要在註解裡寫清楚換算：`repeat = numPlays === 0 ? 0 : numPlays - 1`。
- `delay` 單位是毫秒，但 GIF 內部精度是 1/100 秒 → 換算時 `Math.round(delayMs / 10)`，
  且回傳一個 `warnings: string[]` 說明實際秒數會有誤差（把 encodeGif 回傳改成
  `{ bytes, actualDelaysMs, warnings }`）。

---

## 4. `src/codec/line.ts`

```ts
export const LINE_SPEC = {
  maxWidth: 320, maxHeight: 270, minLongSide: 270,
  mainImage: { width: 240, height: 240 },
  chatThumb: { width: 96, height: 74 },
  minFrames: 5, maxFrames: 20,
  allowedDurationsSec: [1, 2, 3, 4],
  allowedPlayCounts: [1, 2, 3, 4],
  maxTotalDurationSec: 4,
  maxFileBytes: 1024 * 1024,
} as const;

export type IssueLevel = 'error' | 'warning';
export interface LineIssue { level: IssueLevel; message: string }   // 訊息用繁體中文

export function validateForLine(input: {
  width: number; height: number;
  plan: ApngPlan;
  numPlays: number;
  byteLength?: number;
}): LineIssue[]
```

要檢出的項目（訊息要具體、附上實際數字）：

| 條件 | 等級 | 訊息範例 |
|---|---|---|
| 寬 > 320 或 高 > 270 | error | `尺寸 400×300 超過 LINE 上限 320×270` |
| 寬、高皆 < 270 | error | `寬高至少要有一邊達到 270px（目前 200×180）` |
| 實際幀數 < 5 | error | `實際 APNG 幀數只有 3（時間軸 8 格，其中相同影格已合併）；LINE 要求 5–20 幀` |
| 實際幀數 > 20 | error | `實際 APNG 幀數 24，超過 LINE 上限 20 幀` |
| `plan.allIdentical` | error | `所有影格內容完全相同，LINE 會拒絕上傳` |
| 單次播放秒數 不在 1/2/3/4 | warning | `單次播放 1.35 秒，LINE 只接受 1、2、3、4 秒` |
| 秒數 × 次數 > 4 | error | `總播放 2 秒 × 3 次 = 6 秒，超過 LINE 上限 4 秒` |
| 檔案 > 1MB | error | `檔案 1.4 MB 超過 LINE 上限 1 MB` |
| 背景不透明（第一幀四角 alpha 全為 255） | warning | `背景看起來不是透明的，LINE 要求透明背景` |

---

## 5. `scripts/verify-codec.ts`（`npm run verify:codec`）

用 `node:assert/strict`，全部通過才 exit 0：

1. 造 8 格 64×64 測試動畫，其中第 3、4、5 格內容完全相同，delay 各 50ms。
2. `planApng(..., { mergeIdentical: true })` → `actualFrameCount === 6`，
   合併那幀 `delayMs === 150`，`totalDurationMs === 400`。
3. `planApng(..., { mergeIdentical: false })` → `actualFrameCount === 8`。
4. `encodeApng` 兩種模式各跑一次，`verifyApng()` 回報的 `numFrames`、`delaysMs`
   必須跟 plan 完全一致。
5. `numPlays: 4` → `verifyApng().numPlays === 4`。
6. 全部影格相同的輸入 → `planApng().allIdentical === true`，
   `validateForLine()` 回傳含該 error。
7. `encodeGif` 跑得起來，輸出開頭是 `GIF89a`，長度 > 0。
8. 把兩個 APNG 存到 `out/verify/test-merged.png` 與 `out/verify/test-nomerge.png`。

`package.json` 加 `"verify:codec": "tsx scripts/verify-codec.ts"`，
並把 `"verify:all": "npm run verify && npm run verify:codec"`。

## 規則

- TypeScript strict
- `src/codec/` 同樣不可 import DOM 或 Electron API（要能在 node 直接跑）
- 不要加沒被要求的功能
