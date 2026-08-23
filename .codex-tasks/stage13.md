# Stage 13 — 設定頁 + GIPHY 上傳 + 噗浪表情輸出

**Stage 12（進度快照／一鍵符合規範／貼圖組模式）已完成，本階段建立在它上面。**

---

# A. 設定頁

目前沒有任何設定介面。新增一個，之後其他設定也放這裡。

## A1. 開啟方式

選單 `檔案` 旁邊加 `設定`，或在右上角加一顆齒輪。開成 **modal 對話框**，不要另開視窗。

## A2. 內容（目前只有一項）

```
┌ 設定 ─────────────────────────────────┐
│ GIPHY                                 │
│  API Key  [••••••••••••••]  [顯示]     │
│  [ 測試連線 ]        狀態：尚未設定     │
│                                        │
│  ⓘ 到 developers.giphy.com 申請。      │
│    免費的 beta key 每天只能上傳 10 個，  │
│    且無法指定 GIPHY 頻道。要解除限制     │
│    需向 GIPHY 申請 production key。      │
│                                        │
│  使用者名稱（選填）[            ]        │
│  ⓘ 只有 production key 才能指定。        │
├────────────────────────────────────────┤
│              [ 取消 ]  [ 儲存 ]         │
└────────────────────────────────────────┘
```

- 輸入框預設是密碼型態，旁邊 `顯示` 可切換明文
- `測試連線` → 打 `GET https://api.giphy.com/v1/gifs/trending?api_key=<key>&limit=1`
  成功顯示綠色「金鑰有效」，401/403 顯示紅色「金鑰無效」，其他錯誤顯示實際訊息

## A3. 金鑰儲存（安全要求，不可打折）

- **主行程負責，renderer 永遠拿不到明文金鑰**
- 用 Electron 的 `safeStorage.encryptString()` 加密後寫進
  `app.getPath('userData')/settings.json`（欄位存 base64 的密文）
- `safeStorage.isEncryptionAvailable()` 為 false 時（少數環境），
  **不要退回明文儲存** —— 改成不落地、只存在記憶體，並在 UI 明講
  「此環境無法安全儲存，關閉程式後需重新輸入」
- IPC：
  ```
  'settings:get'     () => { hasGiphyKey: boolean; giphyUsername: string }   // 不回傳金鑰
  'settings:setGiphy'(key: string, username: string) => { ok: boolean; error?: string }
  'settings:clearGiphy'() => void
  'settings:testGiphy' () => { ok: boolean; message: string }
  ```
- **金鑰絕對不能出現在 console.log、錯誤訊息、進度快照或任何寫出的檔案裡**
- `.gitignore` 不需要動（userData 不在專案內），但要確認 smoke 產生的檔案不含金鑰

---

# B. GIPHY 上傳

## B1. 事實依據

- 端點：`POST https://upload.giphy.com/v1/gifs`，`multipart/form-data`
- 必要參數：`api_key` + `file`（二進位）
- 選填：`username`（僅 production key）、`tags`（逗號分隔）、`source_post_url`
- 上限 100MB，**只接受動態 GIF 或影片，不接受 APNG**
- 免費 beta key：**每天 10 次上傳**，且不能指定 username
- 回應：`{ data: { id }, meta: { status, msg } }`
- 取得網址：`GET https://api.giphy.com/v1/gifs/<id>?api_key=<key>`
  → `data.url`（GIPHY 頁面）、`data.images.original.url`（直接的 GIF 網址）

## B2. UI

匯出面板底部，`匯出 APNG` 旁邊加一顆 `上傳到 GIPHY`。

- 未設定金鑰時 → 按鈕停用，title 寫「請先到設定填入 GIPHY API Key」，
  點一下直接開設定頁
- **按下後一定要跳確認對話框**，內容必須包含：
  ```
  即將上傳到 GIPHY

  ⚠ 上傳到 GIPHY 的內容是公開的，任何人都能搜尋到。
     如果這是還沒發表的作品或客戶的委託，請先確認可以公開。

  格式    GIF（GIPHY 不接受 APNG，將自動轉檔）
  尺寸    270 × 270
  幀數    19
  大小    約 148 KB
  標籤    [ 可輸入，逗號分隔                     ]

              [ 取消 ]  [ 確認上傳 ]
  ```
- 上傳中顯示進度／忙碌狀態，按鈕鎖住
- 成功後顯示 GIPHY 頁面網址與直接 GIF 網址，各附一顆 `複製`，
  以及一顆 `在瀏覽器開啟`（用 `shell.openExternal`）
- 失敗要顯示 GIPHY 回傳的實際訊息；**若判斷得出是額度用完
  （429 或訊息含 rate limit），要明講「beta key 每天上限 10 次」**

## B3. 實作

- 上傳在**主行程**做（金鑰不出主行程），IPC：
  ```
  'giphy:upload'(payload: { gifBytes: Uint8Array; tags: string }) 
     => { ok: boolean; id?: string; pageUrl?: string; gifUrl?: string; error?: string }
  ```
- renderer 負責產生 GIF bytes（沿用現有的 `encodeGif` 流程），主行程只管上傳
- 用 Node 內建的 `fetch` + `FormData` + `Blob`，不要為此加 HTTP 套件
- **只允許送到 `upload.giphy.com` 與 `api.giphy.com`**，網址寫死，不接受外部傳入的 host
- 逾時 60 秒，逾時要給明確訊息

---

# C. 噗浪表情輸出

## C1. 規格

來源：噗浪 `EmoticonManager` 上傳頁的說明。

