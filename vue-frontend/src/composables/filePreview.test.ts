import { describe, expect, it, vi } from 'vitest'
import {
  fetchPdfPreviewUrl,
  isImage,
  isPdf,
  isPreviewable,
  parseCsvPreview,
  prettyJson,
  renderMarkdownLite,
} from './filePreview'

/** P-C: 文件在线预览的纯函数层 —— CSV 解析 / JSON 美化 / 轻量 Markdown 渲染。 */

describe('isPreviewable', () => {
  it('csv/json/md/txt/log/tsv 可预览,xlsx 不可', () => {
    expect(isPreviewable('a.csv')).toBe(true)
    expect(isPreviewable('B.JSON')).toBe(true)
    expect(isPreviewable('notes.md')).toBe(true)
    expect(isPreviewable('x.txt')).toBe(true)
    expect(isPreviewable('y.log')).toBe(true)
    expect(isPreviewable('z.tsv')).toBe(true)
    expect(isPreviewable('book.xlsx')).toBe(false)
    expect(isPreviewable('noext')).toBe(false)
  })

  it('P32: 图片扩展名可预览(img 标签直渲,不走文本拉取)', () => {
    expect(isPreviewable('p.png')).toBe(true)
    expect(isPreviewable('photo.JPG')).toBe(true)
    expect(isPreviewable('icon.svg')).toBe(true)
  })

  it('多模态预览: pdf 可预览(iframe 直渲,不走文本拉取)', () => {
    expect(isPreviewable('report.pdf')).toBe(true)
    expect(isPreviewable('Report.PDF')).toBe(true)
  })
})

describe('isPdf (多模态预览)', () => {
  it('pdf 判定(大小写不敏感);csv/png/xlsx 不是 pdf', () => {
    expect(isPdf('a.pdf')).toBe(true)
    expect(isPdf('B.PDF')).toBe(true)
    expect(isPdf('a.csv')).toBe(false)
    expect(isPdf('a.png')).toBe(false)
    expect(isPdf('a.xlsx')).toBe(false)
    expect(isPdf('noext')).toBe(false)
  })
})

describe('fetchPdfPreviewUrl (多模态预览)', () => {
  it('拉取字节 → blob: URL(application/pdf 类型,绕过 attachment disposition)', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    })))
    const createObjectURL = vi.fn(() => 'blob:pdf-mock')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL }))

    const url = await fetchPdfPreviewUrl('/agui-api/files/r.pdf')
    expect(url).toBe('blob:pdf-mock')
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBe(4)
    vi.unstubAllGlobals()
  })

  it('HTTP 失败抛错(调用方降级为提示)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    await expect(fetchPdfPreviewUrl('/x/missing.pdf')).rejects.toThrow('404')
    vi.unstubAllGlobals()
  })
})

describe('isImage (P32)', () => {
  it('png/jpg/jpeg/gif/webp/svg/bmp/avif/ico 判定为图片(大小写不敏感)', () => {
    for (const n of ['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg', 'g.bmp', 'h.avif', 'i.ico', 'J.PNG']) {
      expect(isImage(n), n).toBe(true)
    }
  })

  it('csv/md/xlsx/无扩展名不是图片', () => {
    for (const n of ['a.csv', 'b.md', 'c.xlsx', 'noext']) {
      expect(isImage(n), n).toBe(false)
    }
  })
})

describe('parseCsvPreview', () => {
  it('基础逗号拆分 + CRLF 归一', () => {
    expect(parseCsvPreview('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('引号字段: 内含逗号/换行/转义双引号', () => {
    const text = 'name,note\r\n"张,三","第一行\n第二行"\r\n"a""b",x'
    expect(parseCsvPreview(text)).toEqual([
      ['name', 'note'],
      ['张,三', '第一行\n第二行'],
      ['a"b', 'x'],
    ])
  })

  it('空行忽略,尾部空行去掉', () => {
    expect(parseCsvPreview('a,b\n\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('空文本 → 空数组', () => {
    expect(parseCsvPreview('')).toEqual([])
  })
})

describe('prettyJson', () => {
  it('合法 JSON 美化缩进', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  it('非法 JSON 原样返回', () => {
    expect(prettyJson('{oops')).toBe('{oops')
  })
})

describe('renderMarkdownLite', () => {
  it('标题/加粗/斜体/行内代码', () => {
    const html = renderMarkdownLite('# 标题\n**粗** 和 *斜* 和 `code`')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<code>code</code>')
  })

  it('XSS 防护: HTML 先转义,脚本不执行', () => {
    const html = renderMarkdownLite('<script>alert(1)</script>**ok**')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<strong>ok</strong>')
  })

  it('代码块: 内容不再做行内变换', () => {
    const html = renderMarkdownLite('```\n**not-bold** <b>x</b>\n```')
    expect(html).toContain('<pre><code>')
    expect(html).toContain('**not-bold**')
    expect(html).toContain('&lt;b&gt;')
  })

  it('无序列表', () => {
    const html = renderMarkdownLite('- 甲\n- 乙')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<li>乙</li>')
  })

  it('GFM 表格', () => {
    const html = renderMarkdownLite('| 区域 | 额 |\n| --- | --- |\n| 华北 | 100 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>区域</th>')
    expect(html).toContain('<td>华北</td>')
  })

  it('链接仅放行 http/https,文本转义', () => {
    const html = renderMarkdownLite('[官网](https://example.com) [坏](javascript:alert(1))')
    expect(html).toContain('<a href="https://example.com"')
    expect(html).not.toContain('javascript:')
  })

  it('普通段落换行保留为 <br>', () => {
    const html = renderMarkdownLite('第一行\n第二行')
    expect(html).toContain('第一行<br>')
  })
})
