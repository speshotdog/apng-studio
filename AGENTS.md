# APNG Studio — 開發規格書

給 Codex / Claude 共同開發使用。**動手前先讀完本檔。**

---

## 1. 這個工具在解決什麼問題

委託人是插畫家，目前製作 LINE 動態貼圖的流程是：

1. 在 Clip Studio Paint (CSP) 畫好動畫，預覽一次
2. 整理圖層
3. 匯出成連續 PNG
4. 丟進 **apngasm** 合成 APNG
5. 調整播放秒數／幀數／播放次數（最多 4 次）

### 現行痛點

| 痛點 | 原因 |
|---|---|
| apngasm 連續丟兩張一樣的 PNG，張數會算錯 | APNG 規格會把「相同影格」合併；apngasm 的計數與 LINE 驗證器不一致 |
| 秒數／張數跟設定對不上 → LINE 上傳失敗 | 同上，實際 fcTL 數 ≠ 使用者以為的張數 |
| 要先匯出連續 PNG 才能做 | 中間多一道手續，改一格就要重來 |
| 沒有即時預覽 | 速度／效果對不對要合成完才知道 |

> LINE 官方指南原文：*"Repeated identical images may become combined as a single frame"*，且全部影格相同的檔案會上傳失敗。
> **這正是委託人遇到的 bug 根源，本工具必須正面處理。**

### 目標流程

畫完 CSP → **全部在這個工具裡完成** → 匯出 APNG / GIF。

---

## 2. 需求（來自委託人原話 + 手繪稿）

- 直接丟 `.clip` 檔進來，**吃得到圖層**
- 像剪影片一樣：把圖層拖進影格軌，可拖曳調整
- 影格之間留空 → **自動延續前一格的圖**（手繪稿紅字：「中間會自動補上一為最後的圖」）
- 直接預覽播放，看速度與效果
- 匯出 APNG 或 GIF，可調 **輸出尺寸**、**一秒放幾幀**、**播放次數**

### 手繪稿版面

```
┌──────────┬─────────────────────────────────┐
│ 圖層面板  │        預覽畫布                  │
│ ☐ 圖層1  │      ┌──────────┐               │
│ ☐ 圖層2  │      │  (羊)     │               │
│ ☐ 圖層3  │      └──────────┘               │
│          │   ⏮  ▶  ⏸  ⏭                   │
│          ├─────────────────────────────────┤
│    │     │ 1  2  3  4  5  6  7  8          │
│    └────────▶ [][][][][][][][]   ← 影格軌   │
│  可直接拖移進來                              │
└──────────┴─────────────────────────────────┘
```

---

## 3. `.clip` 檔格式（已逆向確認，用 `assets/samples/11.clip` 驗證過）

