# Stage 3 — Electron 主行程 + React UI

## 先讀

`AGENTS.md`（全部）、`.codex-tasks/stage1.md`、`.codex-tasks/stage2.md`。
工作目錄 `D:\claude研究\apng-studio`。

Stage 1（`src/clip/`）與 Stage 2（`src/codec/`）已完成並通過驗證。
**本階段不要修改這兩個資料夾**，只新增 `src/main/`、`src/preload/`、`src/renderer/`。

---

## 1. 主行程 `src/main/`

### `index.ts`
- `BrowserWindow` 1280×800，最小 1024×640
- `webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false }`
- 支援把 `.clip` 檔**拖進視窗**開啟：renderer 抓 `drop` 事件拿 `file.path` 丟給 IPC
- 選單：檔案 → 開啟 .clip (Ctrl+O)、匯出 APNG (Ctrl+E)、匯出 GIF、結束

### `ipc.ts`

```ts
'clip:open'    (filePath?: string) => ClipSummary | null
'clip:render'  (layerId: number)   => { width: number; height: number; rgba: Uint8Array }
'export:save'  (payload: ExportPayload) => ExportResult
```

```ts
interface ClipSummary {
  filePath: string;
  canvas: { width: number; height: number; resolution: number };
  timeline: { frameRate: number; startFrame: number; endFrame: number; name: string } | null;
  tree: LayerNode;   // 純資料，無 Bitmap
}
interface LayerNode {
  id: number; name: string;
  isFolder: boolean; isAnimationFolder: boolean;
  visible: boolean; opacity: number;
  children: LayerNode[];
}

interface ExportPayload {
  format: 'apng' | 'gif';
  width: number; height: number;
  frames: { rgba: Uint8Array; delayMs: number }[];
  numPlays: number;
  mergeIdentical: boolean;
  gif?: { maxColors: number; dither: boolean };
}
interface ExportResult {
  ok: boolean;
  filePath?: string;
  info?: ApngInfo;          // 來自 verifyApng
  warnings: string[];
  error?: string;
}
```

- `clip:open` 無參數時開系統檔案對話框（filter：`Clip Studio Paint (*.clip)`）
- 解析結果與 `renderNode` 的快取留在主行程，`clip:render` 用 layerId 查
- `export:save` 開存檔對話框（APNG 副檔名 `.png`，GIF 為 `.gif`），
  編碼 → `verifyApng` → 寫檔；任一步失敗回 `{ ok:false, error }` **不要寫出壞檔案**

### `src/preload/index.ts`
`contextBridge.exposeInMainWorld('api', { openClip, renderLayer, saveExport })`，
每個都回 Promise。附帶 `src/preload/api.d.ts` 宣告 `window.api` 型別。

---

## 2. Renderer 狀態 `src/renderer/state/store.ts`（zustand）

```ts
type ScaleMode = 'smooth' | 'pixel';

interface Slot {
  /** null = 延續前一格；手繪稿紅框那個行為 */
  layerId: number | null;
}

interface AppState {
  doc: ClipSummary | null;
  /** layerId → ImageBitmap，lazy 載入 */
  bitmaps: Map<number, ImageBitmap>;
  /** 使用者在圖層面板勾選的可見狀態，覆寫 .clip 原值 */
  visibility: Map<number, boolean>;

  slots: Slot[];              // 預設 8 格
  selectedSlot: number;

  fps: number;                // 預設沿用 timeline.frameRate，沒有就 12
  playCount: number;          // 0 = 無限；LINE 用 1..4
  format: 'apng' | 'gif';
  exportWidth: number;
  exportHeight: number;
  lockAspect: boolean;
  scaleMode: ScaleMode;
  mergeIdentical: boolean;    // 預設 true
  linePreset: boolean;        // 預設 true，開啟時顯示 LINE 驗證面板

  playing: boolean;
  playhead: number;           // slot index
}
```

**`resolveSlot(i)`**：往前找最近一個 `layerId !== null` 的格子；找不到就回 null（空白幀）。
這就是「中間會自動補上前一張圖」。

---

## 3. 版面（照手繪稿）

```
┌─ 圖層面板 260px ─┬──────── 主區 ─────────┬─ 匯出面板 300px ─┐
│  檔名 / 畫布尺寸  │   預覽畫布（棋盤格底）  │  格式 APNG / GIF │
│                  │                       │  輸出尺寸 W × H  │
│  ▸ ☑ 資料夾 1     │   ⏮  ▶/⏸  ⏭  🔁      │  ☐ 鎖定比例      │
│    ▸ ☑ 1         │   第 3 / 8 格          │  縮放 平滑/銳利   │
│    ▸ ☑ 1a        │                       │  FPS  [ 20 ]     │
│    ...           ├───────────────────────┤  播放次數 [ 4 ]   │
│  ☑ 圖層 1        │ 1  2  3  4  5  6  7  8│  ☑ 合併重複影格   │
│                  │[▣][▣][ ][ ][▣][ ][▣][ ]│ ─────────────── │
│  （可拖曳）       │      ← 影格軌          │  時間軸格數 8    │
│                  │  + 加一格   − 減一格    │  實際 APNG 幀數 5 │
│                  │                       │  總長 0.40 秒     │
│                  │                       │  ⚠ LINE 檢查結果  │
│                  │                       │  [ 匯出 ]        │
└──────────────────┴───────────────────────┴──────────────────┘
```

深色主題。中文字型 stack：`"Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif`。

---

## 4. 各元件

