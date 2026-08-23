# Stage 15 — 驗收後修正

來源：`.codex-tasks/acceptance-report.md`（你自己的驗收）＋ 另一輪獨立審查。
兩邊重疊的項目優先。

---

## P1 — 切換輸出目標的狀態污染（根因只有一個）

兩份審查各自從不同角度撞到同一件事：

- 驗收報告：`Twitch 動態表情` 會把 `fps` 夾到 30、`playCount` 設成 0（無限），
  切回 `LINE 動態貼圖` 時這兩個值**沒有恢復**，LINE 檢查直接跳不合規
- 另一輪審查：`噗浪表情` 會把 `zoom` 設成「填滿」的值，切到別的目標時
  **也沒有恢復**。用 360×360 的正方形畫布測不出來（填滿＝符合＝1），
  但畫布只要不是正方形（例如 400×300）zoom 就會變成 1.33 並跟著跑走

根因：`ExportPanel.selectTarget()` 是**部分覆蓋**——每個分支只設自己在意的欄位，
沒設到的就沿用上一個目標的值。

### 改法：每個目標記住自己的設定

不要只做「重設成預設值」，那樣使用者在 LINE 調好的構圖，去 Twitch 繞一圈回來也會不見。
改成**每個目標各自保存一份設定**：

```ts
// store 新增
type TargetSettings = Pick<
  State,
  'format' | 'exportWidth' | 'exportHeight' | 'lockAspect' | 'fps' | 'playCount'
        | 'zoom' | 'offsetX' | 'offsetY' | 'scaleMode' | 'staticFrame' | 'gifColors'
>
targetSettings: Partial<Record<ExportTarget, TargetSettings>>
```

`selectTarget(next)` 的流程：

1. 把**目前**這些欄位存進 `targetSettings[目前的 target]`
2. 若 `targetSettings[next]` 已存在 → 直接套用它
3. 若不存在 → 用該目標的**完整預設值**（見下），不是部分覆蓋

每個目標的完整預設值必須把上面**所有欄位都寫滿**，不可以留給前一個目標決定：

| 目標 | format | 尺寸 | fps | playCount | zoom/offset |
|---|---|---|---|---|---|
| LINE 動態貼圖 | apng | `min(320/w,270/h)` 等比 | 沿用文件 frameRate 或 12 | 4 | 1 / 0,0 |
| LINE 動態表情貼 | apng | 180×180 | 同上 | 4 | 1 / 0,0 |
| LINE 一般貼圖 | png | `min(370/w,320/h)` 等比 | — | 1 | 1 / 0,0 |
| LINE 主要圖片 | apng | 240×240 | 同上 | 4 | 1 / 0,0 |
| 噗浪表情 | gif | 48×48 | 同上 | 0（無限） | **填滿值** / 0,0 |
| Twitch 動態 | gif | 112×112 | `min(30, 目前)` | 0（無限） | 1 / 0,0 |
| Twitch 靜態 | png | 112×112 | — | 1 | 1 / 0,0 |
| YouTube 會員 | png | 48×48 | — | 1 | 1 / 0,0 |

`staticOnly` 的目標另外把 `staticFrame` 設成目前的 `playhead`。

### 驗證（smoke）

```
開 11.clip → LINE 動態貼圖，記下 fps/playCount/zoom/尺寸
→ 切 Twitch 動態（斷言 fps ≤ 30、playCount = 0）
→ 切 YouTube（斷言 format = png、staticFrame 有值）
→ 切回 LINE 動態貼圖
→ 斷言 fps/playCount/zoom/尺寸 與最初完全相同
→ 斷言 validateForLine 沒有因為切換而多出 error
```

再加一組非正方形畫布的測試（smoke 自己造一個 400×300 的假畫布狀態即可）：
```
切噗浪 → zoom 變成填滿值(>1) → 切回 LINE 動態貼圖 → 斷言 zoom === 1
```

---

## P2 — 「上傳到 GIPHY」按鈕狀態自相矛盾

驗收報告：沒有金鑰時按鈕仍是可按的樣子，title 卻寫「請先到設定填入 GIPHY API Key」，
點下去是開設定頁。看起來像是會上傳，其實不會。

### 改法

不要用 disabled（disabled 的按鈕沒辦法點去設定頁，反而更難用）。
改成**按鈕本身換文案與樣式**：

