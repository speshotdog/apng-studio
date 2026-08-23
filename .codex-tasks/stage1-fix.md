# Stage 1 修正 — 圖層位移算錯 + 補上黃金比對

Stage 1 的解析主體是對的，但**圖層位置算錯了**，實際比對過畫布縮圖後確認。

## Bug：少加了 `LayerRenderOffscrOffset`

`src/clip/tree.ts` / `src/clip/index.ts` 目前只用 `LayerOffsetX / LayerOffsetY`。

實測 `11.clip`：

| MainId | 圖層 | LayerOffsetX/Y | LayerRenderOffscrOffsetX/Y |
|---|---|---|---|
| 32 | 圖層 4 | 0, 0 | 0, 0 |
| 34 | 1 的複製 | **8, -20** | **-8, 20** |
| 9  | 圖層 2 | **8, -20** | **-8, 20** |
| 38 | 1a 的複製 | **8, -20** | **-8, 20** |

兩者剛好互相抵消 → 正確位移是 **0, 0**。目前的結果讓上色圖層相對線稿偏移了 (8, -20)，
彩虹會跑出嘴巴外面。

參考實作 `scripts/reference_clip_to_psd.py:1814` 也是這樣算的：

```python
offset_x += layer.LayerOffsetX + layer.LayerRenderOffscrOffsetX
offset_y += layer.LayerOffsetY + layer.LayerRenderOffscrOffsetY
```

### 要改的

1. `ClipLayer` 加兩個欄位 `renderOffsetX` / `renderOffsetY`（來自
   `Layer.LayerRenderOffscrOffsetX / LayerRenderOffscrOffsetY`）。
2. 合成時用 **`offsetX + renderOffsetX`**、**`offsetY + renderOffsetY`**。
   保留原始兩個欄位不要合併掉，之後遮罩會用到不同組合。
3. 同時把 `AGENTS.md` §3.3 的 Layer 欄位清單補上這兩欄，並在 §3.6 結尾把
   「還要加 LayerOffsetX/Y」改成「還要加 `LayerOffsetX + LayerRenderOffscrOffsetX`
   （Y 同理）」。

---

## 補：黃金比對測試

`assets/golden/` 已放好由參考實作（clip_to_psd）產出的基準圖，請把比對加進
`scripts/verify-clip.ts`。

### 1. 單圖層像素比對

`assets/golden/layer-<MainId>.png`（三位數補零）是該圖層**未套用位移的原始 bitmap**，
尺寸就是 `bitmapWidth × bitmapHeight`（有 360×360 也有 512×512）。

對這些 MainId 逐一比對：`3, 9, 11, 12, 16, 17, 18, 20, 21, 22, 32, 34, 36, 38, 40, 42`

- 解析器解出來的原始 bitmap（**位移前**）必須跟黃金圖 **尺寸完全相同**
- RGBA 逐 byte 比對，**允許 0 個像素不同**（應該要 bit-exact）
- 讀 PNG 用 `upng-js` 的 `UPNG.decode` + `UPNG.toRGBA8`（把 `src/types/modules.d.ts`
  的 `upng-js` 宣告補齊 `decode` / `toRGBA8`）
- 為了測到「位移前」的 bitmap，`src/clip/index.ts` 要多匯出一個
  `renderRawBitmap(layerId): Bitmap`（不套位移、不合成子層）

### 2. 畫布縮圖比對（整體對位驗證）

`assets/golden/canvas-preview.png` 是 CSP 自己存在 `CanvasPreview` 表裡的 360×360
畫面截圖，就是這個檔最後顯示的那一格（`TimeLine.CurrentFrame = 18`）。

比對 `renderNode(<cel "4" 的 folder id>)` 的輸出與這張圖：

- 尺寸必須都是 360×360
- 計算「alpha > 16 的像素中，RGB 差距 > 8 的比例」，**必須 < 2%**
  （縮圖可能有輕微色彩處理，所以不要求 bit-exact，但位移錯了這個數字會直接爆掉 —— 
   修 bug 前是明顯不合格的）
- 把差異圖存成 `out/verify/diff-canvas.png`（差異像素標紅）方便肉眼檢查

失敗時要印出實際比例，不要只丟 assertion。

---

## 順便：把 `package.json` 的 `"latest"` 釘住

`npm install` 已經產生 `package-lock.json`，請把 `dependencies` /
`devDependencies` 裡所有 `"latest"` 換成 lock 檔裡實際裝到的版本（用 `^x.y.z`）。

---

## 完成條件

```
npm run typecheck   # 0 error
npm run verify      # 全過，含上面兩組黃金比對
```

`npm run verify` 輸出要多印：
- 每個圖層的比對結果（相同 / 不同像素數）
- 畫布縮圖的差異比例

**不要改動 `src/main`、`src/preload`、`src/renderer`。**
