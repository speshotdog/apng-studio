# Stage 14 — Twitch 與 YouTube 會員表情

**Stage 13（設定頁／GIPHY／噗浪）已完成，本階段建立在它上面。**

兩個新平台，各有一個**跟現有架構不同**的地方，先看清楚再動手。

---

# A. Twitch 表情

## A1. 規格（查證來源見下）

| 項目 | 靜態 | 動態 |
|---|---|---|
| 尺寸 | **28×28、56×56、112×112 三種都要** | 同左，三種都要 |
| 格式 | PNG | **GIF**（不接受 APNG） |
| 檔案大小 | **每張 < 25 KB** | 每張 ≤ 1 MB |
| 幀數 | — | **≤ 60 幀** |
| 影格率 | — | **≤ 30 FPS** |
| 資格 | 所有人 | 僅 Affiliate / Partner |

參考：
- https://help.twitch.tv/s/article/emote-guide
- 動態表情為循環 GIF，三種尺寸皆需提供

## A2. 跟現有架構的差異：一個目標要輸出三個檔

現在所有 target 都是「一個設定 → 一個檔案」。Twitch 是「一個設定 → 三個檔案」。

新增一個概念：**`multiSize` target**。

```ts
export interface ExportTargetSpec {
  // …既有欄位
  /** 有值時代表這個目標需要同時輸出多種尺寸 */
  multiSize?: { width: number; height: number; suffix: string }[]
}
```

`twitchEmoteAnimated` / `twitchEmoteStatic` 的 `multiSize` 都是：
```
[{ 28, 28, '28' }, { 56, 56, '56' }, { 112, 112, '112' }]
```

匯出時：
- 按鈕文案改成 `匯出 Twitch 表情（3 個尺寸）`
- 對每個尺寸各跑一次 `composeFrame` + 編碼
- 存檔對話框選**資料夾**（不是單一檔案），輸出
  `<timestampName()>_28.gif`、`_56.gif`、`_112.gif`
- 也提供 `打包成 ZIP` 一鍵（內含三個檔）
- 結果面板要**逐尺寸列出**檔名與大小，並各自標示是否通過大小限制：
  ```
  ✓ 0823_1612_28.gif    12.4 KB
  ✓ 0823_1612_56.gif    38.1 KB
  ✗ 0823_1612_112.gif  1.24 MB  超過 1 MB
  ```

## A3. 25 KB 很緊 → 自動減色

靜態 Twitch 表情每張要 < 25 KB。112×112 的 PNG 通常還好，但保險起見：

- 輸出後若超過限制，**自動嘗試減色重壓**：
  256 → 128 → 64 → 32 色，取第一個過關的
- 減色後仍超過 → 回報實際大小並建議「簡化畫面或減少幀數」
- 有做減色要在結果面板註明：`已自動減色至 64 色以符合 25 KB 限制`

動態 GIF 超過 1 MB 時同理（先減色，再考慮建議減幀）。

## A4. 幀數與 FPS 檢查

- 實際幀數 > 60 → error：`Twitch 動態表情最多 60 幀，目前 72 幀`
- FPS > 30 → error：`Twitch 要求 30 FPS 以下，目前 60 FPS`
- 這兩項要能被「一鍵符合規範」修掉（裁到 60 幀、FPS 夾到 30）

---

# B. YouTube 會員表情

## B1. 規格

| 項目 | 值 |
|---|---|
| 尺寸 | **48×48 建議**，最大 480×480 |
| 格式 | **靜態 PNG 或 JPEG** |
| 檔案大小 | < 1 MB |
| 動態 | **不支援** —— 上傳 GIF 會被壓成單一張 |
| 顯示 | 手機 24×24、桌機 48×48 |

參考：https://support.google.com/youtube/answer/7544492

## B2. 跟現有架構的差異：這是靜態輸出

現在整個 app 的輸出路徑都假設是動畫。YouTube 目標必須走**單張靜態**。

