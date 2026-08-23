# Stage 12 — 儲存進度、一鍵符合規範、LINE 貼圖組製作模式

三個新功能，依序做。**Stage 11（LINE 用途切換／縮放／FPS 滑條）已完成，本階段建立在它上面。**

---

# A. 儲存進度（多個工作狀態）

委託人原話：「可以儲存數個不同的當前工作狀態，方便來回修改」。

所以**不是**單純的「另存新檔／開啟舊檔」，而是**app 內部的具名快照清單**，
可以隨時切換回去比較。

## A1. 資料

```ts
export interface ProjectSnapshot {
  id: string                 // crypto.randomUUID()
  name: string               // 預設用 timestampName()（月日_時分），可改名
  createdAt: string          // ISO
  updatedAt: string
  clipPath: string           // 來源 .clip 的絕對路徑
  clipName: string           // 顯示用檔名
  thumbnail: string          // 第一格的 96px PNG，data URL，給清單顯示
  state: {
    slots: { layerId: number | null }[]
    visibility: Array<[number, boolean]>
    fps: number
    playCount: number
    format: 'apng' | 'gif'
    lineTarget: LineTarget
    exportWidth: number
    exportHeight: number
    lockAspect: boolean
    scaleMode: ScaleMode
    mergeIdentical: boolean
    zoom: number
    offsetX: number
    offsetY: number
  }
}
```

存在 `app.getPath('userData')/projects.json`（單一 JSON 陣列）。
主行程負責讀寫，IPC：

```
'project:list'   () => ProjectSnapshot[]
'project:save'   (snapshot: ProjectSnapshot) => ProjectSnapshot[]   // 新增或以 id 覆蓋
'project:delete' (id: string) => ProjectSnapshot[]
'project:rename' (id: string, name: string) => ProjectSnapshot[]
```

寫檔要**先寫暫存檔再 rename**，避免中途中斷把清單毀掉。
檔案讀不到或 JSON 壞掉時回空陣列並記警告，**不要 throw 讓 app 開不起來**。

## A2. UI

圖層面板上方（或匯出面板頂端，你判斷哪邊順手）加一個「**進度**」區塊：

- `儲存目前進度` 按鈕 → 跳出輸入框，預設名稱是 `timestampName()`，可改
- 已存進度清單：每列顯示 縮圖(48px) + 名稱 + 來源 .clip 檔名 + 更新時間
- 點一列 → 載入該進度（**若目前狀態與最後儲存不同，要先跳確認**）
- 每列右側：`覆寫` / `改名` / `刪除`（刪除要確認）
- 載入時若 `clipPath` 指向的檔案不存在 → 提示使用者重新選檔，
  選好後用新路徑套用同一份 state（**圖層 id 對不上時要跳警告而不是靜默排錯**）

清單為空時顯示一行說明，不要留空白區塊。

---

# B. 一鍵符合規範

委託人原話：「照著現有的影格，直接常態分配，平均 FPS 達到官方要求條件」。
情境（他的截圖）：4 格 / 0.20 秒 / 360×360 / 播放 1 次 → 三項全紅。
按下按鈕後應該直接變成合規狀態。

## B1. 演算法

放在 `src/codec/autofix.ts`，**純函式、可單獨測試**：

```ts
export interface AutoFixInput {
  target: LineTarget
  canvasWidth: number; canvasHeight: number     // 來源畫布，算建議尺寸用
  slots: { layerId: number | null }[]
  fps: number
  playCount: number
  exportWidth: number; exportHeight: number
  format: 'apng' | 'gif'
  /** 相鄰格是否相同（由呼叫端算好傳進來，autofix 不碰像素） */
  identicalToPrev: boolean[]
}
export interface AutoFixChange { label: string; from: string; to: string }
export interface AutoFixResult {
  slots: { layerId: number | null }[]
  fps: number
  playCount: number
  exportWidth: number; exportHeight: number
  format: 'apng' | 'gif'
  mergeIdentical: true
  changes: AutoFixChange[]
  /** 修不掉的項目（例如來源只有 1 種畫面） */
  unresolved: string[]
}
export function autoFixForLine(input: AutoFixInput): AutoFixResult
```

