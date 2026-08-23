/**
 * 影格延遲的單一真相來源。
 *
 * LINE 的上傳驗證器會自己把 APNG 每一幀的 fcTL 延遲加總，再要求總長度剛好是
 * 1、2、3 或 4 秒。我們原本用 `round((i+1)*1000/fps) - round(i*1000/fps)` 逐幀算，
 * 總和在毫秒上是對的，但只要有任何一幀不是 10 毫秒的整數倍，換算成 APNG 慣用的
 * 1/100 秒單位就會被截掉尾數，總長度變成 0.96 秒之類的值而被退件。
 *
 * 這裡統一把每幀延遲對齊到 `STEP_MS`，並用 Bresenham 分配讓總和精確等於目標長度，
 * 幀與幀之間最多差一個 STEP。編碼端（apng.ts）看到全部都是 10 毫秒整數倍時，
 * 會直接用 delay_den=100 寫檔，讓任何讀取器算出來的長度都一模一樣。
 */
export const STEP_MS = 10

/** 把 totalMs 分給 count 幀，每幀都是 STEP_MS 的整數倍，總和精確等於 totalMs。 */
export function distributeDelays(totalMs: number, count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) throw new Error('影格數必須是正整數')
  if (!Number.isInteger(totalMs) || totalMs % STEP_MS !== 0)
    throw new Error(`總長度 ${totalMs} 毫秒必須是 ${STEP_MS} 的整數倍`)
  const units = totalMs / STEP_MS
  return Array.from(
    { length: count },
    (_, index) =>
      (Math.floor(((index + 1) * units) / count) - Math.floor((index * units) / count)) * STEP_MS,
  )
}

/** 依 FPS 算出整段動畫的長度，並對齊到 STEP_MS。 */
export function totalDurationMs(count: number, fps: number): number {
  const raw = (count * 1000) / Math.max(1, fps)
  return Math.max(STEP_MS * count, Math.round(raw / STEP_MS) * STEP_MS)
}

/** 影格延遲陣列；所有輸出路徑（預覽統計、匯出、規格檢查）都要走這裡。 */
export function frameDelays(count: number, fps: number): number[] {
  return distributeDelays(totalDurationMs(count, fps), count)
}