新增 `ExportTargetSpec.staticOnly?: boolean`。

`staticOnly` 為真時：

1. 格式選擇器鎖成 `PNG`（把 APNG/GIF 兩顆換成一顆 `PNG`，並停用）
2. 匯出面板多一個 **`要輸出哪一格`** 選擇器：
   - 預設 = 目前 playhead 那一格
   - 下拉選單列出所有格子（顯示編號 + cel 名稱），選了預覽要跟著跳過去
   - 旁邊一顆 `用目前這格`
3. 播放次數、FPS、合併重複影格這幾項**整區隱藏**（對靜態沒有意義）
4. 統計面板改成顯示：`輸出第 N 格`、`尺寸`、`預估大小`
5. 匯出時只編碼那一格 → 單張 PNG（用現有的 `src/codec/png.ts`，
   不要走 APNG 組裝器）

## B3. 尺寸快捷

- `48 × 48（建議）`
- `480 × 480（最大）`
- 自訂值需在 48–480 之間，超出給 error

---

# C. 輸出目標選單改成分組

現在有 8 個目標，橫向按鈕排不下。改成 **`<select>` + `<optgroup>`**：

```
LINE
  動態貼圖          320×270（長邊 270）
  動態表情貼        180×180
  一般貼圖          370×320（靜態）
  主要圖片          240×240
噗浪
  表情              48×48
Twitch
  動態表情          28/56/112 三尺寸 GIF
  靜態表情          28/56/112 三尺寸 PNG
YouTube
  會員表情          48×48 靜態 PNG
```

- 選單旁邊顯示該目標的一行規格摘要（上面右欄那些字）
- 切換目標時自動套用該目標的尺寸／格式／相關預設值
- 目標的完整規格（幀數、大小上限、資格限制等）顯示在檢查區上方的一行說明，
  例如 Twitch 動態要標 `僅 Affiliate / Partner 可上傳動態表情`

---

# 驗證

## `npm run verify:codec` 追加

```
twitchEmoteAnimated:
  60 幀 / 30fps / 1MB 內        → 無 error
  72 幀                         → 幀數 error，訊息含 60
  60fps                         → FPS error，訊息含 30
  單檔 1.2MB                    → 大小 error
  multiSize 必須是 28/56/112

twitchEmoteStatic:
  30KB → 大小 error，訊息含 25
  20KB → 無 error

youtubeEmoji:
  48×48 靜態 / 500KB            → 無 error
  48×48 但 format 'apng'        → 格式 error，訊息含「靜態」
  600×600                       → 尺寸 error，訊息含 480
  32×32                         → 尺寸 error（低於 48）

autofix：
  Twitch 動態 72 幀 / 60fps → 修成 60 幀 / 30fps
```

## `npm run smoke` 追加

1. 切到 `Twitch 動態表情` → 斷言 `multiSize` 生效、格式鎖成 GIF
2. 匯出到 `out/smoke/twitch/`，斷言產生三個檔且尺寸分別是 28/56/112
   （自己掃 GIF 的 Logical Screen Descriptor 驗尺寸）
3. 斷言三個檔都 ≤ 1 MB
4. 切到 `YouTube 會員表情` → 斷言格式鎖成 PNG、FPS/播放次數區塊消失、
   出現「要輸出哪一格」選擇器
5. 選第 3 格匯出 → `out/smoke/youtube.png`，斷言：
   - 是單幀 PNG（**沒有 acTL chunk**）
   - 尺寸 48×48
   - 內容與第 3 格的預覽相同（比對 RGBA）
6. 存 `out/smoke/ui-twitch.png`、`out/smoke/ui-youtube.png`

# 規則

- 不要改 `src/clip/` 的邏輯
- 現有所有斷言都要繼續通過
- 不要為了讓測試過而放寬斷言
- 不要跑 `npm run dist`