### `LayerPanel.tsx`
- 樹狀，資料夾可摺疊，縮排 16px/層
- 每列：`☑ 可見` + 縮圖(32×32) + 名稱
- 動畫資料夾（`isAnimationFolder`）加一個「動畫」標籤色塊
- **整列 `draggable`**，`dragstart` 時 `dataTransfer.setData('application/x-layer-id', String(id))`
- 縮圖：第一次渲染時呼叫 `window.api.renderLayer(id)`，轉成 `ImageBitmap` 存進 store，
  縮放後畫進小 canvas。用 `IntersectionObserver` 延後載入，不要一次全載。

### `Timeline.tsx`
- 水平捲動的格子列，每格 72×72 + 上方序號
- 格子狀態三種：
  - **有指定** → 顯示該圖層縮圖 + 名稱，實線邊框
  - **延續前一格** → 顯示繼承來的縮圖但降到 40% 不透明，**紅色虛線邊框**（呼應手繪稿紅框）
  - **完全空白**（前面沒有任何指定）→ 灰色斜線底
- 拖放：
  - 從圖層面板拖入 → 設定該格 `layerId`
  - 格子之間互拖 → 交換兩格內容
  - 按住 Alt 拖 → 複製而非移動
- 右鍵選單：`清除這格`、`從這格延續`、`在後面插入一格`、`刪除這格`
- 點格子 → `selectedSlot` + 暫停播放並把 `playhead` 移過去
- 下方按鈕：`+ 加一格` / `− 減一格`，以及快捷「格數：[8] 格」數字輸入
- 播放中，目前 playhead 那格加亮色外框

### `PreviewStage.tsx`
- `<canvas>` 以畫布原始尺寸為基準，`object-fit: contain` 置中，底層畫棋盤格代表透明
- 播放迴圈用 `requestAnimationFrame` + 累積時間（**不要用 setInterval**），
  每格時長 `1000 / fps`
- 播放次數：跑完 `playCount` 次就停在最後一格（`playCount === 0` 則無限）
- 控制列：⏮ 回到第一格 / ▶⏸ / ⏭ 到最後一格 / 🔁 循環開關 / `第 n / N 格` / 目前 fps
- 鍵盤：空白鍵 播放暫停、← → 上下一格、Home/End

### `ExportPanel.tsx`
- 格式 radio：APNG / GIF
- 輸出尺寸：W、H 數字輸入 + `☐ 鎖定比例`（預設勾）+ 快捷按鈕
  `原始尺寸` / `LINE 貼圖 (長邊 270)` / `LINE 主圖 240×240`
  - 「LINE 貼圖」按鈕：等比縮到長邊 = 270，另一邊四捨五入，若超過 320 再夾住
- 縮放方式：平滑 / 銳利（銳利 = `imageSmoothingEnabled = false`）
- FPS 數字輸入（1–60）
- 播放次數：`1 / 2 / 3 / 4 / 無限` 按鈕組
- `☑ 合併重複影格`（旁邊放一個 ⓘ 說明：APNG 規格與 LINE 驗證器都會合併連續相同的影格，
  關掉可能導致上傳失敗）
- GIF 專屬：最大色數 (2–256, 預設 256)、`☐ 抖色`
- **即時統計區**（每次 state 變動就重算，呼叫 `planApng`）：
  - 時間軸格數
  - 實際 APNG 幀數（跟時間軸格數不同時用黃字標示）
  - 單次總長（秒，兩位小數）
  - 總播放時間 = 單次 × 次數
- **LINE 檢查區**（`linePreset` 開啟時顯示）：`validateForLine()` 的結果條列，
  error 紅色、warning 黃色，全部通過顯示綠色「符合 LINE 動態貼圖規格」
- `匯出` 按鈕：有 error 時仍可按，但要先跳確認對話框
- 匯出完成後顯示結果：檔案路徑、實際幀數、實際播放次數、檔案大小（KB），
  以及 GIF 的延遲誤差警告

---

## 5. 影格合成流程（renderer）

匯出與預覽共用同一個函式：

```ts
function composeFrame(slotIndex: number, w: number, h: number, mode: ScaleMode): Uint8Array
```

1. `resolveSlot(slotIndex)` 取得 layerId；null → 回傳全透明
2. 從 store 拿該 layerId 的 `ImageBitmap`（畫布原始尺寸）
3. 畫到 `OffscreenCanvas(w, h)`：
   - `smooth` → `imageSmoothingEnabled = true; imageSmoothingQuality = 'high'`
   - `pixel`  → `imageSmoothingEnabled = false`
   - 等比置中（letterbox），不要拉伸變形
4. `getImageData` → `Uint8Array`

匯出時對每一格跑一次，組成 `frames[]` 丟給 `export:save`。
**注意**：`ImageBitmap` 已經含 alpha，`getImageData` 出來就是 straight alpha，
直接給編碼器即可，不要再做 premultiply。

---

## 6. 完成條件

```
npm run typecheck   # 0 error
npm run verify:all  # Stage1 + Stage2 驗證仍全過
npm run build       # electron-vite build 成功
npm run dev         # 能開起來
```

手動驗收（自己跑 `npm run dev` 用截圖確認）：
1. 開 `assets/samples/11.clip`
2. 左側看得到 `資料夾 1` 底下 6 個 cel（1, 1a, 1b, 2, 3, 4），縮圖不是空白
3. 把 6 個 cel 分別拖到第 1、2、3、5、7、8 格
4. 第 4 格顯示紅虛線（延續第 3 格）、第 6 格同理
5. 按播放，畫面會動
6. 右側顯示「時間軸格數 8 / 實際 APNG 幀數 6」
7. 匯出 APNG，結果面板顯示的幀數與播放次數跟設定一致

## 規則

- TypeScript strict，UI 文案全繁體中文
- 不要引入 UI 元件庫（自己寫 CSS，用 CSS Modules 或單一 `styles.css` 都可以）
- 不要加沒被要求的功能（例如洋蔥皮、時間軸縮放、專案存檔 —— 那些是之後的事）
