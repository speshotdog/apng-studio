/**
 * 自己畫的輸入／確認對話框。
 *
 * 兩個理由不用瀏覽器內建的：
 * 1. Electron 的 renderer **不支援 `window.prompt`**（直接丟
 *    「prompt() is not supported.」），所以「儲存進度」那種流程一次都沒成功過。
 * 2. `window.confirm` 是會擋住整個 renderer 的原生視窗。跳完之後 Chromium 的
 *    user activation 會被吃掉，緊接著去點 `<select>` 有機會叫不出原生下拉清單，
 *    看起來就像「選單壞掉不能點」。從貼圖組跳回編輯畫面就會踩到這條。
 */
export interface DialogRequest {
  kind: 'text' | 'confirm' | 'choice' | 'notice'
  title: string
  message?: string
  value: string
  placeholder?: string
  confirmLabel: string
  choices?: Array<{ label: string; value: string; primary?: boolean }>
  resolve: (value: string | null) => void
}

export function askChoice(
  title: string,
  message: string,
  choices: Array<{ label: string; value: string; primary?: boolean }>,
): Promise<string | null> {
  current?.resolve(null)
  return new Promise((resolve) => {
    emit({
      kind: 'choice',
      title,
      message,
      value: '',
      confirmLabel: '',
      choices,
      resolve: (answer) => {
        emit(null)
        resolve(answer)
      },
    })
  })
}

export function showNotice(title: string, message: string): Promise<void> {
  current?.resolve(null)
  return new Promise((resolve) => {
    emit({
      kind: 'notice',
      title,
      message,
      value: '',
      confirmLabel: '關閉',
      resolve: () => {
        emit(null)
        resolve()
      },
    })
  })
}

type Listener = (request: DialogRequest | null) => void

let current: DialogRequest | null = null
const listeners = new Set<Listener>()

function emit(request: DialogRequest | null): void {
  current = request
  listeners.forEach((listener) => listener(request))
}

export function subscribeDialog(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 回傳修剪過的字串；使用者取消或留空回傳 null。 */
export function askText(title: string, value = '', placeholder?: string): Promise<string | null> {
  // 同時只會有一個對話框；如果前一個還開著，先當作取消。
  current?.resolve(null)
  return new Promise((resolve) => {
    emit({
      kind: 'text',
      title,
      value,
      placeholder,
      confirmLabel: '確定',
      resolve: (answer) => {
        emit(null)
        resolve(answer && answer.trim() ? answer.trim() : null)
      },
    })
  })
}

/** 取代 window.confirm。按下確認回傳 true。 */
export function askConfirm(
  title: string,
  message?: string,
  confirmLabel = '確定',
): Promise<boolean> {
  current?.resolve(null)
  return new Promise((resolve) => {
    emit({
      kind: 'confirm',
      title,
      message,
      value: '',
      confirmLabel,
      resolve: (answer) => {
        emit(null)
        resolve(answer !== null)
      },
    })
  })
}
