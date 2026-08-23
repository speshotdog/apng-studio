# Stage 10 — 自動帶入 CSP 動畫時間軸

這是 AGENTS.md §3.7 一直標著「Phase 2」的那件事。格式我已經完整逆向並用
`assets/samples/11.clip` 驗證到**位元組完全對齊**（1572/1572），照下面做即可，
不需要再自己摸索。

---

## 1. `cmt 0100binc` 格式（完整規格）

`Track.TrackActionMixer` 是一個外部 chunk id。該 chunk 的內容：

```
[0..4)   u32 LE  壓縮後長度（= 後面 zlib 資料的長度）
[4..)    zlib deflate 資料
```

解壓後的內容：

```
[0..12)   ASCII magic "cmt 0100binc"
[12..16)  4 bytes 未知（實測 2b 79 5a 5e），略過
[16..20)  u32 LE  字串表項目數 N
[20..)    字串表：N 個項目，每項 = 1 byte 長度 + UTF-8 位元組
接著是節點樹（單一根節點）
```

字串表的**前 22 項固定是型別名稱**，索引即型別代碼：

```
0 null       1 Byte      2 SByte     3 UInt16    4 Int16     5 UInt32
6 Int32      7 Single    8 Double    9 String   10 Float2   11 Float3
12 Quat     13 Matrix44 14 Single[] 15 Byte[]   16 Int32[]  17 String[]
18 Float2[] 19 Float3[] 20 Quat[]   21 Matrix44[]
```

第 22 項之後是文件用到的所有識別字與字串值。

### 節點編碼（**所有整數都是 little-endian**）

```
u32  nameIndex       → 字串表索引
u32  typeIndex       → 型別代碼（見上表）
     value           → 長度依型別，見下
u32  attrCount
     attrCount × (u32 nameIndex, u32 valueIndex)   ← 兩者都是字串表索引
u32  childCount
     childCount × 節點（遞迴）
```

value 的長度：

| 型別 | value |
|---|---|
| `null`(0) | 0 bytes |
| `Byte`/`SByte` | 1 byte |
| `UInt16`/`Int16` | 2 bytes |
| `UInt32`/`Int32`/`Single` | 4 bytes |
| `Double` | 8 bytes（LE IEEE754） |
| `String` | u32 字串表索引 |
| `Float2`/`Float3`/`Quat`/`Matrix44` | 8 / 12 / 16 / 64 bytes |
| 陣列型別 (14–21) | `u32 count` + `count × 元素大小`（Single=4, Byte=1, Int32=4, String=4(索引), Float2=8, Float3=12, Quat=16, Matrix44=64） |

**解析完必須剛好用完整個 buffer**，沒用完就是解錯了 —— 請加這個斷言。

### 實測 `11.clip` 的 Track 3（`TrackKind = 2000`）解出來的樹

```
<celsysdocument> version="1.0.0"
  <Version-Information>
    <Software:String> = "CLIP STUDIO"
    <Version:String>  = "2.1.0"
  <General> Version="2.0.0"
    <ActionNodeClip> Name=""
      <TimeClip>   <Start:Double>=0.0  <End:Double>=60.0  <Rate:Double>=60.0
      <MotionClip> <Start:Double>=0.0  <End:Double>=60.0  <Rate:Double>=60.0
      <MotionBlend> …
      <TimeInfo>   <Rate:Double>=60.0        ← 這個是 FCurve 的時基
      <AnimInfo>
        <Param:Int32> Name="ImageCelName" Tag="2"
        <FCurve> Type="ImageCelName"
          <Frame:Single[]>  = [0,6,9,12,15,18,21,24,27,30,33,36,39,42,45,48,51,54,57]
          <Value:Single[]>  = [0,1,2,1,4,5,3,4,5,4,3,5,3,4,5,4,3,5,3]
          <LeftSlope:Single[]>  = [0 × 19]
          <RightSlope:Single[]> = [0 × 19]
          <Interp:String[]> = ["Constant" × 19]
          <Tag:String[]>    = ["1","1a","1b","2","3","4","2","3","4","3","2","4","2","3","4","3","2","4","2"]
```

---

## 2. 兩個一定要注意的坑

### 坑一：cel 名稱在 `Tag`，不在 `Value`

`Value` 是內部索引，**不穩定**：上面 `Value[1] = 1.0 → Tag[1] = "1a"`，
但 `Value[3] = 1.0 → Tag[3] = "2"`。同一個 Value 對到不同 cel。
**一律用 `Tag` 取 cel 名稱**，用 `Value` 會排錯。

### 坑二：FCurve 用 60fps 內部時基，不是文件的影格率

`TimeInfo/Rate = 60.0`，但 `TimeLine.FrameRate = 20`。
Frame 陣列的 0,6,9,…,57 要換算成文件影格：

```
docFrame = round(curveFrame * TimeLine.FrameRate / TimeInfo.Rate)
```

實測 → 0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19，
共 20 格 @ 20fps = **剛好 1.00 秒**（正好符合 LINE 的秒數規定）。

`TimeInfo/Rate` 缺失或為 0 時，退回用 `TimeLine.FrameRate`（即不換算），並記一筆警告。

---

## 3. Track 與動畫資料夾的對應

一個檔案可能有多個動畫資料夾。對應關係：

```
Track.LayerUuidWithTrack   → 16 bytes 原始位元組
Layer.LayerUuid            → ASCII 字串，含連字號
```

