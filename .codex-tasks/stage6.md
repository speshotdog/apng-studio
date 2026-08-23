# Stage 6 — 打包成可交付的 Windows 程式 + 補齊測試涵蓋

委託人是插畫家，不會跑 `npm run dev`。要給他一個**點兩下就能開**的東西。

---

## 1. `electron-builder` 設定

新增 `electron-builder.yml`（或寫在 `package.json` 的 `build` 欄位，擇一）：

- `appId`: `com.apngstudio.app`
- `productName`: `APNG Studio`
- Windows target：**`portable`**（單一 exe，免安裝，插畫家最好處理）
  另外也產 `nsis` 安裝檔備用
- `artifactName`: `APNG-Studio-${version}-portable.${ext}`
- `files`: 只包 `out/**`、`package.json`，**不要**把 `assets/samples/11.clip`、
  `assets/golden/`、`.codex-tasks/`、`scripts/` 包進去
- 輸出目錄 `release/`
- `package.json` 加 `"version": "0.1.0"` 與
  `"dist": "electron-vite build && electron-builder --win"`
- `.gitignore` 加上 `release`

### 注意：`sql.js` 的 wasm

主行程用 `createRequire` 從 `node_modules/sql.js/dist/sql-wasm.wasm` 讀檔。
**打包後 `node_modules` 不存在，這條路徑會爆掉。**

改成：把 wasm 當成 vite 的 asset 或直接在 build 時複製到 `out/main/sql-wasm.wasm`，
執行時用 `join(__dirname, 'sql-wasm.wasm')` 讀。打包後也要能讀到
（必要時加進 `extraResources` 並用 `process.resourcesPath`）。

**這點一定要實際打包後開起來測，不能只看 build 有沒有過。**

---

## 2. 補 GIF 匯出的測試涵蓋

目前 smoke 只測了 APNG。加：

- 用同一組 8 格時間軸，`format: 'gif'` 匯出到 `out/smoke/export.gif`
- 斷言：檔頭是 `GIF89a`、檔案 > 0
- 用 Pillow 之外的方式驗證幀數（自己掃 GIF 的 Image Descriptor `0x2C` 數量），
  斷言幀數 === 合併後的 6
- 斷言 `encodeGif` 回傳的 `warnings` 有提到延遲精度（50ms → 5 centisec，這組剛好整除，
  所以如果沒有 warning 也合理 —— 那就另外用 fps=24（41.67ms）跑一次，確認會出 warning）

## 3. 補 LINE 規格檢查的測試涵蓋

在 smoke 裡多跑一段：

1. 按「LINE 貼圖」快捷（輸出尺寸等比縮到長邊 270）
2. 斷言輸出尺寸的長邊 === 270 且兩邊都 ≤ 320/270
3. 斷言此時 `validateForLine()` 的結果：
   - 實際幀數 6 → 通過（5–20）
   - 單次 0.40 秒 → 應該出 warning（LINE 只收 1/2/3/4 秒）
4. 把 fps 改成 6（8 格 → 合併後 6 幀、單次剛好 1.00 秒）、播放次數 4
   → 斷言 `validateForLine()` **沒有任何 error**
5. 存一張 `out/smoke/ui-line-ok.png`，畫面上要看得到綠色的
   「符合 LINE 動態貼圖規格」

---

## 4. 給委託人看的使用說明 `README.md`

**對象是插畫家，不是工程師。** 繁體中文，簡短，不要講技術架構。要包含：

- 這是什麼、解決什麼問題（重點講「為什麼 apngasm 的張數會對不上」）
- 怎麼開（下載 `APNG-Studio-x.y.z-portable.exe`，點兩下）
- 基本流程：拖 `.clip` 進來 → 圖層拖到影格軌 → 中間留空會自動延續 →
  按播放看效果 → 右邊設尺寸／FPS／播放次數 → 匯出
- **「時間軸格數」與「實際 APNG 幀數」為什麼會不一樣**（用他的話講：
  連續一樣的圖會被合併成一幀，這是 APNG 規格跟 LINE 驗證器的行為，
  不是這個工具在亂算；以前 apngasm 對不上就是因為這個）
- LINE 動態貼圖規格速查表
- 目前還沒做的事：CSP 動畫時間軸的自動帶入（要自己拖）

放一張 `docs/screenshot.png`（用 `out/smoke/ui-main.png` 複製過去）。

**AGENTS.md 保持是開發文件，不要把它跟 README 混在一起。**

---

## 完成條件

```
npm run typecheck
npm run verify:all
npm run smoke
npm run dist
```

全過，且：
- `release/` 底下有 `APNG-Studio-0.1.0-portable.exe`
- **實際執行那個 exe**，確認它開得起來、能開 `11.clip`、能匯出
  （可以用跟 smoke 一樣的手法對打包後的 app 截圖，存 `out/smoke/ui-packaged.png`）
- `out/smoke/` 有 `export.gif`、`ui-line-ok.png`

## 規則

- 不要改 `src/clip/`、`src/codec/` 的邏輯
- 不要為了讓測試過而放寬斷言
- 打包後真的跑不起來就修到跑得起來，不要回報「build 成功」就當完成
