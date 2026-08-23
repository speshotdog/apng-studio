import { useEffect, useRef, useState } from 'react'
import type { LayerNode } from '../../preload/api.js'
import { bitmapKey, ensureBitmap } from '../compose.js'
import { useStore } from '../state/store.js'

function Thumb({ node }: { node: LayerNode }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const bitmap = useStore((state) => state.bitmaps.get(bitmapKey(node.id, state.visibility)))
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (node.type === 1584) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void ensureBitmap(node.id).catch(() => undefined)
        observer.disconnect()
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [node.id, node.type])
  useEffect(() => {
    const context = ref.current?.getContext('2d')
    if (!context || !bitmap) return
    context.clearRect(0, 0, 32, 32)
    context.drawImage(bitmap, 0, 0, 32, 32)
  }, [bitmap])
  const loaded = node.type === 1584 || Boolean(bitmap)
  return (
    <canvas
      className="thumb"
      width="32"
      height="32"
      ref={ref}
      data-layer-id={node.id}
      data-thumb-loaded={loaded}
    />
  )
}

function Row({ node, depth }: { node: LayerNode; depth: number }): React.JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const visibility = useStore((state) => state.visibility)
  const set = useStore((state) => state.set)
  const visible = visibility.get(node.id) ?? node.visible
  return (
    <>
      <div
        className="layer-row"
        style={{ paddingLeft: 10 + depth * 16 }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-layer-id', String(node.id))
          event.dataTransfer.effectAllowed = 'copyMove'
        }}
      >
        <button className="fold" onClick={() => setOpen(!open)}>
          {node.isFolder ? (open ? '▾' : '▸') : '·'}
        </button>
        <input
          aria-label="可見"
          type="checkbox"
          checked={visible}
          onChange={() => {
            const next = new Map(visibility)
            next.set(node.id, !visible)
            set({ visibility: next })
          }}
        />
        <Thumb node={node} />
        <span className="layer-name">{node.name || '未命名圖層'}</span>
        {node.isAnimationFolder && <small>動畫</small>}
      </div>
      {open && node.children.map((child) => <Row key={child.id} node={child} depth={depth + 1} />)}
    </>
  )
}

export function LayerPanel(): React.JSX.Element {
  const doc = useStore((state) => state.doc)
  return (
    <aside className="panel layers">
      <header>
        <span className="eyebrow">SOURCE</span>
        <h1>圖層</h1>
        {doc ? (
          <p>
            {doc.filePath.split(/[\\/]/).pop()}
            <br />
            {doc.canvas.width} × {doc.canvas.height} px
          </p>
        ) : (
          <p>開啟 .clip 開始製作</p>
        )}
      </header>
      <div className="tree">
        {doc?.tree.children.map((child) => (
          <Row key={child.id} node={child} depth={0} />
        ))}
      </div>
      <div className="drag-hint">拖曳圖層至下方影格軌</div>
    </aside>
  )
}
