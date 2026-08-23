import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const exe = join(root, 'release', 'APNG-Studio-0.1.0-portable.exe')
const output = join(root, 'out', 'smoke')
const clip = join(root, 'assets', 'samples', '11.clip')
await access(exe)

await new Promise((resolveRun, reject) => {
  const child = spawn(exe, [`--smoke-clip=${clip}`, `--smoke-output=${output}`], {
    stdio: 'inherit',
  })
  const timeout = setTimeout(() => {
    child.kill()
    reject(new Error('Packaged app smoke 超過 60 秒'))
  }, 60_000)
  child.once('error', reject)
  child.once('exit', (code) => {
    clearTimeout(timeout)
    code === 0 ? resolveRun() : reject(new Error(`Packaged app 結束碼 ${code}`))
  })
})

const screenshot = await readFile(join(output, 'ui-packaged.png'))
const exported = await readFile(join(output, 'packaged-export.png'))
assert.ok(screenshot.length > 0, 'packaged app 截圖不可為空')
assert.deepEqual([...exported.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
console.log(`Packaged app 通過：已開啟 11.clip、匯出 APNG 並截圖（${screenshot.length} bytes）`)
