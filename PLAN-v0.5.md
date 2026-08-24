# v0.5 開發計畫：格子即文件 + 批次匯入資料夾

規劃/決策/驗收：Claude（Fable 5）。實作：Codex（gpt-5.6-sol）。
本檔是已批准的架構決策，實作時遇到與本檔衝突的細節，回報而不是自行改設計。

## 已批准的架構決策

1. **專案素材庫是專案層唯一資料**。EditorDocument 只存 activeSourceId、軌道引用與文件設定，不再每份 EditorState 複製一份 sources。
2. **文件是唯一真相，PNG 是衍生快取**。格子分兩種 union：
   - 外部圖片格：無 documentId，pngBase64/sourcePath 為真相（main/tab 也是這種）
   - 文件格：documentId 為真相；快取存 base64、mime、width、height、byteLength、frameCount、renderedRevision
3. **revision 模型**：projectRevision / savedRevision 取代單一 dirty boolean（dirty = 兩者不等）；每文件 contentRevision；重算衍生圖不動 projectRevision；Undo/Redo 是語意變更要遞增。
4. **延後渲染**：編輯時不編碼。切格、回貼圖組、手動/自動存檔、匯出貼圖組時才重算 stale 格；渲染帶 {projectId, documentId, contentRevision} token，舊結果不可蓋新內容；並行上限 2。
5. **Undo/Redo 每 documentId 獨立**，記憶體內、每份上限 60 步、lazy 建立；切換文件不入歷史；覆蓋格子＝新 documentId、舊歷史丟棄。
6. **SaveCoordinator**：同 project id 的正式存檔與 autosave 排隊；請求帶 revision，舊 revision 的完成結果忽略；存檔期間再編輯 → 存檔成功但 dirty 保持；關窗前存檔失敗必須擋住視窗不關。
7. **多 CSP TimeLine**：只匯入資料庫順序第一個 TimeLine 的全部 ImageCel 軌，其餘列入摘要告知。
8. **PSD/PSB/Procreate 批次匯入**：建立綁來源的空文件（FPS 取 doc.timeline?.frameRate ?? 12），摘要如實說「未帶入動畫」。
9. **批次匯入衝突**：一次列出全部，三態對話框（覆蓋並匯入／保留衝突格匯入其餘／取消）。同一格號對到多個檔案＝衝突，全部跳過並列出，不依檔案系統順序搶格。
10. **格號規則**：basename 開頭 `^(\d+)`，容忍前導零與其後任意文字；0、超出 packCount、無數字者列 skipped 附原因。
11. **渲染/解析失敗不可弄丟文件**：來源缺失或編碼失敗仍保存 EditorDocument，UI 標「縮圖待更新／來源缺失」，ZIP 匯出時才阻擋並列出失敗格。
12. **升級相容**：v1 cell 有 editor → 升級為文件格（合併其 sources 進專案素材庫、正規化 sourceId）；只有 pngBase64 → 維持外部圖片格原樣。
13. **UI**：任一編號格可點；空格點下去建空文件綁定；「存入貼圖組」按鈕與「可編輯」徽章移除；編輯畫面顯示「正在編輯第 XX 格」；獨立單張動畫（standalone document）行為不變。

## 實作步驟（每步獨立驗收）

- **A1** v2 專案資料模型與舊檔正規化（types.ts、project.ts、snapshot.ts、preload、ipc.ts）
- **A2** 編輯狀態歸屬 activeDocumentId（store.ts 與所有讀 tracks/fps 的元件）；每文件歷史
- **A3** 延後渲染服務（export.ts、compose.ts、新模組 packDocument.ts；revision token；並行 2）
- **A4** 畫面生命週期（App.tsx、PackPanel、ExportPanel）；移除存入貼圖組
- **A5** SaveCoordinator + 關窗保護 + ZIP 前刷新 stale 格
- **A6** 遷移與回歸測試（smoke.ts、新驗證腳本）
- **B1** 資料夾掃描 IPC + 格號配對規則 + 結果型別
- **B2** 抽出「全部 CSP 軌一次建軌」共用建構器（手動匯入與批次共用；09.clip 驗證四軌）
- **B3** 批次解析→三態衝突確認→原子提交（壞檔只影響自己；並行 2；切專案時不提交）
- **B4** 摘要 toast 與端到端測試

## 驗收基準

- 既有：npm run typecheck / verify:codec / verify:timeline / build 全綠
- A 完成：兩格不同軌道與 FPS 互不污染；改完格子不按任何鈕回貼圖組縮圖更新；v1 專案開啟升級無損；ZIP 內容＝最後編輯
- B 完成：09.clip 批次匯入一次建立四軌且與 CSP 一致；亂數檔名（無數字/超界/重複格號/壞檔）都有明確結果