- 有金鑰 → `上傳到 GIPHY`，主要按鈕樣式
- 沒金鑰 → `設定 GIPHY 金鑰`，次要／外框樣式，點了開設定頁
- 兩種狀態的 title 各自對應，不要留下矛盾的說明

`settings:get` 已經有回 `hasGiphyKey`，renderer 訂閱它即可。
設定頁存好金鑰後要**立即反映**到這顆按鈕，不用重開程式。

---

## P2 — 確認對話框認錯平台

`ExportPanel.tsx` 第 126 行附近：

```ts
`${lineTarget === 'plurkEmoticon' ? '噗浪' : 'LINE'} 規格檢查有 ${errors.length} 項錯誤，仍要匯出嗎？`
```

選 Twitch 或 YouTube 目標時會顯示「LINE 規格檢查…」，平台名稱是錯的。

### 改法

`ExportTargetSpec` 加一個 `platform: string` 欄位（`'LINE'` / `'噗浪'` / `'Twitch'` / `'YouTube'`），
所有顯示平台名稱的地方一律讀它。檢查一下還有沒有別處也寫死了 `LINE`
（例如檢查區標題「LINE 規格檢查」、通過訊息「符合 LINE 動態貼圖規格」）。

---

## P2 — 進度快照漏存欄位

`ProjectSnapshot.state` 目前缺 **`staticFrame`** 與 **`gifColors`**。

存了 YouTube 的設定（要輸出第幾格）再載回來，那個選擇會掉。

### 改法

補進 `src/project/types.ts` 的 `state`，並確認存檔／讀檔兩端都有處理。
**順便加一道防呆**：讀舊版快照缺欄位時用預設值補上，不要 crash。

### 驗證

smoke：切到 YouTube → 選第 3 格 → 存快照 → 改成第 1 格 →
載回快照 → 斷言 `staticFrame === 2`（0-based）與 `gifColors` 一併還原。

---

## P3 — `gifDither` 是死欄位

Stage 9 移除抖色 UI 與 `GifOptions.dither` 時，`store.ts` 的 `gifDither` 沒清掉。
grep 全專案只有宣告（`store.ts:33`）與初始化（`store.ts:74`），沒有任何地方讀它。

（驗收報告寫「GIF 抖色的狀態傳遞有接線」，這一點與實際不符，以 grep 結果為準。）

### 改法
刪掉 `gifDither`。連帶檢查還有沒有其他同類孤兒欄位。

---

## P3 — smoke 的 Twitch 輸出目錄會累積

`out/smoke/twitch/` 已經堆了 12 個檔（每跑一次多三個，檔名帶時間戳）。

### 改法
smoke 開始時先清空 `out/smoke/twitch/`，避免看不出哪些是本次產生的。
順便檢查其他輸出目錄有沒有同樣問題。

---

## 補：驗收報告點名「沒有實際證據」的路徑

驗收報告誠實標記了這些沒驗到，要補進 smoke：

1. **開一個壞掉的 .clip** —— 拿 `assets/samples/11.clip` 的前 5000 bytes 存成暫存檔去開，
   斷言：跳出可讀的錯誤訊息、**app 沒有白畫面**、原本開著的文件不受影響
2. **匯入空資料夾** —— 斷言提示「沒有找到符合命名規則的圖片」之類的訊息，不是靜默無反應
3. **貼圖組留空格時打包** —— 斷言會列出哪幾格是空的並要求確認
4. **假金鑰測試連線** —— 用可注入的假 fetch 回 401，斷言錯誤訊息含「金鑰無效」
5. **極端值**：格數 1、格數 120、zoom 20%、zoom 400%、FPS 1、FPS 60
   —— 每一個都斷言不會出現 NaN、不會除以零、預覽 canvas 仍畫得出來
   （檢查 `canvas.width > 0 && !Number.isNaN(...)`）

這些是**交付前的最低驗收線**，不要略過。

---

## 完成條件

```
npm run format:check
npm run typecheck
npm run verify:all
npm run smoke
```

全過，且新增的斷言都確實在跑。

## 規則

- 不要改 `src/clip/` 的邏輯
- 不要為了讓測試過而放寬斷言
- 修完之後**更新 `.codex-tasks/acceptance-report.md`**，
  在每一項後面註明已修正／未修正與原因
- 不要跑 `npm run dist`
