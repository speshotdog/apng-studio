export interface SaveRequestToken {
  projectId: string
  projectRevision: number
}

export interface SaveCoordinatorState {
  projectId: string | null
  projectRevision: number
  savedRevision: number
}

export type SaveCoordinatorResult<Value> =
  { status: 'completed'; value: Value } | { status: 'skipped' }

export interface SaveCoordinatorRuntime<Value> {
  state(): SaveCoordinatorState
  commit(token: SaveRequestToken, value: Value): void
}

/**
 * 同一專案的正式存檔與 autosave 共用一條序列佇列。不同專案互不阻塞，
 * 且只有仍開著同一專案、revision 尚未被較新存檔涵蓋時才提交完成結果。
 */
export class SaveCoordinator<Value> {
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly runtime: SaveCoordinatorRuntime<Value>) {}

  save(
    operation: (token: SaveRequestToken) => Promise<Value>,
  ): Promise<SaveCoordinatorResult<Value>> {
    const token = this.capture()
    if (!token) return Promise.resolve({ status: 'skipped' })
    return this.enqueue(token, async () => {
      if (this.runtime.state().projectId !== token.projectId) return { status: 'skipped' }
      const value = await operation(token)
      const current = this.runtime.state()
      if (current.projectId === token.projectId && current.savedRevision < token.projectRevision) {
        this.runtime.commit(token, value)
      }
      return { status: 'completed', value }
    })
  }

  autosave(
    operation: (token: SaveRequestToken) => Promise<void>,
  ): Promise<SaveCoordinatorResult<void>> {
    const token = this.capture()
    if (!token) return Promise.resolve({ status: 'skipped' })
    return this.enqueue(token, async () => {
      const current = this.runtime.state()
      // 正式存檔可能在這筆 autosave 等待期間完成；舊快照不可再建回 autosave。
      if (
        current.projectId !== token.projectId ||
        current.projectRevision === current.savedRevision ||
        current.savedRevision >= token.projectRevision
      ) {
        return { status: 'skipped' }
      }
      await operation(token)
      return { status: 'completed', value: undefined }
    })
  }

  private capture(): SaveRequestToken | null {
    const state = this.runtime.state()
    return state.projectId
      ? { projectId: state.projectId, projectRevision: state.projectRevision }
      : null
  }

  private enqueue<Result>(
    token: SaveRequestToken,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.tails.get(token.projectId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(token.projectId, tail)
    void tail.finally(() => {
      if (this.tails.get(token.projectId) === tail) this.tails.delete(token.projectId)
    })
    return result
  }
}
