import type { PackImportResult } from '../project/types.js'

/** 匯入資料夾後要顯示的訊息。抽出來是為了能被測試直接驗證。 */
export function packImportMessage(result: PackImportResult): string {
  if (!result.cells.length && !result.skipped.length)
    return '沒有找到符合命名規則的圖片（01.png～40.png、main.png、tab.png）'
  if (result.skipped.length) return `已略過：${result.skipped.join('、')}`
  return `已匯入 ${result.cells.length} 個檔案`
}
