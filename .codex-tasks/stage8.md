# Stage 8 — 原始碼格式化與命名整理

功能面已經完成且驗證通過（解析 bit-exact、APNG/GIF 幀數正確、打包 exe 可執行、
LINE 檢查固定在匯出按鈕上方、縮圖不再空白）。**不要再動任何行為。**

這一輪只處理可維護性。

---

## 問題：原始碼被寫成一行塞多個語句

```
src/renderer/styles.css        1 行     ← 整份 CSS 壓成一行
src/renderer/state/store.ts   16 行     ← 整個 zustand store 塞在幾行內
src/renderer/App.tsx           7 行
src/renderer/components/PreviewStage.tsx   8 行
```

例如 `store.ts` 裡：

```ts
doc: ClipSummary | null; bitmaps: Map<number, ImageBitmap>; visibility: Map<number, boolean>; slots: Slot[]; selectedSlot: number; fps: number; ...
```

功能正確，但這是壓縮檔的樣子，不是原始碼的樣子。之後要改任何一個地方都很痛苦。

## 要做的

1. **加入 Prettier** 並套用到整個 `src/` 與 `scripts/`：
   - `devDependencies` 加 `prettier`
   - `.prettierrc`：`printWidth: 100`、`semi: false`、`singleQuote: true`、
     `trailingComma: "all"`、`arrowParens: "always"`
   - `package.json` 加 `"format": "prettier --write src scripts *.ts *.json *.yml"`
     與 `"format:check": "prettier --check src scripts"`
   - 實際跑 `npm run format`
2. CSS 也要格式化（Prettier 會處理 `.css`），一個選擇器一行、屬性分行。
3. **把每個宣告拆成獨立一行** —— Prettier 不會拆 `a; b; c` 這種同行多語句，
   要手動處理。掃過所有檔案，把用 `;` 串在同一行的語句拆開。
4. 重新命名 `src/renderer/stage5.css`：這個名字洩漏了開發流程，對產品沒意義。
   依內容改成有語意的名字（例如 `panels.css` 或直接併回 `styles.css`），
   並更新 import。
5. 順手檢查 `src/renderer/` 底下有沒有其他以開發階段命名的檔案或註解，一併改掉。

## 不要做的

- 不要改任何行為、不要重構邏輯、不要改函式簽名
- 不要動 `src/clip/`、`src/codec/` 的**邏輯**（格式化可以，邏輯不行）
- 不要為了「順便優化」而改動 UI

## 完成條件

```
npm run format:check   # 全過
npm run typecheck
npm run verify:all
npm run smoke
npm run dist
```

全過，且：
- `src/renderer/styles.css` 不再是 1 行
- 沒有任何檔案還叫 `stageN.*`
- `npm run smoke` 產出的截圖跟這次修改前**視覺上完全一致**
  （這是純格式化，畫面不該有任何改變）