依序處理：

### 1. 格式
LINE 只收 APNG → `format = 'apng'`（原本是 gif 就記一筆 change）。

### 2. 尺寸
套用該 target 的規定尺寸：
- `emoji` → 180×180
- `main` → 240×240
- `sticker`（動態）→ `ratio = min(320/canvasW, 270/canvasH)`，等比四捨五入
- 靜態貼圖 target（若 Stage 12-C 有加）→ `ratio = min(370/canvasW, 320/canvasH)`

### 3. 幀數不足 → 來回播放（ping-pong）補足

**這是關鍵。** 實際 APNG 幀數 < 5 時，不能憑空捏造畫面，但可以把現有影格
**倒序接回去**產生合法且好看的來回動畫：

```
原本   [A, B, C, D]                → 4 幀
補完   [A, B, C, D, C, B]          → 6 幀（去頭去尾避免相鄰重複）
```

實作：反覆把 `slots.slice(1, -1).reverse()` 接到尾端，直到實際幀數 ≥ 5，
最多補到 20 幀。每次接完都要重新檢查**相鄰不得相同**（會被合併掉就白補了）。

- 只有 1 種畫面（所有格都一樣）→ **修不掉**，寫進 `unresolved`：
  `來源只有一種畫面，LINE 要求至少 5 個不同影格，請先在 CSP 多畫幾張`
- 只有 2 種畫面 → `[A,B]` → `[A,B,A,B,A]`… 這樣相鄰不重複且能到 5，可以做
- 補完後 > 20 幀 → 從尾端裁掉到 20

### 4. FPS 讓總長剛好落在 1／2／3／4 秒

```
N = 補完後的格數
候選 duration ∈ [1,2,3,4]
對每個 duration：fps = N / duration，只接受 1 ≤ fps ≤ 60 且 fps 為整數
從可行解中挑「與目前 fps 最接近」的那個
沒有整數解時，挑 fps = round(N/duration) 使實際總長最接近該秒數，
  並在 changes 註明實際總長（例如 6 格 → 1.00 秒 @ 6 FPS）
```

### 5. 播放次數
`playCount = max(1..4 中，使 duration × playCount ≤ 4 的最大值)`。
duration=1 → 4；duration=2 → 2；duration=3 → 1；duration=4 → 1。

### 6. 合併重複影格
強制 `mergeIdentical = true`。

## B2. UI

- 按鈕放在 **LINE 檢查結果區塊裡**，只在有 error 時出現，文案：`一鍵符合規範`
- 按下去**先跳確認對話框**，把 `changes` 逐條列出來：
  ```
  將套用以下調整：
    尺寸        360×360 → 270×270
    影格        4 格 → 6 格（來回播放）
    FPS         20 → 6
    播放次數    1 → 4
    格式        GIF → APNG
  ```
  有 `unresolved` 也要一起顯示，並說明按下去之後仍然不會完全合規
- 確認後套用，並顯示 toast 摘要
- **套用前自動存一個進度快照**（名稱 `一鍵符合規範前_<時間>`），這樣他反悔可以回去

## B3. 驗證（`npm run verify:codec` 追加）

```
[A,B,C,D] 4 格 / 20fps / 360×360 / sticker / playCount 1
  → slots 長度 6，順序 [A,B,C,D,C,B]
  → exportWidth/Height = 270×270
  → fps = 6，總長 1.00 秒
  → playCount = 4
  → unresolved 為空

[A,B] 2 格 → 補到 5 幀 [A,B,A,B,A]，相鄰皆不同
[A] 1 格   → unresolved 含「只有一種畫面」，slots 不變
[A..T] 20 格 → 不做 ping-pong，只調 fps 與尺寸
[A..Z] 26 格 → 裁到 20 幀，changes 要有一筆說明裁切
emoji target → 尺寸 180×180
main target  → 尺寸 240×240
```

---

# C. LINE 貼圖組製作模式

委託人已經有一整組做好的貼圖（32 張 370×320 + main.png 240×240 + tab.png 96×74），
需要能整組管理並打包。

