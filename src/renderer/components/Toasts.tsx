import { useEffect } from 'react'
import { useStore, type Toast } from '../state/store.js'

const LIFETIME: Record<Toast['level'], number> = { success: 4000, info: 6000, error: 10000 }
const ICON: Record<Toast['level'], string> = { success: '✓', info: 'ℹ', error: '✕' }

function Item({ toast }: { toast: Toast }): React.JSX.Element {
  const dismiss = useStore((state) => state.dismissToast)
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), LIFETIME[toast.level])
    return () => clearTimeout(timer)
  }, [toast.id])
  return (
    <div className={`toast toast-${toast.level}`} role="status" data-toast-level={toast.level}>
      <i>{ICON[toast.level]}</i>
      <p>{toast.text}</p>
      <button className="toast-close" aria-label="關閉訊息" onClick={() => dismiss(toast.id)}>
        ×
      </button>
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useStore((state) => state.toasts)
  return (
    <div className="toast-stack">
      {toasts.slice(-4).map((toast) => (
        <Item key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
