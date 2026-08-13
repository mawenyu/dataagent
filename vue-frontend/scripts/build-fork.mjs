#!/usr/bin/env node
/**
 * vue-frontend 的 predev/prebuild 钩子：构建 @copilotkit/vue fork。
 * fork dist 比 src 新则跳过（避免每次 dev/build 都全量重编 fork）。
 * 跨平台（npm 在 Windows 上是 npm.cmd，故用 shell:true）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 脚本在 vue-frontend/scripts/ 下，fork 在仓库根 packages/copilotkit-vue
const forkDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/copilotkit-vue')
const distMarker = join(forkDir, 'dist', 'index.mjs')

function newestMtime(dir) {
  let max = 0
  if (!existsSync(dir)) return 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) max = Math.max(max, newestMtime(p))
    else max = Math.max(max, statSync(p).mtimeMs)
  }
  return max
}

const distFresh = existsSync(distMarker) && statSync(distMarker).mtimeMs >= newestMtime(join(forkDir, 'src'))
if (distFresh) {
  console.log('[build-fork] fork dist 已是最新，跳过构建')
  process.exit(0)
}

function run(cmd, args) {
  // stdio:pipe（inherit 在本机低内存环境下 npm install 会被杀/信号退出）
  const r = spawnSync(cmd, args, { cwd: forkDir, stdio: 'pipe', shell: true, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`[build-fork] ${cmd} ${args.join(' ')} failed (status=${r.status} signal=${r.signal})`)
    if (r.stderr) console.error(r.stderr.slice(-2000))
    process.exit(r.status ?? 1)
  }
}

console.log('[build-fork] fork src 有更新，重新构建 @copilotkit/vue …')
run('npm', ['install'])
run('npm', ['run', 'build'])
