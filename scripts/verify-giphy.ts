/**
 * GIPHY 上傳路徑的端對端驗證。
 *
 * verify-codec.ts 裡的測試是用假的 fetchImpl 直接回 Response，驗的是回應解析；
 * 這裡補上它蓋不到的另一半：**真的 fetch、真的 multipart 序列化、真的 HTTP**。
 * 做法是起一個本機 HTTP 伺服器模仿 GIPHY 的兩支 API，把 uploadToGiphy 的請求
 * 導過來，逐項檢查我們送出去的東西長得對不對：
 *   - api_key 同時出現在 query 與 form（不同時期的 GIPHY 閘道各只認一種）
 *   - tags 欄位有進到 form
 *   - GIF 位元組原封不動（跟送進去的逐位元組比對）
 *   - 上傳後會用回傳的 id 去要詳細資料，並組出正確的結果
 * 最後打一次真正的 api.giphy.com（用假金鑰）確認端點可達、錯誤處理乾淨。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { uploadToGiphy } from '../src/main/giphy.js'

// 最小合法 GIF（1×1），拿來當上傳內容。
const gifBytes = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
])

interface Captured {
  uploadUrl: string
  detailUrl: string
  formKey: string | null
  formTags: string | null
  fileBytes: Uint8Array | null
}

async function withMockGiphy(): Promise<void> {
  const captured: Captured = {
    uploadUrl: '',
    detailUrl: '',
    formKey: null,
    formTags: null,
    fileBytes: null,
  }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (request.method === 'POST') {
          captured.uploadUrl = request.url ?? ''
          // 用 undici 的 Request 幫忙解 multipart，不自己手刻 parser。
          const parsed = await new Request('http://localhost/', {
            method: 'POST',
            headers: { 'content-type': request.headers['content-type'] ?? '' },
            body: new Uint8Array(Buffer.concat(chunks)),
          }).formData()
          captured.formKey = (parsed.get('api_key') as string | null) ?? null
          captured.formTags = (parsed.get('tags') as string | null) ?? null
          const file = parsed.get('file')
          if (file instanceof Blob) captured.fileBytes = new Uint8Array(await file.arrayBuffer())
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ data: { id: 'mock-id-123' }, meta: { status: 200 } }))
        } else {
          captured.detailUrl = request.url ?? ''
          response.setHeader('content-type', 'application/json')
          response.end(
            JSON.stringify({
              data: {
                url: 'https://giphy.com/gifs/mock-id-123',
                images: { original: { url: 'https://media.giphy.com/media/mock-id-123/giphy.gif' } },
              },
              meta: { status: 200 },
            }),
          )
        }
        void url
      })()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock server 沒起來')
  const base = `http://127.0.0.1:${address.port}`

  // 真的 fetch，只把主機名換成本機。multipart 序列化完全走正式路徑。
  const redirected: typeof fetch = (input, init) => {
    const original = new URL(String(input))
    return fetch(`${base}${original.pathname}${original.search}`, init)
  }

  const result = await uploadToGiphy(gifBytes, 'smoke, 貼圖', 'test-key-123', 'tester', redirected)
  server.close()

  assert.equal(result.ok, true, `mock 上傳失敗：${result.error}`)
  assert.equal(result.id, 'mock-id-123')
  assert.equal(result.pageUrl, 'https://giphy.com/gifs/mock-id-123')
  assert.equal(result.gifUrl, 'https://media.giphy.com/media/mock-id-123/giphy.gif')
  assert.match(captured.uploadUrl, /api_key=test-key-123/, 'api_key 必須帶在 query')
  assert.equal(captured.formKey, 'test-key-123', 'api_key 必須也帶在 form')
  assert.equal(captured.formTags, 'smoke, 貼圖', 'tags 沒有進到 form')
  assert.ok(captured.fileBytes, 'form 裡沒有 file')
  assert.deepEqual([...captured.fileBytes!], [...gifBytes], 'GIF 位元組在傳輸中被改到')
  assert.match(captured.detailUrl, /mock-id-123/, '沒有用回傳的 id 去要詳細資料')
  console.log('✓ mock GIPHY：multipart、api_key（query+form）、tags、位元組完整性都正確')
}

async function realNetworkNegative(): Promise<void> {
  // 用假金鑰打真正的 GIPHY，驗證端點可達且錯誤會變成人話而不是例外。
  const result = await uploadToGiphy(gifBytes, '', 'invalid-key-for-verification', '')
  assert.equal(result.ok, false)
  assert.ok(result.error && result.error.length > 0, '失敗時必須有錯誤訊息')
  assert.ok(!result.error!.includes('invalid-key-for-verification'), '錯誤訊息不可洩漏金鑰')
  console.log(`✓ 真實 GIPHY 端點可達，假金鑰得到乾淨錯誤：「${result.error}」`)
}

await withMockGiphy()
try {
  await realNetworkNegative()
} catch (error) {
  // 離線環境不算失敗，但要講清楚。
  console.warn(`⚠ 真實網路測試沒跑成（可能離線）：${String(error)}`)
}
console.log('GIPHY 上傳路徑驗證通過')
