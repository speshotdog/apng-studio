# Stage 11 — LINE 用途切換（貼圖／表情貼／主圖）＋ 畫面縮放微調

委託人回饋兩件事：

1. LINE 除了**動態貼圖**還有**動態表情貼**，兩者規格不同，工具要都支援
2. 不同比例的輸出尺寸會留白，需要能**手動放大整體圖片並微調位置**才貼合需求

---

## 1. LINE 用途與規格（依官方指南）

來源：
- 動態貼圖 https://creator.line.me/zh-hant/guideline/animationsticker/
- 動態表情貼 https://creator.line.me/zh-hant/guideline/animationemoji/

| 項目 | 動態貼圖 sticker | 動態表情貼 emoji | 主要圖片 main |
|---|---|---|---|
| 尺寸 | 最大 320×270，**寬或高至少一邊 = 270** | **固定 180×180** | **固定 240×240** |
| 幀數 | 5–20 | 5–20 | 5–20 |
| 單次播放 | 1／2／3／4 秒 | ≤ 4 秒 | 1／2／3／4 秒 |
| 播放次數 | 1–4，且 秒數×次數 ≤ 4 秒 | 1–4，且總計 ≤ 4 秒 | 1–4，總計 ≤ 4 秒 |
| 檔案大小 | ≤ 1 MB | **≤ 300 KB** | ≤ 1 MB |
| 格式 | APNG（副檔名 `.png`）、RGB、透明背景 | 同左 | 同左 |
| 聊天縮圖 | 96×74 | 96×74 | — |
| 每組張數 | 8／16／24 | 8–40 | — |

### `src/codec/line.ts` 改法

```ts
export type LineTarget = 'sticker' | 'emoji' | 'main'

export interface LineTargetSpec {
  label: string                      // '動態貼圖' / '動態表情貼' / '主要圖片'
  /** 固定尺寸；null 表示用 maxWidth/maxHeight + minLongSide 判斷 */
  fixedSize: { width: number; height: number } | null
  maxWidth: number
  maxHeight: number
  minLongSide: number | null
  maxFileBytes: number
  minFrames: number
  maxFrames: number
  allowedDurationsSec: number[] | null   // emoji 沒有「只能 1/2/3/4 秒」的限制，用 null
  maxTotalDurationSec: number
  allowedPlayCounts: number[]
  note: string                        // 顯示在 UI 的一行說明（張數等）
}

export const LINE_TARGETS: Record<LineTarget, LineTargetSpec>
export const LINE_CHAT_THUMB = { width: 96, height: 74 }

export function validateForLine(input: {
  target: LineTarget
  width: number; height: number
  plan: ApngPlan
  numPlays: number
  format: 'apng' | 'gif'
  byteLength?: number
}): LineIssue[]
```

- `fixedSize` 不為 null 時，尺寸不符就是 **error**，訊息要講清楚該用多少
  （例：`動態表情貼必須是 180×180，目前 270×270`）
- `maxFileBytes` 依用途變動，訊息要帶實際 KB 與上限 KB
  （例：`檔案 412 KB 超過動態表情貼上限 300 KB`）
- `allowedDurationsSec` 為 null 時不檢查「只能 1/2/3/4 秒」，但仍檢查總長 ≤ 4 秒
- 保留既有的「實際幀數 5–20」「全部影格相同」「背景不透明」檢查
- `format === 'gif'` 時整份檢查跳過，回傳一則 info 說明 LINE 只收 APNG
  （沿用 Stage 9 已做的行為）

**檔案大小是唯一要等匯出後才知道的項目**，所以匯出完成後要把
`byteLength` 帶回去重跑一次檢查並顯示結果 —— 表情貼 300KB 很容易超，
這一項一定要在匯出後明確告訴使用者過了沒有。

---

## 2. 畫面縮放微調

現在 `composeFrame()` 一律等比置中「符合」（contain）。畫布 360×360 轉成
貼圖 320×270 時上下會留白，委託人需要手動放大與位移。

### store 新增

```ts
zoom: number      // 1 = 剛好符合(contain)，預設 1，範圍 0.2–4
offsetX: number   // 以輸出畫布像素為單位，預設 0
offsetY: number
```

### `composeFrame` 改法

```
baseScale  = min(width / bitmap.width, height / bitmap.height)   // 原本的 contain
finalScale = baseScale * zoom
drawW = bitmap.width  * finalScale
drawH = bitmap.height * finalScale
x = (width  - drawW) / 2 + offsetX
y = (height - drawH) / 2 + offsetY
```

- `zoom = 1`、`offset = 0` 時結果必須與現在**完全相同**（不可改變既有行為）
- 超出輸出畫布的部分自然被裁掉
- 預覽與匯出共用同一個函式，所見即所得

### UI：匯出面板新增「畫面調整」區塊

放在「輸出尺寸」下面：

- **縮放**：滑桿（20%–400%）＋數字輸入，顯示百分比
- **位移 X／Y**：兩個數字輸入，單位 px，可為負
- 三顆快捷：
  - `符合` → zoom=1, offset=0（等比縮到完整放得下，會留白）
  - `填滿` → zoom = max(width/bitmapW, height/bitmapH) / baseScale，offset=0
    （等比放大到填滿整個輸出畫布，超出的裁掉）
  - `重設` → 同「符合」
- 滑桿拖動時預覽要即時跟著變（`composeFrame` 很輕，但仍要確認不卡）

### 預覽區：顯示輸出邊界

