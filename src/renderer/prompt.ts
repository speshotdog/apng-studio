/**
 * Electron 的 renderer 不支援 window.prompt（會直接丟
 * 「prompt() is not supported.」），所以「儲存進度」那種要輸入名稱的流程
 * 在打包後其實一次都沒成功過。這裡用一個自己畫的對話框取代。
 */
export interface PromptRequest {
  title: string
  value: string
  placeholder?: string
  resolve: (value: string | null) => void
}

type Listener = (request: PromptRequest | null) => void

let current: PromptRequest | null = null
const listeners = new Set<Listener>()

function emit(request: PromptRequest | null): void {
  current = request
  listeners.forEach((listener) => listener(request))
}

export function subscribePrompt(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function currentPrompt(): PromptRequest | null {
  return current
}

/** 回傳修剪過的字串；使用者取消或留空回傳 null。 */
export function askText(title: string, value = '', placeholder?: string): Promise<string | null> {
  // 同時只會有一個輸入框；如果前一個還開著，先當作取消。
  current?.resolve(null)
  return new Promise((resolve) => {
    emit({
      title,
      value,
      placeholder,
      resolve: (answer) => {
        emit(null)
        resolve(answer && answer.trim() ? answer.trim() : null)
      },
    })
  })
}
