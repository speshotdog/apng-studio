import { useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.js'

const MAX_TAGS = 20
const splitTags = (value: string): string[] => value.split(/[,，]/).map((tag) => tag.trim())

export function TagEditor(props: {
  tags: string[]
  onChange(tags: string[]): void
  suggestions: string[]
}): React.JSX.Element {
  const toast = useStore((state) => state.toast)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const tagKeys = useMemo(() => new Set(props.tags.map((tag) => tag.toLowerCase())), [props.tags])
  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    return props.suggestions
      .map((tag) => tag.trim())
      .filter((tag) => {
        const key = tag.toLowerCase()
        if (!tag || tagKeys.has(key) || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 12)
  }, [props.suggestions, tagKeys])

  const commit = (rawTags: string[]): void => {
    let next = props.tags
    let added = 0
    for (const tag of rawTags.map((value) => value.trim()).filter(Boolean)) {
      const key = tag.toLowerCase()
      if (next.some((item) => item.toLowerCase() === key)) continue
      if (next.length >= MAX_TAGS) {
        toast('info', `最多只能加入 ${MAX_TAGS} 個 GIPHY 標籤`)
        break
      }
      next = [...next, tag]
      added += 1
    }
    if (added > 0) props.onChange(next)
  }

  const removeAt = (index: number): void => {
    props.onChange(props.tags.filter((_, current) => current !== index))
  }

  const commitDraft = (): void => {
    commit(splitTags(draft))
    setDraft('')
  }

  return (
    <div className="tag-editor">
      <div className="tag-input-row" onClick={() => inputRef.current?.focus()}>
        {props.tags.map((tag, index) => (
          <span className="tag-chip" key={`${tag}-${index}`}>
            {tag}
            <button
              aria-label={`移除 ${tag}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                removeAt(index)
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          placeholder={props.tags.length ? '' : '輸入標籤，按 Enter 或逗號新增'}
          onChange={(event) => {
            const value = event.target.value
            if (value.includes(',') || value.includes('，')) {
              commit(splitTags(value))
              setDraft('')
            } else {
              setDraft(value)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              commitDraft()
            } else if (event.key === 'Backspace' && !draft && props.tags.length) {
              removeAt(props.tags.length - 1)
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text')
            if (!pasted.includes(',') && !pasted.includes('，')) return
            event.preventDefault()
            commit(splitTags(pasted))
            setDraft('')
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="tag-suggestions" aria-label="最近使用的 GIPHY 標籤">
          {suggestions.map((tag) => (
            <button key={tag} type="button" onClick={() => commit([tag])}>
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
