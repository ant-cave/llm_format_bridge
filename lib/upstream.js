/**
 * LLM Format Bridge — 上游请求转发模块
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 封装对上游云厂商 API 的 HTTP 请求，支持流式和非流式两种模式。
 * 根据 upstream 配置的 provider 自动选择对应的请求端点、
 * 请求头格式（Bearer Token / x-api-key）等。
 */

import { parseSSE } from './translate.js';
import { logger } from './logger.js';

// 各供应商 API 的请求路径映射
const PROVIDER_ENDPOINTS = {
  openai_completions: '/chat/completions',
  openai_responses: '/responses',
  anthropic: '/messages'
};

// 各供应商所需的请求头格式
// OpenAI 系用 Bearer Token，Anthropic 用 x-api-key
const PROVIDER_HEADERS = {
  openai_completions: (apiKey) => ({
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }),
  openai_responses: (apiKey) => ({
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }),
  anthropic: (apiKey) => ({
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',  // Anthropic 要求显式指定 API 版本
    'Content-Type': 'application/json'
  })
};

// 去掉 base_url 末尾多余的斜杠，防止拼接出双斜杠路径
function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * 向 upstream 发送 HTTP 请求。
 * 支持两种模式：
 *   1. 非流式：等待上游返回完整 JSON 后解析
 *   2. 流式 (SSE)：将上游的 ReadableStream 原样返回，由 server.js 逐事件翻译
 *
 * @param {object} upstreamConfig - upstream 配置对象
 * @param {object} body - 已翻译为上游格式的请求体
 * @param {AbortSignal} [externalSignal] - 外部中止信号（客户端断开时触发）
 * @returns {Promise<object>} { error, status, body, isStream, stream? }
 */
export async function forwardRequest(upstreamConfig, body, externalSignal) {
  const baseUrl = normalizeBaseUrl(upstreamConfig.base_url);
  const endpoint = PROVIDER_ENDPOINTS[upstreamConfig.provider];
  const url = `${baseUrl}${endpoint}`;

  const headers = PROVIDER_HEADERS[upstreamConfig.provider](upstreamConfig.api_key);

  const isStream = !!body.stream;

  logger.debug('[UPSTREAM]', 'POST', url, isStream ? '(stream)' : '');

  // 合并外部信号（客户端断开）与超时信号，任一触发即中断上游请求
  const timeoutSignal = AbortSignal.timeout(120000);
  const signal = externalSignal
    ? AbortSignal.any([timeoutSignal, externalSignal])
    : timeoutSignal;

  // 使用 Node.js 原生 fetch（>=18），设置 120s 超时
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });
  } catch (err) {
    // 网络不通、DNS 解析失败、超时等均归为此类
    const aborted = err.name === 'AbortError' && externalSignal?.aborted;
    return {
      error: true,
      status: aborted ? 499 : 502,
      body: { error: { message: aborted ? '客户端已断开' : `上游请求失败: ${err.message}`, type: 'upstream_error' } },
      isStream: false
    };
  }

  const status = response.status;
  const contentType = response.headers.get('content-type') || '';

  // 提取上游的限流 header
  const rateLimitHeaders = {};
  for (const key of ['x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens']) {
    const val = response.headers.get(key);
    if (val !== null) rateLimitHeaders[key] = val;
  }

  // 上游返回了 HTTP 错误（如 401 认证失败、429 限流等）
  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = { error: { message: `HTTP ${status}` } };
    }
    logger.debug('[UPSTREAM_ERR]', status, JSON.stringify(errorBody).slice(0, 300));
    return { error: true, status, body: errorBody, isStream: false, rateLimitHeaders };
  }

  logger.debug('[UPSTREAM_OK]', status, contentType);

  // 请求标记了 stream=true 且上游确实返回 SSE，则直接返回流对象
  if (isStream && contentType.includes('text/event-stream')) {
    return {
      error: false,
      status,
      isStream: true,
      stream: response.body,  // ReadableStream，由调用方逐块消费
      rateLimitHeaders
    };
  }

  // 非流式响应，解析 JSON 后返回
  const json = await response.json();
  return { error: false, status, body: json, isStream: false, rateLimitHeaders };
}

// 根据 provider 获取对应的请求路径（目前未被外部使用，保留供将来扩展）
export function getUpstreamEndpoint(provider) {
  return PROVIDER_ENDPOINTS[provider];
}
