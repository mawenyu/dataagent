import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ImageLightbox from './ImageLightbox.vue'

/** 多模态预览: 图片 lightbox —— 全屏遮罩大图,ESC/遮罩/× 关闭。 */

function box() {
  return document.body.querySelector('[data-testid="image-lightbox"]')
}

describe('ImageLightbox (多模态预览)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('渲染全屏大图 + 文件名', async () => {
    const w = mount(ImageLightbox, {
      props: { src: '/agui-api/files/chart.png', name: 'chart.png' },
      attachTo: document.body,
    })
    await nextTick()
    const el = box()!
    expect(el).toBeTruthy()
    const img = el.querySelector('[data-testid="image-lightbox-img"]') as HTMLImageElement
    expect(img.src).toContain('/agui-api/files/chart.png')
    expect(img.alt).toBe('chart.png')
    expect(el.textContent).toContain('chart.png')
    w.unmount()
  })

  it('ESC / 遮罩点击 / × 按钮均关闭', async () => {
    const w = mount(ImageLightbox, {
      props: { src: '/x/a.png', name: 'a.png' },
      attachTo: document.body,
    })
    await nextTick()
    ;(document.body.querySelector('[data-testid="image-lightbox-overlay"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(w.emitted('close')).toHaveLength(1)

    ;(document.body.querySelector('[data-testid="image-lightbox-overlay"]') as HTMLElement).click()
    await nextTick()
    expect(w.emitted('close')).toHaveLength(2)

    ;(box()!.querySelector('[data-testid="image-lightbox-close"]') as HTMLButtonElement).click()
    await nextTick()
    expect(w.emitted('close')).toHaveLength(3)
    w.unmount()
  })

  it('点图片本身不关闭(防止误触)', async () => {
    const w = mount(ImageLightbox, {
      props: { src: '/x/a.png', name: 'a.png' },
      attachTo: document.body,
    })
    await nextTick()
    ;(box()!.querySelector('[data-testid="image-lightbox-img"]') as HTMLImageElement).click()
    await nextTick()
    expect(w.emitted('close')).toBeUndefined()
    w.unmount()
  })

  it('可达性: role=dialog + aria-label', async () => {
    const w = mount(ImageLightbox, {
      props: { src: '/x/a.png', name: 'a.png' },
      attachTo: document.body,
    })
    await nextTick()
    const el = box()!
    expect(el.getAttribute('role')).toBe('dialog')
    expect(el.getAttribute('aria-modal')).toBe('true')
    expect(el.getAttribute('aria-label')).toContain('a.png')
    w.unmount()
  })
})
