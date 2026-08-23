import { useEffect, useRef, useState } from 'react'
import { bitmapKey } from '../compose.js'
import { askConfirm } from '../prompt.js'
import { useStore, type Slot, type Track } from '../state/store.js'

function SlotThumb({ bitmap }: { bitmap: ImageBitmap }): React.JSX.Element {
  return (
    <canvas
      width={bitmap.width}
      height={bitmap.height}
      ref={(canvas) => canvas?.getContext('2d')?.drawImage(bitmap, 0, 0)}
    />
  )
}

interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function Timeline(): React.JSX.Element {
  const state = useStore()
  const { doc, tracks, activeTrack, selection, selectedSlot, playhead, playing, set } = state
  const track = tracks[activeTrack] ?? tracks[0]!
  const frames = state.frameCount()
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [timelineMenu, setTimelineMenu] = useState(false)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const timelines = doc?.cspTimelines ?? []

  const importTimeline = async (index: number): Promise<void> => {
    if (
      track.slots.some((slot) => slot.layerId !== null) &&
      !(await askConfirm('帶入 CSP 時間軸', '目前影格軌已有內容，確定要覆蓋嗎？', '覆蓋'))
    )
      return
    state.importCspTimeline(index)
    setTimelineMenu(false)
  }

  const patchActive = (slots: Slot[]): void => {
    state.commit()
    set({ tracks: tracks.map((t, i) => (i === activeTrack ? { ...t, slots } : t)) })
  }

  /** 插入／刪除影格要動到所有軌道，不然時間軸會對不齊。 */
  const spliceAll = (at: number, remove: number[], insert: number): void => {
    state.commit()
    set({
      tracks: tracks.map((t) => {
        const kept = t.slots.filter((_, i) => !remove.includes(i))
        const next = kept.length ? kept : [{ layerId: null }]
        if (!insert) return { ...t, slots: next }
        const copy = next.slice()
        copy.splice(at, 0, ...Array.from({ length: insert }, () => ({ layerId: null })))
        return { ...t, slots: copy }
      }),
      selection: [],
    })
  }

  const selectFrame = (index: number, event: React.MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      set({
        selection: selection.includes(index)
          ? selection.filter((i) => i !== index)
          : [...selection, index],
        selectedSlot: index,
      })
    } else if (event.shiftKey) {
      const [from, to] = [Math.min(selectedSlot, index), Math.max(selectedSlot, index)]
      set({
        selection: Array.from({ length: to - from + 1 }, (_, i) => from + i),
        selectedSlot: index,
      })
    } else {
      set({ selection: [], selectedSlot: index, playhead: index, playing: false })
    }
  }

  /** 把選取的影格整批搬到 target 位置；總格數不變。 */
  const moveSelection = (target: number, copy: boolean): void => {
    const picked = [...new Set(selection)].sort((a, b) => a - b)
    if (!picked.length) return
    const moved = picked.map((i) => ({ ...track.slots[i]! }))
    if (copy) {
      const next = track.slots.slice()
      moved.forEach((slot, offset) => {
        const at = target + offset
        if (at < next.length) next[at] = slot
      })
      patchActive(next)
      return
    }
    const rest = track.slots.filter((_, i) => !picked.includes(i))
    const insertAt = Math.max(
      0,
      Math.min(rest.length, target - picked.filter((i) => i < target).length),
    )
    patchActive([...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)])
    set({ selection: moved.map((_, offset) => insertAt + offset), selectedSlot: insertAt })
  }

  // 在影格條的空白處按住拖曳 = 框選。
  useEffect(() => {
    if (!marquee) return
    const move = (event: MouseEvent): void =>
      setMarquee((current) => current && { ...current, x1: event.clientX, y1: event.clientY })
    const up = (): void => {
      const strip = stripRef.current
      if (strip && marquee) {
        const box = {
          left: Math.min(marquee.x0, marquee.x1),
          right: Math.max(marquee.x0, marquee.x1),
          top: Math.min(marquee.y0, marquee.y1),
          bottom: Math.max(marquee.y0, marquee.y1),
        }
        const hits = [...strip.querySelectorAll<HTMLElement>('[data-frame]')].flatMap((element) => {
          const rect = element.getBoundingClientRect()
          const overlaps =
            rect.right >= box.left &&
            rect.left <= box.right &&
            rect.bottom >= box.top &&
            rect.top <= box.bottom
          return overlaps ? [Number(element.dataset.frame)] : []
        })
        if (hits.length) set({ selection: hits, selectedSlot: hits[0]! })
      }
      setMarquee(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up, { once: true })
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [marquee])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement).matches('input, textarea, select')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        state.redo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        set({ selection: Array.from({ length: frames }, (_, i) => i) })
      } else if (event.key === 'Escape') set({ selection: [] })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [frames, state])

  const trackRow = (item: Track, trackIndex: number): React.JSX.Element => {
    const isActive = trackIndex === activeTrack
    return (
      <div className={`track-row ${isActive ? 'current' : ''}`} key={item.id}>
        <div className="track-head" onClick={() => set({ activeTrack: trackIndex, selection: [] })}>
          <input
            aria-label={`${item.name} 可見`}
            type="checkbox"
            checked={item.visible}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => state.setTrack(trackIndex, { visible: event.target.checked })}
          />
          <input
            className="track-name"
            value={item.name}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => state.setTrack(trackIndex, { name: event.target.value })}
          />
          <button
            title="上移"
            disabled={trackIndex === 0}
            onClick={(event) => {
              event.stopPropagation()
              state.moveTrack(trackIndex, trackIndex - 1)
            }}
          >
            ▲
          </button>
          <button
            title="下移"
            disabled={trackIndex === tracks.length - 1}
            onClick={(event) => {
              event.stopPropagation()
              state.moveTrack(trackIndex, trackIndex + 1)
            }}
          >
            ▼
          </button>
          <button
            title="刪除圖層"
            disabled={tracks.length <= 1}
            onClick={(event) => {
              event.stopPropagation()
              void askConfirm('刪除圖層', `刪除圖層「${item.name}」？`, '刪除').then((yes) => {
                if (yes) state.removeTrack(trackIndex)
              })
            }}
          >
            ✕
          </button>
        </div>
        <div
          className="slots"
          ref={isActive ? stripRef : undefined}
          onMouseDown={(event) => {
            if (!isActive || event.target !== event.currentTarget) return
            set({ selection: [] })
            setMarquee({
              x0: event.clientX,
              y0: event.clientY,
              x1: event.clientX,
              y1: event.clientY,
            })
          }}
        >
          {item.slots.map((slot, index) => {
            const resolved = state.resolveSlot(index, trackIndex)
            const bitmap =
              resolved === null
                ? undefined
                : state.bitmaps.get(bitmapKey(resolved, state.visibility))
            const selected = isActive && selection.includes(index)
            return (
              <div className="slot-wrap" key={index}>
                <span>{index + 1}</span>
                <button
                  data-frame={isActive ? index : undefined}
                  className={`slot ${slot.layerId !== null ? 'assigned' : resolved !== null ? 'continued' : 'blank'} ${isActive && selectedSlot === index ? 'selected' : ''} ${selected ? 'multi' : ''} ${playing && playhead === index ? 'active' : ''}`}
                  onClick={(event) => {
                    if (!isActive) set({ activeTrack: trackIndex, selection: [] })
                    selectFrame(index, event)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    if (!isActive) set({ activeTrack: trackIndex })
                    setMenu({ x: event.clientX, y: event.clientY, index })
                  }}
                  draggable={slot.layerId !== null || selected}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-slot-index', String(index))
                    event.dataTransfer.setData('application/x-layer-id', String(slot.layerId))
                    event.dataTransfer.setData(
                      'application/x-selection',
                      selected ? selection.join(',') : '',
                    )
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const group = event.dataTransfer.getData('application/x-selection')
                    const sourceText = event.dataTransfer.getData('application/x-slot-index')
                    const source = Number(sourceText)
                    const layer = Number(event.dataTransfer.getData('application/x-layer-id'))
                    if (group) moveSelection(index, event.altKey)
                    else if (sourceText && !Number.isNaN(source)) {
                      const next = item.slots.slice()
                      if (!event.altKey) [next[source], next[index]] = [next[index]!, next[source]!]
                      else next[index] = { ...next[source]! }
                      state.commit()
                      set({
                        tracks: tracks.map((t, i) =>
                          i === trackIndex ? { ...t, slots: next } : t,
                        ),
                      })
                    } else if (layer) {
                      const targets = selected && selection.length ? selection : [index]
                      const next = item.slots.map((current, i) =>
                        targets.includes(i) ? { layerId: layer } : current,
                      )
                      state.commit()
                      set({
                        tracks: tracks.map((t, i) =>
                          i === trackIndex ? { ...t, slots: next } : t,
                        ),
                        activeTrack: trackIndex,
                      })
                    }
                  }}
                >
                  {bitmap && <SlotThumb bitmap={bitmap} />}
                  <b>
                    {resolved === null
                      ? '空白'
                      : slot.layerId === null
                        ? `延續 #${resolved}`
                        : `#${resolved}`}
                  </b>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <section className="timeline">
      <div className="tracks">{tracks.map(trackRow)}</div>
      <div className="timeline-tools">
        <button className="add-track" onClick={() => state.addTrack()} title="新增一層圖層軌道">
          ＋ 圖層
        </button>
        <button
          className="clear-canvas"
          title="清掉所有影格與多餘圖層，保留目前開啟的檔案"
          onClick={() =>
            void askConfirm(
              '清空畫布',
              '會清掉所有軌道上的影格、只留一層空白圖層。目前開啟的檔案與匯出設定會保留，按 Ctrl+Z 可以復原。',
              '清空',
            ).then((yes) => {
              if (!yes) return
              state.clearCanvas()
              state.toast('info', '已清空畫布')
            })
          }
        >
          🗑 清空畫布
        </button>
        <span className="divider" />
        <button className="frame-add" onClick={() => state.resizeFrames(frames + 1)}>
          ＋ 加一格
        </button>
        <button className="frame-remove" onClick={() => state.resizeFrames(frames - 1)}>
          − 減一格
        </button>
        <label>
          格數{' '}
          <input
            type="number"
            min="1"
            max="240"
            value={frames}
            onChange={(event) => state.resizeFrames(Number(event.target.value))}
          />{' '}
          格
        </label>
        <button onClick={() => state.undo()} disabled={!state.past.length} title="Ctrl+Z">
          ↶ 復原
        </button>
        <button onClick={() => state.redo()} disabled={!state.future.length} title="Ctrl+Shift+Z">
          ↷ 重做
        </button>
        <span className="divider" />
        <button
          className="import-timeline"
          disabled={timelines.length === 0}
          title={
            timelines.length === 0 ? '這個檔案沒有可用的 CSP 動畫時間軸' : '帶入 CSP 動畫時間軸'
          }
          onClick={() =>
            timelines.length === 1 ? void importTimeline(0) : setTimelineMenu((open) => !open)
          }
        >
          帶入 CSP 時間軸
        </button>
        {timelineMenu && (
          <div className="context timeline-picker">
            {timelines.map((timeline, index) => (
              <button
                key={`${timeline.animationFolderId}-${index}`}
                onClick={() => void importTimeline(index)}
              >
                {timeline.animationFolderName}
              </button>
            ))}
          </div>
        )}
        {selection.length > 0 && <em className="selection-count">已選 {selection.length} 格</em>}
      </div>
      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {menu && (
        <div
          className="context"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => setMenu(null)}
        >
          {(() => {
            const targets =
              selection.includes(menu.index) && selection.length ? selection : [menu.index]
            const label = targets.length > 1 ? `這 ${targets.length} 格` : '這格'
            return (
              <>
                <button
                  onClick={() => {
                    patchActive(
                      track.slots.map((slot, i) =>
                        targets.includes(i) ? { layerId: null } : slot,
                      ),
                    )
                    setMenu(null)
                  }}
                >
                  清除{label}並延續前格
                </button>
                <button
                  onClick={() => {
                    patchActive(
                      track.slots.map((slot, i) =>
                        targets.includes(i) ? { layerId: state.resolveSlot(i) } : slot,
                      ),
                    )
                    setMenu(null)
                  }}
                >
                  固定目前延續影格
                </button>
                <button
                  onClick={() => {
                    spliceAll(menu.index + 1, [], 1)
                    setMenu(null)
                  }}
                >
                  在後面插入一格（所有圖層）
                </button>
                <button
                  onClick={() => {
                    spliceAll(0, targets, 0)
                    setMenu(null)
                  }}
                >
                  刪除{label}（所有圖層）
                </button>
              </>
            )
          })()}
        </div>
      )}
    </section>
  )
}
