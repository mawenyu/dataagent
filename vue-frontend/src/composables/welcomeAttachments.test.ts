import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useWelcomeAttachments } from './welcomeAttachments'

/**
 * F1b: 欢迎页 ChatGPT 式附件上传（task6-B 的欢迎页补完）。
 * 选中即上传到当前会话工作目录（upload 由调用方绑定会话级 API），
 * chip 可删；发送时附件文件名拼进消息文本带给 agent。
 */

function makeFile(name: string, size = 10): File {
  return new File(['x'.repeat(size)], name, { type: 'text/csv' })
}

function setup(overrides?: { upload?: (f: File) => Promise<void>; onFailed?: (msg: string) => void }) {
  const upload = overrides?.upload ?? vi.fn(async () => {})
  const onFailed = overrides?.onFailed ?? vi.fn()
  const threadId = ref('t-1')
  const api = useWelcomeAttachments({ upload, onFailed, threadId })
  return { api, upload, onFailed, threadId }
}

describe('useWelcomeAttachments (F1b)', () => {
  it('冷启动竞态: threadId 为空时 chip 与上传都等就绪,不被 watch 清掉', async () => {
    const upload = vi.fn(async () => {})
    const onFailed = vi.fn()
    const threadId = ref('')
    const api = useWelcomeAttachments({ upload, onFailed, threadId })
    const p = api.addFiles([makeFile('cold.csv')])
    await new Promise((r) => setTimeout(r, 30))
    // 就绪前: 不加 chip、不上传（否则 threadId watch 会把 chip 抹掉,文件却传了）
    expect(api.items.value).toHaveLength(0)
    expect(upload).not.toHaveBeenCalled()
    threadId.value = 't-late'
    await p
    expect(api.items.value).toHaveLength(1)
    expect(api.items.value[0].status).toBe('ready')
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('选中文件即上传,成功后 chip 为 ready', async () => {
    const { api, upload } = setup()
    await api.addFiles([makeFile('sales.csv', 2048)])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(api.items.value).toHaveLength(1)
    expect(api.items.value[0]).toMatchObject({ name: 'sales.csv', size: 2048, status: 'ready' })
  })

  it('拒绝 gateway 白名单外的文件名(中文/非法字符),不上报 upload', async () => {
    const onFailed = vi.fn()
    const { api, upload } = setup({ onFailed })
    await api.addFiles([makeFile('销售数据.csv')])
    expect(upload).not.toHaveBeenCalled()
    expect(api.items.value).toHaveLength(0)
    expect(onFailed).toHaveBeenCalledWith(expect.stringContaining('销售数据.csv'))
  })

  it('拒绝不支持的扩展名与超大文件', async () => {
    const onFailed = vi.fn()
    const { api, upload } = setup({ onFailed })
    await api.addFiles([makeFile('evil.exe')])
    const big = makeFile('big.csv')
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 })
    await api.addFiles([big])
    expect(upload).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledTimes(2)
  })

  it('上传失败 chip 标 error 并回调 onFailed,可删除', async () => {
    const onFailed = vi.fn()
    const { api } = setup({ upload: vi.fn(async () => { throw new Error('HTTP 413') }), onFailed })
    await api.addFiles([makeFile('a.csv')])
    expect(api.items.value[0].status).toBe('error')
    expect(onFailed).toHaveBeenCalledWith(expect.stringContaining('a.csv'))
    api.remove(api.items.value[0].id)
    expect(api.items.value).toHaveLength(0)
  })

  it('consumeForSubmit: 文本+附件 → 附件名拼进消息并清空 ready chip', async () => {
    const { api } = setup()
    await api.addFiles([makeFile('a.csv'), makeFile('b.xlsx')])
    const msg = api.consumeForSubmit('分析这两个文件')
    expect(msg).toContain('分析这两个文件')
    expect(msg).toContain('a.csv')
    expect(msg).toContain('b.xlsx')
    expect(api.items.value).toHaveLength(0)
  })

  it('consumeForSubmit: 纯附件(无文本) → 回退引导语 + 附件引用', async () => {
    const { api } = setup()
    await api.addFiles([makeFile('a.csv')])
    const msg = api.consumeForSubmit('   ')
    expect(msg).toContain('请分析我上传的数据文件')
    expect(msg).toContain('a.csv')
  })

  it('consumeForSubmit: 无文本无附件 → null(不可发送)', () => {
    const { api } = setup()
    expect(api.consumeForSubmit('  ')).toBeNull()
  })

  it('consumeForSubmit: 有 chip 正在上传 → null(阻塞发送)', async () => {
    let release!: () => void
    const blocked = new Promise<void>((r) => { release = r })
    const { api } = setup({ upload: vi.fn(() => blocked) })
    const adding = api.addFiles([makeFile('a.csv')])
    // 上传未决时 chip 为 uploading（awaitThreadId 就绪检查后异步落 chip,先等一拍）
    await new Promise((r) => setTimeout(r, 0))
    expect(api.items.value[0].status).toBe('uploading')
    expect(api.consumeForSubmit('你好')).toBeNull()
    release()
    await adding
    expect(api.consumeForSubmit('你好')).toContain('你好')
  })

  it('hasReady: 有 ready 附件时发送按钮应可用', async () => {
    const { api } = setup()
    expect(api.hasReady.value).toBe(false)
    await api.addFiles([makeFile('a.csv')])
    expect(api.hasReady.value).toBe(true)
  })

  it('切换会话清空暂存的 chip(附件属于旧会话目录)', async () => {
    const { api, threadId } = setup()
    await api.addFiles([makeFile('a.csv')])
    expect(api.items.value).toHaveLength(1)
    threadId.value = 't-2'
    await Promise.resolve()
    expect(api.items.value).toHaveLength(0)
  })
})

describe('P-J: 限制提示补强', () => {
  it('0 字节空文件拒绝并明确提示,不上传', async () => {
    const onFailed = vi.fn()
    const { api, upload } = setup({ onFailed })
    await api.addFiles([makeFile('empty.csv', 0)])
    expect(upload).not.toHaveBeenCalled()
    expect(api.items.value).toHaveLength(0)
    expect(onFailed).toHaveBeenCalledWith(expect.stringContaining('空文件'))
  })

  it('超限文件报错消息含 50MB 上限说明(非静默)', async () => {
    const onFailed = vi.fn()
    const { api, upload } = setup({ onFailed })
    const big = makeFile('big.csv')
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 })
    await api.addFiles([big])
    expect(upload).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledWith(expect.stringContaining('50MB'))
  })

  it('上传失败的 chip 携带错误原因(errorMessage 供悬停/展示)', async () => {
    const { api } = setup({ upload: vi.fn(async () => { throw new Error('HTTP 413') }) })
    await api.addFiles([makeFile('a.csv')])
    expect(api.items.value[0].status).toBe('error')
    expect(api.items.value[0].errorMessage).toContain('413')
  })
})
