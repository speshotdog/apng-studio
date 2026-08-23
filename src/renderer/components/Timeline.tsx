import { useState } from 'react'
import { bitmapKey } from '../compose.js'
import { useStore } from '../state/store.js'
function SlotThumb({ bitmap }: { bitmap: ImageBitmap }): React.JSX.Element {
  return (
    <canvas
      width={bitmap.width}
      height={bitmap.height}
      ref={(canvas) => canvas?.getContext('2d')?.drawImage(bitmap, 0, 0)}
    />
  )
}

export function Timeline(): React.JSX.Element {
  const {
    doc,
    slots,
    setSlot,
    resolveSlot,
    bitmaps,
    selectedSlot,
    playhead,
    playing,
    set,
    importCspTimeline,
  } = useStore()
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [timelineMenu, setTimelineMenu] = useState(false)
  const timelines = doc?.cspTimelines ?? []
  const importTimeline = (index: number) => {
    if (
      slots.some((slot) => slot.layerId !== null) &&
      !window.confirm('目前影格軌已有內容，確定要覆蓋嗎？')
    )
      return
    importCspTimeline(index)
    setTimelineMenu(false)
  }
  const resize = (count: number) => {
    const nextLength = Math.max(1, count)
    set({
      slots:
        nextLength > slots.length
          ? [
              ...slots,
              ...Array.from({ length: nextLength - slots.length }, () => ({ layerId: null })),
            ]
          : slots.slice(0, nextLength),
      selectedSlot: Math.min(selectedSlot, nextLength - 1),
      playhead: Math.min(playhead, nextLength - 1),
    })
  }
  return (
    <section className="timeline">
      <div className="slots">
        {slots.map((slot, index) => {
          const resolved = resolveSlot(index)
          const bitmap =
            resolved === null
              ? undefined
              : bitmaps.get(bitmapKey(resolved, useStore.getState().visibility))
          return (
            <div className="slot-wrap" key={index}>
              <span>{index + 1}</span>
              <button
                className={`slot ${slot.layerId !== null ? 'assigned' : resolved !== null ? 'continued' : 'blank'} ${selectedSlot === index ? 'selected' : ''} ${playing && playhead === index ? 'active' : ''}`}
                onClick={() => set({ selectedSlot: index, playhead: index, playing: false })}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, index })
                }}
                draggable={slot.layerId !== null}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-slot-index', String(index))
                  e.dataTransfer.setData('application/x-layer-id', String(slot.layerId))
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const sourceText = e.dataTransfer.getData('application/x-slot-index')
                  const source = Number(sourceText)
                  const layer = Number(e.dataTransfer.getData('application/x-layer-id'))
                  if (sourceText && !Number.isNaN(source)) {
                    const next = slots.slice()
                    if (!e.altKey) [next[source], next[index]] = [next[index]!, next[source]!]
                    else next[index] = { ...next[source]! }
                    set({ slots: next })
                  } else if (layer) setSlot(index, layer)
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
      <div className="timeline-tools">
        <button onClick={() => resize(slots.length + 1)}>＋ 加一格</button>
        <button onClick={() => resize(slots.length - 1)}>− 減一格</button>
        <button
          disabled={timelines.length === 0}
          title={
            timelines.length === 0 ? '這個 .clip 沒有可用的 CSP 動畫時間軸' : '帶入 CSP 動畫時間軸'
          }
          onClick={() =>
            timelines.length === 1 ? importTimeline(0) : setTimelineMenu((open) => !open)
          }
        >
          帶入 CSP 時間軸
        </button>
        {timelineMenu && (
          <div className="context timeline-picker">
            {timelines.map((timeline, index) => (
              <button
                key={`${timeline.animationFolderId}-${index}`}
                onClick={() => importTimeline(index)}
              >
                {timeline.animationFolderName}
              </button>
            ))}
          </div>
        )}
        <label>
          格數{' '}
          <input
            type="number"
            min="1"
            max="120"
            value={slots.length}
            onChange={(e) => resize(Number(e.target.value))}
          />{' '}
          格
        </label>
      </div>
      {menu && (
        <div
          className="context"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => setMenu(null)}
        >
          <button
            onClick={() => {
              setSlot(menu.index, null)
              setMenu(null)
            }}
          >
            清除這格並延續前格
          </button>
          <button
            onClick={() => {
              setSlot(menu.index, resolveSlot(menu.index))
              setMenu(null)
            }}
          >
            固定目前延續影格
          </button>
          <button
            onClick={() => {
              const next = slots.slice()
              next.splice(menu.index + 1, 0, { layerId: null })
              set({ slots: next })
              setMenu(null)
            }}
          >
            在後面插入一格
          </button>
          <button
            onClick={() => {
              const next = slots.slice()
              next.splice(menu.index, 1)
              set({ slots: next.length ? next : [{ layerId: null }] })
              setMenu(null)
            }}
          >
            刪除這格
          </button>
        </div>
      )}
    </section>
  )
}
