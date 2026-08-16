/**
 * FORK-PATCH(24 activity-parse-cache): activity 消息内容 zod 校验记忆化。
 *
 * 背景（收尾2 性能）：消息列表每个流式 delta 都触发重渲，activity 消息的
 * renderer 解析（renderer.content.safeParse —— 大型 discriminated union
 * 校验整棵 A2UI ops 树）随之全量重跑。CDP profiler 实锤热点 = zod
 * _parse/_parseSync + GC 抖动，长 reasoning 时秒级冻结主线程。
 *
 * 语义：同一条 message 上，content 引用不变 ⇒ 复用上次的 parse 结果；
 * content 引用变化（ACTIVITY_SNAPSHOT 更新）⇒ 重新 parse。
 * WeakMap 键随消息回收，不泄漏。
 */
interface SafeParseLike {
  safeParse(input: unknown): unknown;
}

const cache = new WeakMap<object, { content: unknown; result: unknown }>();

export function safeParseActivityContent<T extends SafeParseLike>(
  schema: T,
  message: object,
  content: unknown,
): ReturnType<T["safeParse"]> {
  const hit = cache.get(message);
  if (hit && hit.content === content) {
    return hit.result as ReturnType<T["safeParse"]>;
  }
  const result = schema.safeParse(content) as ReturnType<T["safeParse"]>;
  cache.set(message, { content, result });
  return result;
}
