# Stage 1 — 專案骨架 + `.clip` 解析器

## 先讀

`D:\claude研究\apng-studio\AGENTS.md`（完整規格，**§3 是逐位元組的格式說明，照做即可**）。
`scripts/reference_clip_to_psd.py` 是 Python 參考實作，只當參照，**不要呼叫它**。

工作目錄：`D:\claude研究\apng-studio`

## 本階段要交付

### 1. 專案設定檔

- `package.json`
  - name `apng-studio`, private, type `module`
  - devDeps: `electron`, `electron-vite`, `electron-builder`, `vite`, `typescript`,
    `@types/node`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`
  - deps: `react`, `react-dom`, `zustand`, `sql.js`, `upng-js`, `gifenc`
  - scripts:
    - `dev`: `electron-vite dev`
    - `build`: `electron-vite build`
    - `typecheck`: `tsc --noEmit`
    - `verify`: `node scripts/verify-clip.mjs`
- `electron.vite.config.ts`（main / preload / renderer 三段，renderer 用 React plugin，
  root 指到 `src/renderer`）
- `tsconfig.json`（`strict: true`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`,
  `target: "ES2022"`）
- `src/renderer/index.html`（掛載點 `#root`，載入 `./main.tsx`）
- `.gitignore`（node_modules, dist, out）

**注意**：`sql.js` 的 wasm 檔要能在 Electron main process 讀到。
用 `createRequire` 從 `node_modules/sql.js/dist/sql-wasm.wasm` 讀成 Buffer，
以 `initSqlJs({ wasmBinary })` 初始化。不要用網路 locateFile。

### 2. `src/clip/` — 純 TypeScript 解析器

**不可 import 任何 DOM 或 Electron API。** 只用 `node:zlib`、`node:buffer`、`sql.js`。

#### `chunks.ts`
```ts
export interface ClipChunks {
  sqlite: Buffer;
  external: Map<string, Buffer>;  // key 含 "extrnlid" 前綴
}
export function readChunks(data: Buffer): ClipChunks
```
照 AGENTS.md §3.1 / §3.2。檔頭不是 `CSFCHUNK` 就 throw。

#### `offscreen.ts`
```ts
export interface OffscreenAttribute {
  bitmapWidth: number; bitmapHeight: number;
  blockGridWidth: number; blockGridHeight: number;
  defaultFillBlackWhite: number;
  packing: [number, number];   // attributes[1], attributes[2]
  initColor: [number, number, number, number];
}
export function parseAttribute(buf: Buffer): OffscreenAttribute
export function parseBlockChunk(buf: Buffer): (Buffer | null)[]
export interface Bitmap { width: number; height: number; data: Uint8ClampedArray } // RGBA
export function decodeBitmap(attr: OffscreenAttribute, blocks: (Buffer|null)[]): Bitmap
```
照 §3.4 / §3.5 / §3.6。
- 磚塊固定 256×256，`(1,4)` 時 inflate 後長度必為 `5*65536`，前 65536 是 alpha
  平面，後面是 **BGRX**。
- 輸出 Bitmap 大小為 `bitmapWidth × bitmapHeight`，最後一排磚塊要裁切。
- 長度不符只記 warning 並跳過該磚塊，不要整個 throw。

#### `tree.ts`
```ts
export interface ClipLayer {
  id: number; name: string;
  type: number; isFolder: boolean; isAnimationFolder: boolean;
  visible: boolean; opacity: number;      // 0..1（原始值 /256）
  blendMode: number;
  offsetX: number; offsetY: number;
  children: ClipLayer[];
  renderMipmapId: number;
}
export function buildTree(db): { root: ClipLayer; flat: Map<number, ClipLayer> }
```
用 `LayerFirstChildIndex` / `LayerNextIndex` 串接（§3.3）。**不要**用 parent id 猜。
`LayerName` 直接就是 UTF-8 字串。

#### `index.ts`
```ts
export interface ClipCanvas { width: number; height: number; resolution: number }
export interface ClipTimeline {
  frameRate: number; startFrame: number; endFrame: number; name: string;
}
export interface ClipDocument {
  canvas: ClipCanvas;
  root: ClipLayer;
  flat: Map<number, ClipLayer>;
  timeline: ClipTimeline | null;
  /** 取某個節點合成後的 RGBA（資料夾 = 依圖層順序由下往上疊子層） */
  renderNode(layerId: number): Bitmap;
}
export async function parseClip(data: Buffer): Promise<ClipDocument>
```

`renderNode` 規則：
- 一般圖層：走 `Layer.LayerRenderMipmap → Mipmap.BaseMipmapInfo → MipmapInfo.Offscreen
  → Offscreen.BlockData/Attribute`，解出 Bitmap，再依 `LayerOffsetX/Y` 貼到畫布尺寸的
  RGBA buffer 上。
- 資料夾：建畫布大小的空 RGBA，把子層**由陣列尾端往前**（CSP 的 NextIndex 順序是由上往下，
  合成要由下往上）逐一以 source-over alpha 混合疊上去。跳過 `visible === false` 的子層。
  套用子層 `opacity`。
- 混合模式 Phase 1 只支援 normal（`LayerComposite === 0`）；其他值也當 normal 處理，
  但在回傳前 `console.warn` 一次。
- 結果快取在 Map 裡，同一個 id 不要重算。

### 3. `scripts/verify-clip.mjs`

用 `tsx` 或先 `electron-vite build` 都太麻煩 —— 改成：加一個 `scripts/verify-clip.mjs`，
內部用 `tsx`（加進 devDependencies）跑 `scripts/verify-clip.ts`，或直接把 verify 寫成
`.ts` 並在 package.json 用 `tsx scripts/verify-clip.ts`。**選你覺得最乾淨的一種，
但 `npm run verify` 必須能直接跑起來。**

驗證內容（全部用 `node:assert/strict`，任何一項失敗就 exit 1）：

```
canvas.width === 360 && canvas.height === 360
flat.size === 25
root.id === 2
找得到 isAnimationFolder === true 的資料夾，id === 5，name === "資料夾 1"
該資料夾的 children 名稱集合 === ["1","1a","1b","2","3","4"]（順序不拘，但要印出實際順序）
flat.get(9).offsetX === 8 && flat.get(9).offsetY === -20
flat.get(9).name === "圖層 2"
timeline.frameRate === 20 && timeline.endFrame === 20
上述 6 個 cel 資料夾各自 renderNode() 後，alpha 通道非零的像素數 > 0
```

並把 6 張 cel 各存成 `out/verify/cel-<name>.png`（用 `upng-js` 的 `UPNG.encode`
存單張即可，不要引入其他影像庫）。

最後印出一張表：cel 名稱 / 非透明像素數 / bitmap 尺寸。

## 完成條件

依序跑過且都成功：
```
npm install
npm run typecheck
npm run verify
```

`npm run verify` 的輸出要包含那張表，且 `out/verify/` 有 6 個 png。

## 規則

- TypeScript strict，不要用 `any` 逃避（真的必要時加註解說明）
- 不要加沒被要求的功能
- 不要寫 README（AGENTS.md 已經是文件）
- 遇到格式跟 AGENTS.md 描述不符，**先印出實際位元組再判斷**，不要憑猜改
