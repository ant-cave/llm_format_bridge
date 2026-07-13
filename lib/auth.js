/**
 * LLM Format Bridge — 鉴权模块
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 对每个下游请求进行 Bearer Token 校验。
 * 每个 downstream 有独立 api_key，客户端需在 Authorization 请求头中携带。
 */

/**
 * 校验下游请求的 Authorization 请求头。
 * 支持标准 Bearer Token 格式：`Authorization: Bearer <key>`
 * 也兼容直接传 key 的写法以适配各类 agent 框架。
 *
 * @param {object} req - Express 请求对象
 * @param {object} downstream - 匹配到的 downstream 配置（含 api_key）
 * @returns {{ok: boolean, error?: string}} 校验结果
 */
export function authenticateRequest(req, downstream) {
  const authHeader = req.headers['authorization'];

  // 没有 Authorization 请求头，直接拒绝
  if (!authHeader) {
    return { ok: false, error: '缺少 Authorization 请求头' };
  }

  // 尝试解析 "Bearer xxx" 标准格式
  const scheme = authHeader.split(' ')[0];
  const token = authHeader.split(' ')[1];

  if (scheme.toLowerCase() === 'bearer') {
    if (token === downstream.api_key) {
      return { ok: true };
    }
  }

  // 兜底：直接拿整个请求头去匹配（兼容某些 agent 的传参方式）
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (apiKey === downstream.api_key) {
    return { ok: true };
  }

  // 都不匹配则返回鉴权失败
  return { ok: false, error: 'API key 无效' };
}
