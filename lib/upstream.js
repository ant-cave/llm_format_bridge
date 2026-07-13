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
 * @returns {Promise<object>} { error, status, body, isStream, stream? }
 */
export async function forwardRequest(upstreamConfig, body) {
  const baseUrl = normalizeBaseUrl(upstreamConfig.base_url);
  const endpoint = PROVIDER_ENDPOINTS[upstreamConfig.provider];
  const url = `${baseUrl}${endpoint}`;

  const headers = PROVIDER_HEADERS[upstreamConfig.provider](upstreamConfig.api_key);

  const isStream = !!body.stream;

  logger.debug('[UPSTREAM]', 'POST', url, isStream ? '(stream)' : '');

  // 使用 Node.js 原生 fetch（>=18），设置 120s 超时
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
  } catch (err) {
    // 网络不通、DNS 解析失败、超时等均归为此类
    return {
      error: true,
      status: 502,
      body: { error: { message: `上游请求失败: ${err.message}`, type: 'upstream_error' } },
      isStream: false
    };
  }

  const status = response.status;
  const contentType = response.headers.get('content-type') || '';

  // 上游返回了 HTTP 错误（如 401 认证失败、429 限流等）
  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = { error: { message: `HTTP ${status}` } };
    }
    logger.debug('[UPSTREAM_ERR]', status, JSON.stringify(errorBody).slice(0, 300));
    return { error: true, status, body: errorBody, isStream: false };
  }

  logger.debug('[UPSTREAM_OK]', status, contentType);

  // 请求标记了 stream=true 且上游确实返回 SSE，则直接返回流对象
  if (isStream && contentType.includes('text/event-stream')) {
    return {
      error: false,
      status,
      isStream: true,
      stream: response.body  // ReadableStream，由调用方逐块消费
    };
  }

  // 非流式响应，解析 JSON 后返回
  const json = await response.json();
  return { error: false, status, body: json, isStream: false };
}

// 根据 provider 获取对应的请求路径（目前未被外部使用，保留供将来扩展）
export function getUpstreamEndpoint(provider) {
  return PROVIDER_ENDPOINTS[provider];
}