預覽已經是用輸出尺寸渲染，但使用者看不出來哪裡會被裁掉。
在預覽 canvas 外圍加一條**細的實線外框**代表輸出畫布邊界，
並在下方標示目前的輸出尺寸與縮放百分比（例：`270 × 270ㅤ縮放 135%`）。

---

## 3. 尺寸快捷按鈕改成跟著用途走

原本的「原始尺寸／LINE 貼圖／主圖 240」三顆改成：

- 先有一組 **LINE 用途** 分段控制：`動態貼圖` / `動態表情貼` / `主要圖片`
  （store 新增 `lineTarget: LineTarget`，預設 `'sticker'`）
- 切換用途時**自動套用該用途的建議尺寸**：
  - sticker → `ratio = min(320 / canvasW, 270 / canvasH)`，等比縮放後四捨五入
  - emoji → 180×180
  - main → 240×240
- 另外保留一顆 `原始尺寸`
- 切到固定尺寸（emoji／main）且畫布不是正方形時，`鎖定比例` 會打架 ——
  這種情況要自動關閉鎖定比例，並提示使用者用「畫面調整」的縮放與位移來構圖

---

## 3.5 FPS 改成滑條 + 數字輸入

現在 FPS 只有一個數字輸入框，要一格一格點或全選重打，很難「拉著找手感」。
委託人要的是能快速拖、也能精準輸入。

### 改法

FPS 那格改成 **滑桿 + 數字輸入並排**：

- 滑桿範圍 **1–60**，step 1
- 右邊數字輸入框同步（範圍一樣 1–60，超出就夾住）
- 兩者雙向綁定：拖滑桿→數字跟著變，打數字→滑桿跟著動
- 滑桿下方標出**常用值刻度**：`8 / 12 / 15 / 20 / 24 / 30`，點刻度直接跳過去
  （用 `<datalist>` 或自己畫小刻度都可以，要能點）
- **拖動時預覽要即時反映新的播放速度**，不要等放開滑鼠才更新
  （這是「拉著找手感」的重點，`fps` 改變只影響 delay，不需要重新合成像素）
- 旁邊即時顯示換算結果：`20 FPS ㅤ每格 50 ms`
- 若目前有 LINE 用途且該用途限制秒數，滑桿上把**會讓總長剛好落在 1/2/3/4 秒的
  FPS 值**標成綠色刻度（例：20 格時間軸 → 20 FPS 剛好 1 秒）。
  這能讓他一眼找到合規的值，不用自己算。

### 驗證（加進 smoke）

- 拖滑桿到 12 → 斷言 `store.fps === 12` 且統計面板的「單次總長」跟著變
- 數字框輸入 99 → 斷言被夾成 60；輸入 0 → 斷言被夾成 1
- 斷言滑桿與數字框顯示的值永遠一致

---

## 4. README 更新

- LINE 規格速查表改成**貼圖／表情貼／主圖三欄對照**
- 新增一小段講「畫面調整」：什麼時候會用到（畫布比例和目標尺寸不同時），
  `符合` 與 `填滿` 的差別，以及可以用位移微調構圖
- 用委託人看得懂的話寫，不要講 baseScale 這種詞

---

## 5. 驗證

### `npm run verify:codec` 追加

- 三種 target 各自的 `validateForLine`：
  - emoji 給 270×270 → 必須有尺寸 error，訊息含 `180×180`
  - emoji 給 180×180 + 6 幀 + 1 秒 + 4 次 + 250KB → **無 error**
  - emoji 給 180×180 但 `byteLength = 400 * 1024` → 必須有檔案大小 error，訊息含 `300`
  - main 給 240×240 合規 → 無 error
  - sticker 給 320×270 合規 → 無 error
  - sticker 給 200×180（兩邊都 < 270）→ 必須有 `minLongSide` error

### `npm run smoke` 追加

1. `zoom = 1, offset = 0` 時 `composeFrame` 的輸出必須與本次改動前**逐 byte 相同**
   （先在改動前存一份基準，或直接斷言「zoom=1 的結果 === 用舊公式算出的結果」）
2. 設 `zoom = 2` → 斷言非透明像素數**增加**
3. 設 `zoom = 0.5` → 斷言非透明像素數**減少**
4. 設 `offsetX = 100` → 斷言影像重心明顯右移
   （算非透明像素的平均 x 座標，必須比 offset=0 時大）
5. 切到 `emoji` → 斷言輸出尺寸變成 180×180
6. 切到 `main` → 斷言變成 240×240
7. 存一張 `out/smoke/ui-emoji.png`（表情貼 180×180、zoom 放大後的構圖，
   畫面上要看得到 LINE 檢查通過或明確的錯誤）

---

## 5.5 順手修：smoke 的測試狀態殘留

`out/smoke/ui-timeline.png` 裡預覽是空的、第 1 格縮圖也是空的 —— 因為前面
「切換圖層可見性」那段測試把 cel `1` 取消勾選之後**沒有還原**，後續所有截圖都
帶著這個殘留狀態。

修法：可見性測試結束後把勾選狀態改回來（再 click 一次或直接還原 store 的
`visibility`），並確認 `waitIdle()` 之後預覽有重新畫出來。
之後的每一張截圖都必須是乾淨狀態。

加一條斷言：`ui-timeline.png` 截圖前，預覽 canvas 的非透明像素數必須 > 0。

---

## 6. 規則

- 不要改 `src/clip/` 的邏輯
- `zoom=1 / offset=0` 必須與現行行為完全一致，這是回歸底線
- 現有所有斷言都要繼續通過
- 最後跑 `npm run format:check`、`npm run typecheck`、`npm run verify:all`、
  `npm run smoke`、`npm run dist`