## C1. 新增「靜態貼圖」target

`src/codec/line.ts` 的 `LineTarget` 加一個 `'staticSticker'`：

| 項目 | 值 |
|---|---|
| label | `一般貼圖` |
| 尺寸 | 最大 **370×320**（`fixedSize: null`，無 minLongSide） |
| 張數 | 8 / 16 / 24 / 32 / 40 |
| 單張 | ≤ 1 MB |
| 格式 | **靜態 PNG**（不是 APNG） |
| 尺寸需為偶數 | 是，奇數要給 warning |

各 target 的張數選項（打包用）：

```
staticSticker : [8, 16, 24, 32, 40]
sticker(動態) : [8, 16, 24]
emoji         : [8, 16, 24, 32, 40]   // 官方 8～40
```

## C2. 模式切換

App 最上方加一個模式切換：`單張動畫` / `貼圖組`。
`單張動畫` 就是現在的畫面，完全不變。

## C3. 貼圖組畫面

```
┌ 貼圖組 ────────────────────────────────────────────┐
│ 類型 [一般貼圖 ▾]   張數 [32 ▾]      [ 匯入資料夾 ] │
├────────────────────────────────────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                       │
│  │ 01 │ │ 02 │ │ 03 │ │ 04 │   ← 4 欄網格          │
│  └────┘ └────┘ └────┘ └────┘                       │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                       │
│  │ 05 │ │ 06 │ │ 07 │ │ 08 │                       │
│  └────┘ └────┘ └────┘ └────┘                       │
│         …（依張數展開）                             │
│  ┌────┐ ┌────┐                                     │
│  │main│ │ tab│   ← 兩個固定格，尺寸不同要標出來     │
│  └────┘ └────┘                                     │
├────────────────────────────────────────────────────┤
│ 已完成 32 / 32ㅤmain ✓ㅤtab ✓ㅤ總計 2.1 MB          │
│ [ 打包成 ZIP ]  [ 全部輸出 GIF ]                    │
└────────────────────────────────────────────────────┘
```

- **4 欄網格**，每格正方形，內容等比置中
- 每格狀態：
  - `空` → 灰底斜線 + 編號
  - `已填` → 顯示縮圖 + 編號 + 尺寸小字；不符規格時邊框轉紅並顯示原因
  - 動態貼圖模式下，已填的格子若是多幀，右下角標一個小小的 `▶ N 幀`
- `main` 格標 `240×240`，`tab` 格標 `96×74`
- 每格可**拖放 PNG/APNG 檔案**直接匯入
- 每格右鍵：`從檔案匯入` / `用目前的動畫填入` / `清除` / `另存這一格`
- 點格子 → 展開該格的預覽（動態的話會播放），並提供 `用單張動畫編輯器編輯` 按鈕
  （切回單張動畫模式，編輯完可以 `回填到第 N 格`）

## C4. 匯入資料夾

`匯入資料夾` 按鈕：選一個資料夾，自動比對檔名填入：

- `01.png` ~ `40.png`（含 `1.png` 這種沒補零的也要吃）→ 對應編號格
- `main.png` → main 格
- `tab.png` → tab 格
- **檔名不符規則的檔案要列出來讓使用者知道被跳過了**，不要靜默忽略
  （委託人的資料夾裡就有一個 `29_3.png`）
- 匯入後立刻對每張跑規格檢查，不符的格子標紅

## C5. 打包

`打包成 ZIP`：

- 用 `jszip`（加進 dependencies）產生 ZIP，**不要自己手刻 ZIP 格式** ——
  這個檔案要直接上傳 LINE，正確性優先
- 內容：`01.png` … `NN.png`（**兩位數補零**）+ `main.png` + `tab.png`
- 靜態貼圖：每格輸出**單幀 PNG**；動態貼圖／表情貼：輸出 APNG
- 存檔對話框預設檔名 `<timestampName()>_stickers.zip`
- 打包前**必須全部通過檢查**，有問題就列出來並詢問是否仍要打包
- 打包後顯示：檔案路徑、ZIP 大小、張數

