# Stage 4 — 真的把 app 跑起來並自動截圖驗收

## 背景：Stage 3 沒有真正驗證過

Stage 3 回報「`npm run build` 通過」，但 **app 從來沒被啟動過**。實際跑 `npm run dev` 連續踩到兩個問題：

1. `package.json` 缺 `"main"` 欄位 → `Error: No entry point found for electron app`
   （已由我修好：`"main": "./out/main/index.js"`）
2. `node_modules/electron` 沒有下載到執行檔 → `Error: Electron uninstall`
   （已手動跑 `node node_modules/electron/install.js` 修好）

**「build 通過」不等於「app 會動」。本階段就是要補上這個缺口。**

---

## 要交付的東西

### 1. `scripts/smoke.ts` — 自動化 UI 冒煙測試（`npm run smoke`）

用 Electron 直接跑（不需要人看著），流程：

1. `npm run build` 產生的 `out/` 已存在（`smoke` script 前面先接 `electron-vite build`）
2. 開一個 `BrowserWindow(1280×800, show:false)`，載入 `out/renderer/index.html`
3. 等 `did-finish-load`
4. 透過 `webContents.executeJavaScript` 驅動 UI（見下方「測試鉤子」）：
   - 開啟 `assets/samples/11.clip`
   - 等圖層樹出現，確認 `資料夾 1` 底下有 6 個 cel
   - 把 6 個 cel 依序指派到第 **1、2、3、5、7、8** 格（第 4、6 格留空 → 應該顯示延續）
   - 等所有縮圖與預覽畫好
5. `webContents.capturePage()` → 存 `out/smoke/ui-main.png`
6. 再把 `playhead` 移到第 4 格（延續格）→ 存 `out/smoke/ui-inherit.png`
7. 用 `executeJavaScript` 讀回幾個狀態值做斷言（用 `node:assert/strict`）：
   - 圖層樹的 cel 名稱 === `["1","1a","1b","2","3","4"]`
   - `slots.length === 8`，第 4、6 格 `layerId === null`
   - `resolveSlot(3)` 回傳的 layerId === 第 3 格的 layerId（延續正確）
   - 統計面板算出的 `actualFrameCount === 6`（第 4 格與第 3 格相同、第 6 格與第 5 格相同 → 各合併一次）
   - `timelineFrameCount === 8`
   - 預覽 canvas 的像素**不是全透明**（`getImageData` 後 alpha 非零數 > 0）
8. 直接呼叫匯出邏輯（**不要開存檔對話框**）把 APNG 寫到 `out/smoke/export.png`，
   然後用 `src/codec/apng.ts` 的 `verifyApng()` 斷言：
   - `numFrames === 6`
   - `numPlays === 設定值`
   - `delaysMs` 長度 6
9. 全部通過印出摘要表並 exit 0；任一步失敗印出實際值並 exit 1
10. **一定要關掉視窗並 `app.quit()`**，不要留殘留進程

### 2. 測試鉤子

在 renderer 加一個**僅在測試時啟用**的鉤子，不要污染正式功能：

```ts
// src/renderer/main.tsx
if (import.meta.env.DEV || process.env.APNG_STUDIO_SMOKE) {
  ;(window as unknown as { __smoke: unknown }).__smoke = {
    store,            // zustand store（可 getState / setState）
    openClip: (path: string) => ...,
    waitIdle: () => Promise<void>,   // 等所有 lazy 縮圖與預覽畫完
    exportTo: (filePath: string) => Promise<ExportResult>,
  }
}
```

用環境變數 `APNG_STUDIO_SMOKE=1` 開啟即可，正式打包不會有。

`exportTo` 走跟 UI 按鈕**同一條路徑**（同一個 compose → IPC → encode），
只是把存檔對話框換成指定路徑。這點很重要：測到的必須是真正的匯出流程。

### 3. `package.json`

```json
"smoke": "electron-vite build && cross-env APNG_STUDIO_SMOKE=1 electron scripts/smoke.js"
```

（`cross-env` 加進 devDependencies；或用 node 直接設環境變數也可以，
自己選一種能在 Windows PowerShell 下跑起來的寫法。）

再加 `"verify:full": "npm run verify:all && npm run smoke"`。

### 4. `electron` 安裝保險

`package.json` 加：
```json
"postinstall": "node node_modules/electron/install.js"
```
避免下次 `npm install` 又漏掉 Electron 執行檔。

---

## 完成條件

依序全過：
```
npm run typecheck
npm run verify:all
npm run smoke
```

且 `out/smoke/` 底下有三個檔案：`ui-main.png`、`ui-inherit.png`、`export.png`。

**`ui-main.png` 必須看得到實際的羊、6 個 cel 縮圖、影格軌上第 4/6 格是延續狀態。**
截完圖自己用工具看一下，如果畫面是空白或壞掉的，要修到對為止再回報。

---

## 規則

- 不要改 `src/clip/`、`src/codec/` 的邏輯
- 不要為了讓測試過而放寬斷言
- 若發現 UI 有 bug（縮圖空白、拖曳失效、統計算錯），**修 UI，不要改測試**
