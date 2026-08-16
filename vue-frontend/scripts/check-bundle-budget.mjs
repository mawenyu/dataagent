#!/usr/bin/env node
/**
 * P28-A: bundle 性能预算断言（CI 可挂，超预算 exit 1 报红）。
 *
 * 口径：dist/.vite/manifest.json（需 `vite build --manifest` 产物）里每个
 * entry 的「初始 JS」= entry chunk + 静态 imports 递归闭包（dynamic import
 * 不计入），逐文件真实 gzip 求和。预算：单入口初始 JS gzip < 500KB。
 *
 * 用法：npm run build -- --manifest && node scripts/check-bundle-budget.mjs
 */
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const BUDGET_KB = 500
const dist = new URL('../dist', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf-8'))

const gzipSize = (file) => gzipSync(readFileSync(join(dist, file))).length

/** entry 静态依赖闭包的 gzip 字节和（同一 chunk 只计一次）。 */
function initialJsGzip(entryKey) {
  const seen = new Set()
  const walk = (key) => {
    if (seen.has(key)) return 0
    seen.add(key)
    const e = manifest[key]
    if (!e) return 0
    let bytes = e.file.endsWith('.js') ? gzipSize(e.file) : 0
    for (const imp of e.imports ?? []) bytes += walk(imp)
    return bytes
  }
  return walk(entryKey)
}

const entries = Object.entries(manifest).filter(([, e]) => e.isEntry)
if (entries.length === 0) {
  console.error('manifest 无 entry —— 先跑 vite build --manifest')
  process.exit(2)
}

let failed = false
console.log(`bundle 预算: 单入口初始 JS gzip < ${BUDGET_KB}KB\n`)
for (const [key, e] of entries) {
  const kb = initialJsGzip(key) / 1024
  const ok = kb < BUDGET_KB
  if (!ok) failed = true
  console.log(`${ok ? '✅' : '❌'} ${key.padEnd(24)} ${kb.toFixed(1)}KB  (entry: ${e.file})`)
}
if (failed) {
  console.error(`\n超预算 —— 检查新引入的静态依赖,重依赖请改动态 import`)
  process.exit(1)
}
console.log('\n全部入口在预算内')