參考實作：[dobrokot/clip_to_psd](https://github.com/dobrokot/clip_to_psd)（Python，MIT）。
本專案**不呼叫 Python**，全部以 TypeScript 重寫。

### 3.1 容器結構

```
[0..24)   檔頭： "CSFCHUNK" + 8-byte BE 檔長 + 8-byte BE offset
接著是連續 chunk，每個 chunk：
  [0..4)   "CHNK"
  [4..8)   chunk 名稱（Head / Exta / SQLi / Foot）
  [8..16)  8-byte BE 資料長度 N
  [16..16+N) 資料
```

實測 `11.clip`（1,448,510 bytes）：`Head` ×1、`Exta` ×48、`SQLi` ×1、`Foot` ×1。

### 3.2 `CHNKExta` — 外部資料塊

```
[0..8)          8-byte BE  id 長度 L（實測恆為 40）
[8..8+L)        ASCII id，格式 "extrnlid" + 32 hex 大寫
[8+L..16+L)     8-byte BE 資料長度 M
[16+L..16+L+M)  資料本體
```

建成 `Map<string, Buffer>`，key 含 `extrnlid` 前綴。SQLite 內以字串
`"extrnlid<32hex>"` 參照。

### 3.3 `CHNKSQLi` — 專案資料庫

原封不動就是一個 SQLite 檔（`SQLite format 3`）。用 **sql.js**（wasm，免原生編譯）
從記憶體 Buffer 載入。

實測資料表：
`AnimationCutBank, Canvas, CanvasItem, CanvasItemBank, CanvasPreview, ElemScheme,
ExternalChunk, ExternalTableAndColumnName, Layer, LayerComp, LayerCompManager,
LayerThumbnail, Mipmap, MipmapInfo, Offscreen, ParamScheme, Project, RemovedExternal,
TimeLapse*, TimeLine, Track`

#### 需要的欄位

**Canvas**（單列）
`MainId, CanvasWidth, CanvasHeight, CanvasResolution, CanvasRootFolder, CanvasUnit`
→ 實測 360.0 × 360.0 @ 72dpi，root folder = Layer.MainId 2

**Layer**（59 欄，只用這些）
```
MainId, CanvasId, LayerName, LayerType, LayerVisibility, LayerOpacity (0..256),
LayerComposite, LayerFolder (1=資料夾), LayerOffsetX, LayerOffsetY,
LayerRenderOffscrOffsetX, LayerRenderOffscrOffsetY,
LayerNextIndex (同層下一個，0=結束), LayerFirstChildIndex (資料夾第一個子層, 0=無),
LayerRenderMipmap, LayerLayerMaskMipmap, AnimationFolder (1=動畫資料夾), LayerUuid
```
- `LayerName` 是 **UTF-8**（不是 UTF-16，也不是 Big5）。sql.js 取出即為正確字串。
- 圖層樹用 `LayerFirstChildIndex` + `LayerNextIndex` 串接，**不是**用 parent id。
- `LayerType`：`0`=資料夾, `1`=一般點陣圖層, `256`=root, `1584`=用紙(paper)層。

**Mipmap / MipmapInfo / Offscreen** — 取像素的鏈路
```
Layer.LayerRenderMipmap → Mipmap.MainId
Mipmap.BaseMipmapInfo   → MipmapInfo.MainId
MipmapInfo.Offscreen    → Offscreen.MainId
Offscreen.BlockData     → 外部 chunk id（字串）
Offscreen.Attribute     → 二進位屬性（見 3.4）
```

**TimeLine / Track / AnimationCutBank** — CSP 自帶的動畫時間軸
```
TimeLine: FrameRate, StartFrame, EndFrame, CurrentFrame, FirstTrack, TimeLineName
Track:    TrackKind (2000=ImageCel 影格軌), TrackActionMixer (外部 chunk id)
```
實測：FrameRate=20，0..20 幀，Track 3 kind=2000 就是 cel 軌。

### 3.4 `Offscreen.Attribute` 解析（big-endian）

```
u32 header_size        // 恆為 16
u32 info_section_size  // 恆為 102
u32 extra_info_size    // 42 或 58
u32 (skip)
str "Parameter"        // CSP 字串 = u32 長度 + UTF-16BE 字元
u32 bitmap_width
u32 bitmap_height
u32 block_grid_width
u32 block_grid_height
u32 × 16  attributes   // [1]=第一組通道數, [2]=第二組通道數
str "InitColor"
u32 (skip)
u32 default_fill_black_white
u32 (skip) ×2
u32 (skip)
if extra_info_size == 58: u32 × 4 → init_color（各取 >> 24 當 0..255）
```

`packing = (attributes[1], attributes[2])`
- `(1, 4)` → RGBA 彩色圖層
- 兩者合計為 1 → 單通道遮罩（灰階）

### 3.5 `BlockData` 外部 chunk → 磚塊網格

資料是一串子區塊，逐段掃描（皆 big-endian）：

```
情況 A: 開頭 == u32(11) + "BlockStatus"(UTF-16BE)
        status_count = BE u32 @ offset 30
        block_size   = status_count*4 + 12 + (11*2 + 4)

情況 B: 開頭 == u32(13) + "BlockCheckSum"(UTF-16BE)
        block_size = (13*2 + 4) + 12 + block_count*4

情況 C: offset+8 起 == "BlockDataBeginChunk"(UTF-16BE)
        block_size = BE u32 @ offset 0
        結尾必須是 u32(17) + "BlockDataEndChunk"(UTF-16BE)
        body = [offset+8+38 .. offset+block_size-42)
          body u32[4] = has_data (0 或 1)
          has_data==0 → 此磚塊為空
          has_data==1 → subblock_len = body u32[5]（BE）
                        壓縮資料 = body[28..]  ← zlib deflate
```

磚塊依序填入 `block_grid_width × block_grid_height` 網格（row-major）。

### 3.6 磚塊像素解碼

每個磚塊固定 **256×256**。zlib inflate 後：

- packing `(1,4)`：長度必為 `5 * 65536`
  - `[0 .. 65536)` = Alpha（8-bit，256×256）
  - `[65536 .. 5*65536)` = **BGRX**（4 bytes/px，第 4 byte 丟棄）
  - 合成 RGBA：`R=B通道[2]? ` → 正確順序為 `r = px[2], g = px[1], b = px[0], a = alphaPlane[i]`
- 單通道：長度必為 `65536`，直接當灰階

畫布預設填色：`default_fill_black_white` 為真 → 白 `(255,255,255,255)`；否則透明 `(0,0,0,0)`。

磚塊貼到 `(256*col, 256*row)`。最後圖層在畫布上的位置還要加
`LayerOffsetX + LayerRenderOffscrOffsetX`（Y 同理）。

> ⚠️ `bitmap_width/height` 可能大於畫布，且 `block_grid * 256` 可能大於 `bitmap_width/height`
> （最後一排磚塊要裁切）。

### 3.7 `TrackActionMixer` — CSP 時間軸關鍵幀

外部 chunk 內容為 `u32 LE 壓縮後長度` + zlib deflate。解壓後以
`cmt 0100binc` 開頭，接 4 個未知位元組、`u32 LE` 字串數量、每項為
`u8 長度 + UTF-8` 的字串表，再接單一根節點。字串表前 22 項依序為
`null, Byte, SByte, UInt16, Int16, UInt32, Int32, Single, Double, String,
Float2, Float3, Quat, Matrix44, Single[], Byte[], Int32[], String[], Float2[],
Float3[], Quat[], Matrix44[]`，索引即型別代碼。

節點為 `u32 nameIndex`、`u32 typeIndex`、依型別編碼的 value、`u32 attrCount`
及其字串索引對、`u32 childCount` 及遞迴子節點；所有整數與浮點數皆為
little-endian。陣列為 `u32 count` 後接定長元素。解析必須剛好消耗完整 buffer。

ImageCel 軌只取 `AnimInfo/FCurve[Type="ImageCelName"]` 的 `Frame` 與 `Tag`；cel
名稱必須使用 `Tag`，不可使用不穩定的 `Value`。文件影格換算為
`round(curveFrame * TimeLine.FrameRate / TimeInfo.Rate)`，Rate 無效時退回文件 FPS
並警告。`Track.LayerUuidWithTrack` 的 16-byte hex 對應去除連字號後的
`Layer.LayerUuid`，且只處理 `TrackKind === 2000`。

---

## 4. 技術選型

| 用途 | 選擇 | 理由 |
|---|---|---|
| 殼 | Electron + electron-vite | 委託指定 Electron |
| UI | React 18 + TypeScript | 拖曳／時間軸狀態複雜 |
| SQLite | `sql.js`（wasm） | 從記憶體 Buffer 載入，免 native rebuild |
| 解壓 | Node 內建 `zlib.inflateSync` | 無額外依賴 |
| APNG 編碼 | 自製 APNG 組裝器（`upng-js` 僅選用於減色與測試解碼） | 可精確控制播放次數、幀數與每幀 delay |
| APNG 驗證 | 自己寫 `verifyApng()` | **關鍵**：重新解析 acTL/fcTL 核對幀數與延遲 |
| GIF 編碼 | `gifenc` | 快、支援透明、無 worker 依賴 |
| 縮放 | canvas `drawImage` (main 用 `sharp`? 否) | 一律在 renderer 用 OffscreenCanvas |

**不要**引入 Python、ffmpeg、apngasm 或任何外部執行檔。

---

## 5. 專案結構

```
apng-studio/
├── AGENTS.md                  ← 本檔
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── assets/samples/11.clip     ← 委託人提供的測試檔
├── scripts/
│   └── verify-clip.mjs        ← 解析器黃金驗證（見 §7）
└── src/
    ├── main/
    │   ├── index.ts           ← BrowserWindow、選單
    │   └── ipc.ts             ← open-clip / export-apng / export-gif
    ├── preload/index.ts
    ├── clip/                  ← 純 TS，無 DOM，可單獨跑 node
    │   ├── chunks.ts          ← §3.1 §3.2
    │   ├── db.ts              ← §3.3 sql.js
    │   ├── offscreen.ts       ← §3.4 §3.5 §3.6
    │   ├── tree.ts            ← 圖層樹 + 資料夾合成
    │   ├── binc.ts            ← §3.7（Phase 2）
    │   └── index.ts           ← parseClip(buffer) → ClipDocument
    ├── codec/
    │   ├── apng.ts            ← encodeApng + verifyApng
    │   ├── gif.ts             ← encodeGif
    │   └── line.ts            ← LINE 規格驗證（§6）
    └── renderer/
        ├── App.tsx
        ├── state/store.ts     ← zustand
        └── components/
            ├── LayerPanel.tsx
            ├── PreviewStage.tsx
            ├── Timeline.tsx
            └── ExportPanel.tsx
```

---

## 6. LINE 動態貼圖規格（寫成 `src/codec/line.ts` 的常數，可調）

| 項目 | 限制 |
|---|---|
| 貼圖尺寸 | 最大 320 × 270 px，且**寬或高至少要有一邊 ≥ 270** |
| 主要圖片 | 240 × 240 px |
| 聊天縮圖 | 96 × 74 px |
| 幀數 | **5 – 20 幀** |
| 播放秒數 | 1 / 2 / 3 / 4 秒（僅此四種） |
| 播放次數 | 1 / 2 / 3 / 4 次，且 秒數 × 次數 ≤ 4 秒 |
| 檔案大小 | 單張 ≤ 1 MB |
| 格式 | APNG（副檔名 `.png`）、RGB、背景透明 |

### 重複影格處理（本工具的核心價值）

自動補幀一定會產生「連續相同影格」。處理策略：

1. 匯出前先算出 **實際會產生的 fcTL 數**：把連續相同的影格合併成一幀、延遲相加。
2. UI 明確顯示兩個數字：
   - `時間軸格數：8`
   - `實際 APNG 幀數：5`（含警告燈號）
3. 若合併後 < 5 幀 → 紅色警告「LINE 要求至少 5 幀」。
4. 若所有影格皆相同 → 紅色警告「LINE 會拒絕整份都相同的檔案」。
5. 提供 `不合併重複幀` 開關（預設關），開啟時附警告說明 LINE 端可能仍會合併。
6. 匯出後 **一定要跑 `verifyApng()`**，實際重新讀 acTL `num_frames`、`num_plays`
   與每個 fcTL 的 `delay_num/delay_den`，跟預期值比對；不符就報錯不寫檔。

---

## 7. 驗證方式（Definition of Done）

`npm run verify` 執行 `scripts/verify-clip.mjs`，對 `assets/samples/11.clip` 斷言：

```
canvas.width  === 360
canvas.height === 360
layers 總數    === 25
root folder    === MainId 2
存在 AnimationFolder=1 的資料夾（MainId 5，名稱 "資料夾 1"）
該資料夾底下依序有 6 個子資料夾：1, 1a, 1b, 2, 3, 4
圖層 "圖層 2"(MainId 9) offset === (8, -20)
每個 cel 資料夾合成出來的 RGBA 不是全透明
timeline.frameRate === 20, endFrame === 20
```

並輸出 `out/verify/*.png` 供肉眼檢查（6 個 cel 各一張）。

APNG 端：`npm run verify:apng` 產生一個 8 格、其中第 3~5 格相同的測試動畫，
斷言 `verifyApng()` 回報的幀數與延遲與預期一致。

---

## 8. 開發規則

- 全部 TypeScript，`strict: true`
- 不加沒被要求的功能、不做臆測性抽象
- 解析器 (`src/clip/`) 不可 import 任何 DOM / Electron API
- 錯誤要往上拋帶訊息，不要靜默吞掉
- UI 文案一律**繁體中文**
