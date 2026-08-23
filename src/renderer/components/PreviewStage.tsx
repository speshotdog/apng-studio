import { useEffect, useRef } from 'react'
import { drawFrame, ensureBitmap, frameLayerIds } from '../compose.js'
import { useStore } from '../state/store.js'
export function PreviewStage(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useStore()
  const { doc, playhead, fps, playing, previewLoop, exportWidth, exportHeight, scaleMode, set } =
    state
  const frames = state.frameCount()
  const draw = async (index: number): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas || !doc) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    await Promise.all(frameLayerIds(index).map((id) => ensureBitmap(id).catch(() => undefined)))
    drawFrame(ctx, index, canvas.width, canvas.height, scaleMode)
  }
  useEffect(() => {
    void draw(playhead)
  }, [
    playhead,
    doc,
    state.bitmaps,
    state.tracks,
    exportWidth,
    exportHeight,
    scaleMode,
    state.visibility,
  ])
  useEffect(() => {
    if (!playing || !frames) return
    let raf = 0,
      last = performance.now(),
      accumulated = 0,
      loops = 0
    const tick = (now: number) => {
      accumulated += now - last
      last = now
      const duration = 1000 / fps
      if (accumulated >= duration) {
        accumulated %= duration
        const current = useStore.getState().playhead
        if (current >= frames - 1) {
          loops++
          if (!previewLoop && loops >= 1) {
            set({ playing: false, playhead: frames - 1 })
            return
          }
          set({ playhead: 0 })
        } else set({ playhead: current + 1 })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, fps, previewLoop, frames])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input, textarea, select')) return
      if (e.code === 'Space') {
        e.preventDefault()
        set({ playing: !useStore.getState().playing })
      } else if (e.key === 'ArrowLeft')
        set({ playing: false, playhead: Math.max(0, useStore.getState().playhead - 1) })
      else if (e.key === 'ArrowRight')
        set({ playing: false, playhead: Math.min(frames - 1, useStore.getState().playhead + 1) })
      else if (e.key === 'Home') set({ playing: false, playhead: 0 })
      else if (e.key === 'End') set({ playing: false, playhead: frames - 1 })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [frames])
  return (
    <section className="preview">
      <div className="stage">
        {doc ? (
          <div className="canvas-preview">
            <canvas
              ref={canvasRef}
              width={exportWidth}
              height={exportHeight}
              style={{
                imageRendering:
                  state.lineTarget === 'plurkEmoticon' || scaleMode === 'pixel'
                    ? 'pixelated'
                    : 'auto',
              }}
              aria-label={`輸出預覽 ${exportWidth} × ${exportHeight}`}
            />
            <small>
              {exportWidth} × {exportHeight}
            </small>
          </div>
        ) : (
          <div className="welcome">
            <i>AP</i>
            <h2>把動作留在畫布上</h2>
            <p>拖入 .clip／.procreate，或從「檔案」選單開啟</p>
          </div>
        )}
      </div>
      <div className="transport">
        <button
          onKeyDown={(e) => e.currentTarget.blur()}
          onClick={() => set({ playing: false, playhead: 0 })}
        >
          ⏮
        </button>
        <button
          onKeyDown={(e) => e.currentTarget.blur()}
          className="play"
          onClick={() => set({ playing: !playing })}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          onKeyDown={(e) => e.currentTarget.blur()}
          onClick={() => set({ playing: false, playhead: frames - 1 })}
        >
          ⏭
        </button>
        <button
          onKeyDown={(e) => e.currentTarget.blur()}
          className={previewLoop ? 'on' : ''}
          onClick={() => set({ previewLoop: !previewLoop })}
          title="循環預覽"
        >
          ↻
        </button>
        <span>
          第 {playhead + 1} / {frames} 格
        </span>
        <em>{fps} FPS</em>
      </div>
    </section>
  )
}
