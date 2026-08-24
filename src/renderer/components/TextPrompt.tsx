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
  const choice = request.kind === 'choice'
  const notice = request.kind === 'notice'
  const submit = (): void => request.resolve(text ? value : '')
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal text-prompt"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !choice) submit()
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
          {!notice && <button onClick={() => request.resolve(null)}>取消</button>}
          {choice ? (
            request.choices?.map((item, index) => (
              <button
                key={item.value}
                className={item.primary ? 'prompt-confirm' : undefined}
                autoFocus={index === 0}
                onClick={() => request.resolve(item.value)}
              >
                {item.label}
              </button>
            ))
          ) : (
            <button
              className="prompt-confirm"
              autoFocus={!text}
              disabled={text && !value.trim()}
              onClick={submit}
            >
              {request.confirmLabel}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
