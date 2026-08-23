import { useEffect, useState } from 'react'
import { subscribeDialog, type DialogRequest } from '../prompt.js'

export function TextPrompt(): React.JSX.Element | null {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [value, setValue] = useState('')
  useEffect(
    () =>
      subscribeDialog((next) => {
        setRequest(next)
        setValue(next?.value ?? '')
      }),
    [],
  )
  if (!request) return null
  const text = request.kind === 'text'
  const submit = (): void => request.resolve(text ? value : '')
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal text-prompt"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') request.resolve(null)
        }}
      >
        <h2>{request.title}</h2>
        {request.message && <p className="prompt-message">{request.message}</p>}
        {text && (
          <input
            aria-label={request.title}
            autoFocus
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <footer>
          <button onClick={() => request.resolve(null)}>取消</button>
          <button
            className="prompt-confirm"
            autoFocus={!text}
            disabled={text && !value.trim()}
            onClick={submit}
          >
            {request.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
