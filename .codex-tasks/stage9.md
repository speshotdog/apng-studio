# Stage 9 — 程式碼審查後的修正

我把整份原始碼讀過並實測，發現以下問題。**依嚴重度排序，全部要修。**

不要只讓測試過 —— 每一項都要加對應的斷言或測試，證明它真的被修好了。

---

## P0-1 圖層可見性勾選框完全沒有作用

`LayerPanel` 的勾選框會寫入 `store.visibility`，但 **`composeFrame()` 和主行程的
`renderNode()` 從來不讀它**。合成永遠用 `.clip` 檔原本的可見性。使用者取消勾選任何
圖層，預覽和匯出都不會改變。

委託人的手繪稿上明確畫了每個圖層前面的勾選框，這是有被要求的功能。

### 改法

可見性覆寫必須真的影響合成。`renderNode` 在主行程，合成也在主行程，所以：

1. `ClipDocument.renderNode(layerId, overrides?: Map<number, boolean>)` 
   ——多一個可選的可見性覆寫參數，合成子層時以覆寫值優先，沒有覆寫才用圖層原值。
   （這是 `src/clip/` 唯一允許的邏輯改動。）
2. `clip:render` IPC 多收一個 `overrides` 參數（用 `Array<[number, boolean]>` 傳，
   Map 不能直接走 IPC）。
3. 主行程的 `rendered` 快取 key 要**把覆寫狀態一起納入**，否則改了勾選還是拿到舊圖。
   建議 key = `layerId + '|' + 受影響子層的覆寫簽章`。
4. renderer 的 `ensureBitmap(id)` 同理，快取 key 要含覆寫簽章；
   勾選改變時要讓受影響的 bitmap 失效並重畫預覽、影格軌縮圖、圖層縮圖。
5. **圖層面板自己的縮圖不要套用覆寫**（縮圖是「這層長什麼樣」，不是「這層現在看不看得到」）。
   取消勾選時把那一列整體變暗表示停用即可。

### 驗證

smoke 加一段：取消勾選某個 cel 底下的上色圖層 → 重新合成 → 
斷言該格 RGBA 與勾選前**不同**，且非透明像素數下降。存一張 `ui-visibility.png`。

---

## P0-2 拖曳 `.clip` 進視窗開檔是壞的

`App.tsx`：

```ts
const file = e.dataTransfer?.files[0] as (File & { path?: string }) | undefined
if (file?.path?.toLowerCase().endsWith('.clip')) void openClip(file.path)
```

**`File.path` 在 Electron 32 已被移除**，本專案用 Electron 43 → `file.path` 恆為
`undefined`，拖檔完全沒反應。而「直接丟 CSP 檔進來」是委託人的第一項需求。

### 改法

preload 曝露 `webUtils.getPathForFile`：

```ts
import { webUtils } from 'electron'
// api 增加：
getPathForFile: (file: File) => webUtils.getPathForFile(file)
```

`App.tsx` 改用它取路徑。**注意**：已知在部分 Electron 版本上，drop 事件拿到的 File
用 `getPathForFile` 可能回空字串。所以要加後備：拿不到路徑時，改用
`file.arrayBuffer()` 把內容直接送進主行程解析（`clip:openBuffer` IPC），
並且**不要靜默失敗** —— 真的開不起來要跳 toast 說明原因。

### 驗證

smoke 沒辦法真的模擬 OS 拖放，改為：
- 單元測試 `getClipPathFromDrop()` 這個抽出來的純函式（給假的 DataTransfer）
- smoke 走 `clip:openBuffer` 路徑開一次檔，斷言結果與走檔案路徑開出來的一致

---

## P0-3 按「− 減一格」會讓程式當掉

`store.resolveSlot`：

```ts
for (let i = index; i >= 0; i--) if (slots[i]?.layerId !== null) return slots[i]!.layerId
```

`slots[i]` 為 `undefined` 時，`undefined?.layerId` 得到 `undefined`，
`undefined !== null` 是 **true** → 進去存取 `undefined.layerId` → TypeError。

實測：
```
in-range: 5
out-of-range(3): CRASH: TypeError Cannot read properties of undefined (reading 'layerId')
```

`Timeline.resize()` 減少格數時 **`playhead` 與 `selectedSlot` 都沒有夾回範圍內**，
走到最後一格再連按「− 減一格」就會炸。

### 改法

1. `resolveSlot` 改成 `const slot = slots[i]; if (slot && slot.layerId !== null) return slot.layerId`
2. `resize()` 之後把 `playhead`、`selectedSlot` 一起夾到 `[0, newLength-1]`
3. 右鍵「刪除這格」也要做同樣的夾制

### 驗證

`scripts/verify-codec.ts` 旁邊加一支純邏輯測試（或併進去），
直接測 `resolveSlot` 對超出範圍、負數、空陣列都回 `null` 不丟例外。

---

## P1-1 預覽的循環鈕會偷改匯出的播放次數

播放列的 `↻` 直接改 `playCount`，而 `playCount` 同時是**匯出的播放次數**。
使用者為了反覆看效果按循環，匯出設定就被改成無限 → LINE 檢查立刻變紅，
而且他不會知道為什麼。

### 改法

store 新增 `previewLoop: boolean`（預設 `true`，預覽本來就該一直跑）。
- `↻` 只切換 `previewLoop`
- 預覽播放迴圈：`previewLoop` 為真就無限循環；為假則播 `playCount` 次後停在最後一格
- `playCount` 只由匯出面板的「播放次數」控制

---

## P1-2 改尺寸或 FPS 時每按一鍵就重新合成所有影格

