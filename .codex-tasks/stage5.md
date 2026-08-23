# Stage 5 — 冒煙測試的缺口與 UI 修正

Stage 4 的 `npm run smoke` 會過，截圖也確實是真的畫面（羊、6 個 cel、延續格紅虛線、
統計 8→6 都對）。匯出的 APNG 也驗過是對的：

```
IHDR 360×360 RGBA / acTL (num_frames=6, num_plays=2)
delays = [50, 50, 100, 100, 50, 50]   ← 第 3+4 格、第 5+6 格各自合併
99,755 bytes
```

但有三個實際問題要修。

---

## 1. `ui-inherit.png` 跟 `ui-main.png` 完全一樣（bug）

```
e810849312b601ac5c8e67718872a051 *ui-main.png
e810849312b601ac5c8e67718872a051 *ui-inherit.png
```

md5 相同 → **步驟 6「把 playhead 移到第 4 格」根本沒生效**，或是 `capturePage()`
在畫面重繪前就拍了。這張截圖現在沒有任何驗證價值。

修法：
- 確認移動 playhead 真的有透過 store 觸發（不是只改了變數沒觸發 re-render）
- 拍照前等實際重繪完成（`requestAnimationFrame` 兩次 + `webContents` 的
  `did-frame-finish-load` 之類，或直接輪詢畫面 hash 直到改變）
- **在 smoke 裡加一條斷言：`ui-inherit.png` 與 `ui-main.png` 的 bytes 必須不同**，
  相同就 fail。以後才不會再默默退化。
- 同時斷言「第 4 格被選取時，預覽畫出來的像素跟第 3 格相同」
  （這才是真正在驗『延續』行為）

---

## 2. 匯出面板底部被切掉

截圖裡（視窗 1568×922）「LINE 規格檢查」下面的檢查結果條列和「匯出」按鈕被視窗底部
切掉，只露出一點點。視窗縮到規格的最小尺寸 1024×640 會更嚴重。

修法：
- 匯出面板（右欄）內容區加 `overflow-y: auto`，讓它自己捲動
- **「匯出」按鈕固定在面板底部**（sticky / flex 尾端），不要跟著捲走 —— 這是主要動作
- LINE 檢查結果區在沒有任何問題時要顯示綠色「符合 LINE 動態貼圖規格」，
  現在截圖看起來是一條空白條，確認一下是不是根本沒渲染
- 左邊圖層面板與中間影格軌同樣檢查一次：視窗縮到 1024×640 時不能有內容被切掉且無法捲到

改完把 smoke 的視窗尺寸改成 **1024×640**（最小尺寸）再截一次，
確保在最壞情況下匯出按鈕仍然看得到。另外多存一張 `out/smoke/ui-small.png`。

---

## 3. 圖層樹最上面顯示「未命名圖層」

根資料夾（`MainId 2`）本身沒有名字，不該當成一個可勾選的圖層列出來。

修法：**不要渲染根節點那一列**，直接把它的子節點當成頂層顯示。
（`紙張`、`圖層 1`、`資料夾 1` 三個變成第一層，縮排少一級。）

---

## 完成條件

```
npm run typecheck
npm run verify:all
npm run smoke
```

全過，且 `out/smoke/` 有 `ui-main.png`、`ui-inherit.png`、`ui-small.png`、`export.png`，
其中 `ui-main.png` 與 `ui-inherit.png` **必須不同**。

截完圖自己看過三張，確認：
- 圖層樹頂層是 `紙張 / 圖層 1 / 資料夾 1`，沒有「未命名圖層」
- `ui-small.png`（1024×640）裡「匯出」按鈕完整可見
- `ui-inherit.png` 的 playhead 停在第 4 格，且預覽內容與第 3 格相同

## 規則

- 不要改 `src/clip/`、`src/codec/` 的邏輯
- 不要為了讓測試過而放寬斷言