把 `Layer.LayerUuid` 的連字號去掉之後，與 `LayerUuidWithTrack` 的 hex 相同。

實測：Track 3 的 `1476725614e34002938397d202143a2c`
      ↔ Layer 5（`資料夾 1`）的 `"1476725614-e340-0293-8397-d202143a2c"`

只處理 `TrackKind === 2000`（ImageCel 軌），其他 kind 略過。

---

## 4. 要實作的東西

### 4.1 `src/clip/binc.ts`

```ts
export interface BincNode {
  name: string
  type: string
  value: unknown
  attrs: Record<string, string>
  children: BincNode[]
}
export function parseBinc(data: Buffer): BincNode
```

`parseBinc` 收的是**已經解壓後**的資料。外部 chunk 的 `u32 LE 長度 + zlib`
在呼叫端處理。解析完 offset 不等於 `data.length` 就 throw。

### 4.2 `src/clip/timeline.ts`

```ts
export interface CelKey {
  /** 換算後的文件影格（0 起算） */
  frame: number
  /** cel 名稱，來自 Tag；空字串代表該段沒有畫面 */
  celName: string
}
export interface CspTimeline {
  /** 對應的動畫資料夾 layer id */
  animationFolderId: number
  animationFolderName: string
  frameRate: number
  /** 影格總數 = EndFrame - StartFrame */
  frameCount: number
  keys: CelKey[]
  warnings: string[]
}
export function readCspTimelines(db, chunks): CspTimeline[]
```

流程：`TimeLine` → `Track`（沿 `TrackNextIndex` 走完整條鏈，只取 `TrackKind===2000`）
→ `TrackActionMixer` 外部 chunk → 解壓 → `parseBinc` → 找
`AnimInfo/FCurve[Type="ImageCelName"]` → 取 `Frame` 與 `Tag` 兩個陣列。

`ClipDocument` 增加 `cspTimelines: CspTimeline[]`，`ClipSummary` 也要帶出去給 renderer。

### 4.3 UI：帶入按鈕

影格軌工具列（`+ 加一格` 那排）加一顆 **`帶入 CSP 時間軸`**：

- `.clip` 沒有可用時間軸時，按鈕停用並附上 title 說明原因
- 只有一個動畫資料夾有時間軸 → 直接帶入
- 有多個 → 跳一個小清單讓使用者選哪一個資料夾

帶入時：

1. `fps` 設成該時間軸的 `frameRate`
2. 格數設成 `frameCount`
3. **只在關鍵影格那幾格填入 layerId，其餘留空讓它自動延續** ——
   這跟委託人「中間會自動補上」的心智模型一致，畫面也乾淨，輸出結果完全相同
4. cel 名稱對應到動畫資料夾底下**同名的子資料夾**（`ClipLayer.name` 完全相符）
5. 對不到名字的 key → 那格留空，並在警告裡列出是哪個名稱
6. 帶入後把 `playhead` / `selectedSlot` 歸零

帶入完成後顯示一則提示（沿用現有的 toast），內容像：
`已帶入 CSP 時間軸：20 格 @ 20 FPS，19 個關鍵影格`，有警告就一併列出。

**已經排好的內容會被覆蓋**，所以時間軸上已經有東西時要先跳確認。

### 4.4 README

在「目前尚未支援自動帶入 CSP 原本的動畫時間軸」那句改成說明新功能怎麼用，
並講清楚「只填關鍵影格、中間自動延續」的行為。

---

## 5. 驗證（缺一不可）

### `npm run verify`（`scripts/verify-clip.ts`）追加

```
parseBinc 解析 Track 3 的資料後，消耗的 bytes === 解壓後長度（1572）
cspTimelines.length === 1
timeline.animationFolderId === 5
timeline.animationFolderName === '資料夾 1'
timeline.frameRate === 20
timeline.frameCount === 20
timeline.keys.length === 19
keys.map(k => k.frame)   === [0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]
keys.map(k => k.celName) === ['1','1a','1b','2','3','4','2','3','4','3','2','4','2','3','4','3','2','4','2']
timeline.warnings 為空
```

### `npm run smoke` 追加

1. 開 `11.clip`，按下「帶入 CSP 時間軸」
2. 斷言 `slots.length === 20`、`fps === 20`
3. 斷言第 0 格是 cel `1`、第 1 格是 `null`（延續）、第 2 格是 `1a`
4. 斷言統計面板：`時間軸格數 20`、`單次總長 1.00 秒`
5. 把播放次數設 4、尺寸按「LINE 貼圖」→ 斷言 `validateForLine()` **沒有 error**
6. 走完整匯出流程輸出 `out/smoke/export-timeline.png`，
   用 `verifyApng()` 斷言 `numPlays === 4`，並斷言 `numFrames` 與統計面板顯示的
   實際幀數相同
7. 存一張 `out/smoke/ui-timeline.png`

---

## 6. 規則

- `src/clip/` 這次可以新增檔案與擴充 `ClipDocument`，但**不要改動既有的像素解碼邏輯**
- 現有的所有驗證與 smoke 斷言都必須繼續通過
- 不要為了讓測試過而放寬斷言
- 不要順手加沒被要求的功能（例如洋蔥皮、時間軸縮放）
- 最後跑 `npm run format:check`、`npm run typecheck`、`npm run verify:all`、
  `npm run smoke`、`npm run dist`