| 項目 | 值 |
|---|---|
| 尺寸 | **最大 48 × 48** |
| 檔案大小 | **< 256 KB** |
| 格式 | JPG / GIF / PNG（**不支援 APNG**） |
| 動態 | 用 GIF |

噗浪**沒有公開的表情上傳 API**，所以這裡只做輸出格式，不做自動上傳。

## C2. 加入 target

`LineTarget` 這個型別名稱已經不準確了（現在還要放噗浪），
改名為 **`ExportTarget`**，並新增 `'plurkEmoticon'`：

```
label        噗浪表情
fixedSize    null（最大 48×48，可以更小）
maxWidth 48  maxHeight 48
maxFileBytes 256 * 1024
format       強制 GIF（動態）或 PNG（單幀）
frames       無 5–20 的限制
duration     無限制
```

檢查項目：
- 寬或高 > 48 → error
- 檔案 ≥ 256KB → error（訊息帶實際 KB）
- 格式是 APNG → error：`噗浪不支援 APNG，請改用 GIF`

**UI 上要把「LINE 用途」這一區改名為「輸出目標」**，選項變成：
`動態貼圖` / `動態表情貼` / `一般貼圖` / `主要圖片` / `噗浪表情`
（分組顯示，LINE 一組、噗浪一組）

## C3. 48×48 的構圖問題（重點）

360×360 的畫直接縮到 48×48 會糊成一團，什麼都看不出來。
所以選到 `噗浪表情` 時：

1. 自動把尺寸設成 48×48
2. 自動把格式切成 GIF
3. **自動套用「填滿」**（等比放大到填滿 48×48，超出裁掉）
4. 在畫面調整區顯示一行提示：
   `48×48 很小，建議用縮放與位移把主體（例如臉）裁出來，整張縮進去會看不清楚`
5. 預覽要用 `image-rendering: pixelated` 放大顯示，讓他看得出實際的粗糙程度

## C4. 輸出

- 單張：存成 `<timestampName()>.gif`
- 貼圖組模式下選噗浪 target 時，張數限制改成「不限」（噗浪表情沒有 8/16/24 的規定），
  打包時輸出資料夾而不是 ZIP（噗浪是一張一張上傳的）

---

---

# D. 兩個版面問題（Stage 12 留下的）

## D1. 貼圖組的格子太大，看不到全貌

`out/smoke/ui-pack.png`：1280 寬的視窗下，4 欄讓每格變成 ~250px，
畫面上一次只看得到 8 格，但一組有 34 格（32 + main + tab）。
「一格一格的畫面，上面可以預覽現在有的貼圖」的重點就是**一眼看到整組**，
現在要一直捲。

改法：格子改成 `grid-template-columns: repeat(auto-fill, minmax(120px, 160px))`，
讓欄數隨視窗寬度自動增加，格子上限 160px。
1280 寬大約會排到 6–7 欄，34 格大致一頁看得完。
`main` 與 `tab` 兩格獨立放在最下方一區，並標上各自的規定尺寸。

同時在標題列加一個**縮圖大小**滑桿（小 / 中 / 大），讓他要細看時可以放大。

## D2. 進度面板會吃掉圖層面板

`out/smoke/ui-autofix.png`：進度區塊固定佔住左上角，把圖層樹往下擠。
存了十幾個進度之後圖層樹會被壓到幾乎看不見。

改法：
- 進度區塊改成**可摺疊**（預設收合，只顯示 `進度 (3)` 與 `儲存目前進度`）
- 展開時清單最高 200px，超過自己捲動
- 收合狀態記在設定裡，下次開啟保持

---

# 驗證

## `npm run verify:codec` 追加

```
plurkEmoticon:
  48×48 / GIF / 100KB          → 無 error
  64×64                        → 尺寸 error，訊息含 48
  48×48 / 300KB                → 檔案大小 error，訊息含 256
  48×48 / format 'apng'        → 格式 error，訊息含 GIF
  40×48                        → 無 error（可以更小）
```

## `npm run smoke` 追加

1. 切到 `噗浪表情` → 斷言尺寸自動變 48×48、format 變 `gif`、zoom 被設成「填滿」的值
2. 匯出 GIF 到 `out/smoke/export-plurk.gif`，斷言：
   - 檔頭 `GIF89a`
   - 尺寸 48×48（掃 GIF 的 Logical Screen Descriptor）
   - 檔案 < 256KB
3. 存一張 `out/smoke/ui-plurk.png`
4. 設定頁：開啟 → 填入一個假金鑰 → 儲存 → `settings:get` 回 `hasGiphyKey: true`
   → 斷言 **`settings.json` 的內容裡找不到那串假金鑰的明文**（這是安全底線）
   → `settings:clearGiphy` → 回 `hasGiphyKey: false`
5. 存一張 `out/smoke/ui-settings.png`（金鑰欄位要是遮蔽狀態）

**不要在測試裡打真的 GIPHY API。** 上傳流程用一個可注入的假 fetch 做單元測試：
- 200 + `{data:{id:'abc'}}` → 回 `ok: true` 且組出正確網址
- 429 → 錯誤訊息含「每天上限 10 次」
- 逾時 → 錯誤訊息含「逾時」

# 規則

- 不要改 `src/clip/` 的邏輯
- **金鑰明文不得出現在任何寫出的檔案、log 或 IPC 回傳值**
- 上傳一定要有使用者明確確認，不得有自動上傳路徑
- 現有所有斷言都要繼續通過
- 不要跑 `npm run dist`