`ExportPanel` 的 `frames` useMemo 相依 `width/height/fps/scaleMode`，
每次變動同步跑 N 次 `composeFrame()`（各建一個輸出解析度 OffscreenCanvas + `getImageData`），
`planFrames` 再逐 byte 比對全部影格。8 格 360×360 每次按鍵就搬 4MB。
調尺寸是高頻操作，格數多會明顯卡頓。

### 改法

1. **相同影格的判定不需要輸出解析度** —— 兩格是否相同只取決於 `resolveSlot()` 的結果。
   統計面板要的 `timelineFrameCount / actualFrameCount / totalDurationMs` 
   **可以只從 `slots` 與 `fps` 算出來，完全不用合成像素**。
   把這個輕量版抽成 `planFromSlots(slots, fps, mergeIdentical)`，統計面板改用它。
2. 真正的像素合成只在**按下匯出時**做一次（`createExportPayload` 已經是這樣）。
3. `validateForLine` 需要的 `firstFrameRgba`（判斷背景是否透明）改成只合成第一格，
   而且對 `width/height` 做 debounce（250ms）。
4. `ExportPanel`、`Timeline`、`PreviewStage` 目前都用不帶 selector 的 `useStore()`，
   會訂閱所有狀態變動 —— 播放時每秒重繪 20 次整個面板。改成用 selector 只取需要的欄位。

### 驗證

smoke 加一項：連續改 20 次 `exportWidth`，量測總耗時，斷言 < 500ms。

---

## P1-3 選 GIF 時仍顯示「實際 APNG 幀數」與 LINE 檢查

LINE 動態貼圖只收 APNG，GIF 上傳不了。目前選 GIF 時：
- 統計列還是寫「實際 APNG 幀數」
- LINE 檢查照跑，還會顯示綠色「符合 LINE 動態貼圖規格」

### 改法

- 標籤依格式改為「實際 APNG 幀數」／「實際 GIF 幀數」
- 選 GIF 時，LINE 檢查區改顯示一行灰字說明：
  `LINE 動態貼圖只接受 APNG，GIF 不適用此檢查`
  （不要直接把整區藏起來，不然使用者會以為壞了）

---

## P2-1 右鍵選單有兩個選項做同一件事

`清除這格` 與 `從這格延續` 的 onClick 都是 `setSlot(index, null)`，完全相同。

### 改法

語意上這兩件事在目前的資料模型下**本來就是同一件事**（清空 = 延續前一格）。
所以刪掉「從這格延續」，只留「清除這格（改為延續前一格）」一個選項，
文案講清楚實際行為。第一格被清除時是真的空白，文案要能反映
（第一格顯示「清除這格」，其餘顯示「清除（延續前一格）」）。

---

## P2-2 點過影格格子後鍵盤快捷鍵失效

```ts
if ((e.target as HTMLElement).matches('input,button')) return
```

點格子之後焦點留在那顆 button 上 → 空白鍵、左右鍵全部失效，
而且空白鍵還會再觸發一次那顆按鈕。

### 改法

- 判斷改成只擋真正的文字輸入：`matches('input, textarea, select')`
- 影格格子按鈕加上 `onKeyDown` 攔截空白鍵，或點擊後 `blur()`
- 確保空白鍵不會同時觸發按鈕的 click

---

## P2-3 預覽看不到縮小後的實際效果

預覽永遠用畫布原始尺寸畫，不套用輸出尺寸與縮放方式。但貼圖要縮到 270，
線條會不會糊掉正是他要預覽的重點。

### 改法

預覽區加一個切換：`原始尺寸` / `輸出尺寸`（預設**輸出尺寸**，因為那才是成品）。
選輸出尺寸時，預覽用 `exportWidth/Height` 與 `scaleMode` 合成後再放大顯示到畫面上
（放大時用 `image-rendering: pixelated`，才看得出真實的縮放結果）。

---

## P2-4 影格軌縮圖每次 render 都重跑 `toDataURL()`

`Timeline` 用 `<img>` + ref callback，每次 render 都建一張完整尺寸 canvas 再轉 base64。
圖層面板那邊已經用 `<canvas>` 畫得很正確。

### 改法

比照 `LayerPanel` 的 `Thumb`，改成 `<canvas>` 直接 `drawImage`。

---

## P2-5 GIF 的「抖色」是空的開關

`gifenc` 不支援抖色，`gif.ts` 收到只吐一句 warning，UI 卻給了可勾的框。

### 改法

把 UI 的「抖色」勾選框拿掉，`GifOptions` 也移除 `dither`。
不要留一個假的開關。

---

## P3-1 「LINE 貼圖」快捷對寬幅畫布不是最佳解

目前一律 `ratio = 270 / max(w, h)`，長邊固定 270。但 LINE 的上限是 320×270，
寬幅圖其實可以放大到寬 320。

### 改法

改成同時受兩個上限拘束的最大等比縮放：
`ratio = min(320 / w, 270 / h)`，這樣寬幅圖會貼到寬 320、高不超過 270，
方形圖仍然得到 270×270，且一定滿足「至少一邊 ≥ 270」。
若算出來兩邊都 < 270（極端長寬比），要在 LINE 檢查區給出明確錯誤。

---

## 完成條件

```
npm run format:check
npm run typecheck
npm run verify:all
npm run smoke
npm run dist
```

全過，且：
- `out/smoke/` 多一張 `ui-visibility.png`，看得出取消勾選後畫面真的變了
- 新增的 `resolveSlot` 邊界測試、`planFromSlots` 測試、拖放路徑解析測試都在跑
- 打包後的 exe 重新驗過一次

## 規則

- `src/clip/` 只允許為了 P0-1 的可見性覆寫做最小改動，其他邏輯不要動
- 不要為了讓測試過而放寬斷言
- 不要順手加沒被列在上面的功能
