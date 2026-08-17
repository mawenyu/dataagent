/**
 * 瘦身(2026-08-17): phoenix 模块 shim。
 *
 * @copilotkit/core 顶层 `import { Socket } from "phoenix"`(10.2KB gz),
 * 但 Socket 只在 ɵphoenixSocket$ 冷 Observable 被订阅时构造 —— 那是
 * CopilotKit Cloud(托管模式) 的 threads/memories realtime 通道;
 * 本应用走 direct-agents + 自建 gateway,永不订阅。
 * vite resolve.alias 把精确名 'phoenix' 指到本文件,把整库挤出首屏 bundle。
 * 若未来误触该路径,构造即抛错(显式失败,不静默)。
 */
export class Socket {
  constructor() {
    throw new Error('[DataAgent] phoenix realtime 未启用(direct-agents 模式),不该走到这里')
  }
}
export class Channel {}
export class Presence {}
export class LongPoll {}
export class Ajax {}
export default { Socket, Channel, Presence, LongPoll, Ajax }