`全部輸出 GIF`：選一個資料夾，把每格輸出成 `01.gif`…，main/tab 仍輸出 PNG，
並提示 GIF 不能上傳 LINE、只適合預覽或其他平台。

## C6. 貼圖組要能存進進度快照

`ProjectSnapshot` 加上：

```ts
pack?: {
  target: LineTarget
  count: number
  cells: Array<{ index: number | 'main' | 'tab'; sourcePath?: string; pngBase64?: string }>
}
```

格子內容如果是從檔案匯入的，優先記 `sourcePath`（省空間），
檔案不見時才 fallback 到內嵌的 base64。**是從編輯器填入的一律內嵌。**

---

# 驗證

## `npm run verify:codec` 追加

- B3 那整組 autofix 測試
- `staticSticker` 的 `validateForLine`：
  - 370×320 → 無 error
  - 380×320 → 尺寸 error
  - 371×320 → 偶數 warning
  - 張數 30 → error（只接受 8/16/24/32/40）

## `npm run smoke` 追加

1. 切到 `貼圖組` 模式，類型選 `一般貼圖`、張數 32
2. 用 `project:importFolder` 匯入一個**測試用資料夾**
   （smoke 自己產生 32 張 370×320 的純色 PNG + main 240×240 + tab 96×74，
   **不要依賴委託人的素材**，那些不在 repo 裡）
3. 斷言 32 格全滿、main/tab 都有、檢查無 error
4. 打包成 ZIP 到 `out/smoke/pack.zip`
5. **用 `jszip` 重新讀回那個 ZIP**，斷言：
   - 檔案清單剛好是 `01.png`…`32.png` + `main.png` + `tab.png`（34 個）
   - 每個 entry 解出來的 PNG 尺寸正確
6. 存一張 `out/smoke/ui-pack.png`
7. 一鍵符合規範：把單張動畫設成 4 格 / 20fps / 360×360 / playCount 1，
   按下按鈕 → 斷言變成 6 格 / 6fps / 270×270 / 4 次，且 `validateForLine` 無 error，
   存 `out/smoke/ui-autofix.png`
8. 進度快照：存一個 → `project:list` 有 1 筆 → 改動 fps → 載入回來 → 斷言 fps 還原

---

# D. 修掉 smoke 的測試狀態殘留（第二次了）

`out/smoke/ui-emoji.png` 裡播放列顯示 `1 FPS`，LINE 檢查跳
「總播放 20 秒 × 4 次 = 80 秒，超過 LINE 上限 4 秒」——
因為 `scripts/smoke.ts:366` 的 FPS 下界測試把 `fps` 設成 1 之後**沒有還原**，
後面每一張截圖都帶著這個狀態。

Stage 11 才剛修過同一類問題（可見性測試沒還原），現在又發生一次。
**要從機制上解決，不要再逐一補。**

## 做法

在 smoke 裡加一個包裝函式，所有「會改動 store 的子測試」一律用它包起來：

```ts
async function withStore<T>(fn: () => Promise<T>): Promise<T> {
  const before = await snapshotStore()   // 透過 __smoke 取整份 state 的可序列化副本
  try {
    return await fn()
  } finally {
    await restoreStore(before)           // 還原並 waitIdle()
  }
}
```

把 FPS 邊界、可見性切換、格數增減、LINE 用途切換、縮放位移這些子測試全部包進去。

再加一道**保險斷言**：每次 `capturePage()` 之前，先檢查目前 state 與該截圖預期的
關鍵欄位一致（至少 `fps`、`exportWidth/Height`、`lineTarget`、`playCount`），
不一致就 fail 並印出實際值。這樣下次再有人漏還原會直接紅燈，而不是產出一張
看起來怪怪的截圖。

`ui-emoji.png` 要重拍，且畫面上必須是**合規**狀態（表情貼 180×180、幀數與秒數都過）。

---

# 規則

- 不要改 `src/clip/` 的邏輯
- 現有所有斷言都必須繼續通過
- 不要為了讓測試過而放寬斷言
- 最後跑 `npm run format:check`、`npm run typecheck`、`npm run verify:all`、`npm run smoke`
- **不要跑 `npm run dist`**，打包我另外做
