/** SourceAsset、EditorDocument 與軌道共用的穩定 id 產生方式。 */
export function createEntityId(): string {
  return crypto.randomUUID()
}
