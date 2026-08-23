import { useEffect, useState } from 'react'
import { subscribePrompt, type PromptRequest } from '../prompt.js'

export function TextPrompt(): React.JSX.Element | null {
  const [request, setRequest] = useState<PromptRequest | null>(null)
  const [value, setValue] = useState('')
  useEffect(
    () =>
      subscribePrompt((next) => {
        setRequest(next)
        setValue(next?.value ?? '')
      }),
    [],
  )
  if (!request) return null
  const submit = (): void => request.resolve(value)
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal text-prompt" role="dialog" aria-modal="true">
        <h2>{request.title}</h2>
        <input
          aria-label={request.title}
          autoFocus
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') request.resolve(null)
          }}
        />
        <footer>
          <button onClick={() => request.resolve(null)}>取消</button>
          <button className="prompt-confirm" disabled={!value.trim()} onClick={submit}>
            確定
          </button>
        </footer>
      </section>
    </div>
  )
}
