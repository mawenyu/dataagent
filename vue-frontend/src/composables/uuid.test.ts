import { afterEach, describe, expect, it, vi } from 'vitest'
import { uuid } from './uuid'

/**
 * P29: 裸 HTTP 部署（非安全上下文）下 crypto.randomUUID 不存在，
 * uuid() 必须降级仍产出合法 v4 UUID —— 否则「新建会话」首行即抛。
 */

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid (P29 非安全上下文降级)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('有 randomUUID 时直接用原生实现', () => {
    const native = vi.fn(() => '00000000-0000-4000-8000-000000000000')
    vi.stubGlobal('crypto', { randomUUID: native })
    expect(uuid()).toBe('00000000-0000-4000-8000-000000000000')
    expect(native).toHaveBeenCalledTimes(1)
  })

  it('randomUUID 缺失（裸 HTTP）→ getRandomValues 降级，格式合法且唯一', () => {
    const realCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    })
    const ids = new Set(Array.from({ length: 200 }, () => uuid()))
    for (const id of ids) expect(id).toMatch(V4)
    expect(ids.size, '200 次生成不得有碰撞').toBe(200)
  })

  it('crypto 整体缺失 → Math.random 兜底，仍是合法 v4 格式', () => {
    vi.stubGlobal('crypto', undefined)
    const id = uuid()
    expect(id).toMatch(V4)
  })
})
