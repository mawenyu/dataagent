/**
 * P29: 安全上下文之外的 UUID v4。
 *
 * `crypto.randomUUID()` 只在 secure context（HTTPS / localhost）可用；
 * 本站以裸 HTTP 公网 IP 部署（http://101.34.246.179），该函数为 undefined，
 * 「新建会话」在第一行 `crypto.randomUUID()` 直接抛 TypeError —— 整个
 * 点击无任何效果（生产实测复现，2026-08-16）。
 *
 * 降级链：native randomUUID → getRandomValues 字节源 → Math.random。
 * 会话 id 仅作标识符（无安全用途），末级兜底可接受。
 */
export function uuid(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // RFC 4122 §4.4: version 4 + variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
}
