/**
 * LLM Format Bridge — HTTP 服务模块
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 基于 Express 的多端口 HTTP 服务。
 * 每个 downstream 配置一个独立端口，Express 在多个端口上同时监听。
 * 请求进入后按端口匹配 downstream → 按 route 找到 upstream →
 * 格式翻译 → 转发 → 响应翻译 → 返回给客户端。
 */

import express from 'express';
import cors from 'cors';
import { authenticateRequest } from './auth.js';
import { translateRequest, translateResponse, translateAndFormatError, getStreamTranslator, parseSSE, stripThinkingParams, forceDisableThinking } from './translate.js';
import { forwardRequest } from './upstream.js';
import { createRequire } from 'module';
import { t, setLang } from './i18n.js';
import { logger, setLogLevel } from './logger.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json');

// 轮询计数器：key 是 route 名称，value 是当前轮到的上游索引
let _roundRobinCounters = {};

// 当前活跃的 HTTP server 引用，供 graceful shutdown 使用
const _activeServers = [];

// 模型→上游映射缓存
let _modelUpstreamMap = null;
let _modelsRawData = null;
let _modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60000;

async function refreshModelCache(config) {
  const isOpenAI = u => ['openai_completions', 'openai_responses'].includes(u.provider);
  const results = await Promise.allSettled(
    config.upstream.filter(isOpenAI).map(async (u) => {
      const base = u.base_url.replace(/\/+$/, '').replace(/\/v1$/, '');
      const res = await fetch(base + '/v1/models', {
        headers: { 'Authorization': `Bearer ${u.api_key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      const data = await res.json();
      return { upstreamName: u.name, models: data.data || [] };
    })
  );

  const modelMap = {};
  const seen = new Set();
  const rawData = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') { logger.warn('获取 /v1/models 失败:', result.reason?.message); continue; }
    for (const m of result.value.models) {
      if (!modelMap[m.id]) modelMap[m.id] = result.value.upstreamName;
      if (!seen.has(m.id)) { seen.add(m.id); rawData.push(m); }
    }
  }

  _modelUpstreamMap = modelMap;
  _modelsRawData = rawData;
  _modelsCacheTime = Date.now();
}

function mapModelName(originalModel, modelMapping) {
  if (!modelMapping) return originalModel;
  if (modelMapping[originalModel]) return modelMapping[originalModel];
  if (modelMapping['default']) return modelMapping['default'];
  return originalModel;
}

function formatResetTime(resetVal) {
  // OpenAI: "6m0s", "1h0m0s", "15.424s"; Anthropic: ISO 8601 "2024-01-15T12:00:00Z"
  if (!resetVal) return '';
  if (/^\d/.test(resetVal) && (resetVal.includes('h') || resetVal.includes('m') || resetVal.includes('s'))) {
    return resetVal;
  }
  const t = new Date(resetVal).getTime();
  if (isNaN(t)) return resetVal;
  const diff = Math.max(0, Math.round((t - Date.now()) / 1000));
  if (diff < 1) return '0s';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const parts = [];
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  if (s || parts.length === 0) parts.push(s + 's');
  return parts.join('');
}

function setRateLimitHeaders(res, rateLimitHeaders) {
  if (!rateLimitHeaders) return;
  for (const [key, val] of Object.entries(rateLimitHeaders)) {
    res.setHeader(key, val);
  }
  const remaining = rateLimitHeaders['x-ratelimit-remaining-requests'];
  const resetReq = rateLimitHeaders['x-ratelimit-reset-requests'];
  const remainingTokens = rateLimitHeaders['x-ratelimit-remaining-tokens'];
  const resetTokens = rateLimitHeaders['x-ratelimit-reset-tokens'];
  const parts = [];
  if (remaining !== undefined) {
    parts.push(`requests: ${remaining} remaining, reset in ${formatResetTime(resetReq)}`);
  }
  if (remainingTokens !== undefined) {
    parts.push(`tokens: ${remainingTokens} remaining, reset in ${formatResetTime(resetTokens)}`);
  }
  if (parts.length > 0) {
    res.setHeader('X-RateLimit-Info', parts.join('; '));
  }
}

/**
 * 清理已删除路由的计数器，防止长时间运行后内存缓慢增长。
 * 在每次请求时调用，但仅在路由集合发生变化时才执行扫描（按需懒清理）。
 */
function gcRoundRobinCounters(config) {
  const validNames = new Set(config.routes.map(r => r.name));
  for (const k of Object.keys(_roundRobinCounters)) {
    if (!validNames.has(k)) delete _roundRobinCounters[k];
  }
}

/**
 * 从 route 配置中选取一个 upstream。
 * 当 route 配置了多个 upstream 且开启了 round_robin 时，
 * 按顺序轮询；否则始终返回第一个 upstream。
 */
function getNextUpstream(route, config) {
  const upstreams = Array.isArray(route.upstream) ? route.upstream : [route.upstream];
  if (upstreams.length === 0) return null;

  const rr = config.app_settings?.round_robin;
  if (rr && upstreams.length > 1) {
    if (!_roundRobinCounters[route.name]) {
      _roundRobinCounters[route.name] = 0;
    }
    const idx = _roundRobinCounters[route.name] % upstreams.length;
    _roundRobinCounters[route.name]++;
    return config.upstream.find(u => u.name === upstreams[idx]) || null;
  }

  return config.upstream.find(u => u.name === upstreams[0]) || null;
}

// 根据 downstream 名称查找路由
function findRoute(downstreamName, config) {
  return config.routes.find(r => r.downstream === downstreamName);
}

// 根据端口查找下游配置
function findDownstreamByPort(port, config) {
  return config.downstream.find(d => d.port === Number(port));
}

// 根据 provider 类型返回其对应的 API 请求路径
function getRequestPath(provider) {
  switch (provider) {
    case 'openai_completions': return '/v1/chat/completions';
    case 'openai_responses': return '/v1/responses';
    case 'anthropic': return '/v1/messages';
    default: return null;
  }
}

/**
 * /v1/models 处理器：遍历所有 upstream，聚合所有模型返回给下游。
 * 结果缓存 60 秒，同时为后续请求建立模型→上游映射用于直接路由。
 */
async function handleModels(req, res) {
  const _config = req.app.locals.config;
  if (!_modelUpstreamMap || Date.now() - _modelsCacheTime >= MODELS_CACHE_TTL) {
    await refreshModelCache(_config);
  }
  return res.json({ object: 'list', data: _modelsRawData || [] });
}

export async function startServer(config) {
  if (config.app_settings?.lang) {
    setLang(config.app_settings.lang);
  }
  if (config.app_settings?.log_level) {
    setLogLevel(config.app_settings.log_level);
  }
  if (config.downstream.length === 0) {
    console.log(t('start.no-downstream'));
    return;
  }

  const app = express();
  app.locals.config = config;

  app.use(cors());
  // body parser 放到中间件后面、按需延迟解析，避免在路径/鉴权拒绝前吃掉大 body
  app.use((req, res, next) => {
    if (req.path === '/health' || req.path === '/v1/models') return next();
    express.json({ limit: '50mb' })(req, res, (err) => {
      if (err) return next(err);
      express.urlencoded({ extended: true, limit: '50mb' })(req, res, next);
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: _pkg.version });
  });

  // 核心中间件：为每个请求完成下游匹配 → 路径校验 → 鉴权 → 路由分发
  app.use((req, res, next) => {
    // 0. 清理已删除路由的轮询计数器（按需懒回收）
    gcRoundRobinCounters(config);

    // 1. 根据端口识别下游
    const port = req.socket.localPort;
    const downstream = findDownstreamByPort(port, config);
    if (!downstream) {
      return res.status(404).json({
        error: { message: `端口 ${port} 未关联任何 downstream` }
      });
    }
    req.downstream = downstream;
    logger.debug('[REQ]', req.method, req.path, '→', downstream.name);

    // 特殊放行：/v1/models（模型列表查询，不需要路由）
    if (req.path === '/v1/models') {
      req.isModelsRequest = true;
      // 鉴权
      const authResult = authenticateRequest(req, downstream);
      if (!authResult.ok) {
        return res.status(401).json({
          error: { message: authResult.error }
        });
      }
      return next();
    }

    // 2. 路径校验：下游配置了 anthropic provider，就必须走 /v1/messages，不能走 /v1/chat/completions
    const expectedPath = getRequestPath(downstream.provider);
    if (req.path !== expectedPath && req.path !== '/health') {
      return res.status(400).json({
        error: { message: `${downstream.provider} 格式的请求应使用 ${expectedPath}` }
      });
    }

    // 3. 鉴权：校验 Bearer Token 是否匹配下游的 api_key
    const authResult = authenticateRequest(req, downstream);
    if (!authResult.ok) {
      return res.status(401).json({
        error: { message: authResult.error }
      });
    }

    // 4. 路由匹配：从 routes 中找到 downstream 对应的 route
    const route = findRoute(downstream.name, config);
    if (!route) {
      return res.status(404).json({
        error: { message: `downstream "${downstream.name}" 未配置路由` }
      });
    }
    req.route = route;

    // 5. 选取上游（支持轮询）
    req.upstreamConfig = getNextUpstream(route, config);
    if (!req.upstreamConfig) {
      return res.status(502).json({
        error: { message: `路由 "${route.name}" 未找到可用的 upstream` }
      });
    }

    next();
  });

  app.post('/v1/chat/completions', handleRequest);
  app.post('/v1/responses', handleRequest);
  app.post('/v1/messages', handleRequest);

  // /v1/models 模型列表查询：转发到上游
  app.get('/v1/models', handleModels);
  // OpenAI SDK 有时发 HEAD 请求探测端点
  app.head('/v1/models', (req, res) => res.status(200).end());

  const ports = [...new Set(config.downstream.map(d => d.port))];

  const servers = ports.map(port => {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, config.app_settings?.host || '0.0.0.0', () => {
        const downstream = findDownstreamByPort(port, config);
        console.log(`  ✓ ${downstream?.name || 'unknown'} (${downstream?.provider || '?'}) ${t('start.route-to')} ${t('start.port')} ${port}`);
        _activeServers.push(server);
        resolve(server);
      });
      server.on('error', (err) => {
        reject(err);
      });
    });
  });

  // 注册 graceful shutdown：SIGINT/SIGTERM 触发时关闭所有 server
  if (_activeServers.length === 0) {
    process.once('SIGINT', gracefulShutdown);
    process.once('SIGTERM', gracefulShutdown);
  }

  try {
    await Promise.all(servers);
    console.log(`\n${t('app.name')} ${t('start.listening')} (${t('start.host')}: ${config.app_settings?.host || '0.0.0.0'})`);
    console.log(`${t('start.log-level')}: ${config.app_settings?.log_level || 'info'}`);
    console.log(`${t('start.round-robin')}: ${config.app_settings?.round_robin ? t('start.on') : t('start.off')}`);
    console.log('');
    console.log(t('start.stop-hint'));
  } catch (err) {
    console.error(`${t('start.failed')}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * 优雅关闭：收到 SIGINT/SIGTERM 后停止接收新连接，
 * 等待正在进行的请求完成（或超时强制退出）。
 */
function gracefulShutdown() {
  console.log('\n[SHUTDOWN] 收到停止信号，正在关闭服务...');
  let pending = _activeServers.length;
  if (pending === 0) process.exit(0);
  const forceExit = setTimeout(() => {
    console.warn('[SHUTDOWN] 关闭超时，强制退出');
    process.exit(1);
  }, 10000);
  forceExit.unref();
  for (const server of _activeServers) {
    server.close(() => {
      if (--pending === 0) {
        clearTimeout(forceExit);
        console.log('[SHUTDOWN] 已关闭');
        process.exit(0);
      }
    });
  }
}

/**
 * 请求处理顶层入口（带错误兜底）。
 * 所有请求处理路径上的未捕获异常都会落在此处，
 * 确保即使服务端出错也不会让客户端挂死。
 */
async function handleRequest(req, res) {
  // 客户端断连时主动 abort 上游 fetch，避免长流式 / 长思考白跑
  const clientAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) clientAbort.abort();
  });

  try {
    await handleRequestInner(req, res, clientAbort.signal);
  } catch (err) {
    if (clientAbort.signal.aborted) return; // 客户端主动断开，无需回包
    console.error(t('server.request-error') + ':', err.message);
    // 如果尚未发送响应头（即还未开始流式输出），可以安全返回 JSON 错误
    if (!res.headersSent) {
      res.status(500).json({ error: { message: `内部错误: ${err.message}` } });
    } else {
      // 已在流式输出中出错，直接断连
      res.end();
    }
  }
}

/**
 * 请求处理核心逻辑：
 *   1. 根据模型名从缓存找到对应的 upstream，直接路由（多个上游同模型则取首个）
 *   2. 将下游请求体翻译为上游格式
 *   3. 转发到上游
 *   4. 处理响应（流式/非流式）
 *   5. 将上游响应翻译回下游格式
 */
async function handleRequestInner(req, res, clientAbortSignal) {
  const downstream = req.downstream;
  const route = req.route;
  const _config = req.app.locals.config;
  const fromProvider = downstream.provider;
  const body = req.body;

  if (!body) {
    return res.status(400).json({ error: { message: '请求体为空' } });
  }

  logger.debug('[IN]', downstream.name, JSON.stringify(body).slice(0, 500));

  if (downstream.force_disable_thinking) {
    stripThinkingParams(body, fromProvider);
  }

  // 根据模型名直接定位到对应 upstream
  if (!_modelUpstreamMap || Date.now() - _modelsCacheTime >= MODELS_CACHE_TTL) {
    await refreshModelCache(_config);
  }

  const mappedModel = mapModelName(body.model, route.model_mapping);
  const targetUpstreamName = _modelUpstreamMap ? _modelUpstreamMap[mappedModel] : null;
  const upstreamConfig = targetUpstreamName
    ? _config.upstream.find(u => u.name === targetUpstreamName)
    : req.upstreamConfig;

  if (!upstreamConfig) {
    return res.status(502).json({ error: { message: `模型 "${mappedModel}" 无可用 upstream` } });
  }

  const toProvider = upstreamConfig.provider;

  let translatedBody;
  try {
    translatedBody = translateRequest(body, fromProvider, toProvider, route.model_mapping);
  } catch (err) {
    logger.warn('翻译请求失败:', err.message);
    return res.status(400).json({ error: { message: `翻译请求失败: ${err.message}` } });
  }

  if (downstream.force_disable_thinking) {
    forceDisableThinking(translatedBody, toProvider);
  }

  logger.debug('[TRANS]', fromProvider, '→', toProvider, JSON.stringify(translatedBody).slice(0, 500));

  const result = await forwardRequest(upstreamConfig, translatedBody, clientAbortSignal);

  if (result.error) {
    logger.warn('[UPSTREAM_ERR]', upstreamConfig.name, result.status, JSON.stringify(result.body).slice(0, 300));
    setRateLimitHeaders(res, result.rateLimitHeaders);
    const errBody = translateAndFormatError(result.body, result.status, toProvider, fromProvider);
    return res.status(result.status).json(errBody);
  }

  logger.debug('[UPSTREAM_OK]', upstreamConfig.name, result.status, result.isStream ? '(stream)' : '');

  // ---- 流式响应处理 ----
  if (result.isStream) {
    setRateLimitHeaders(res, result.rateLimitHeaders);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const streamTranslator = getStreamTranslator(toProvider, fromProvider);

    if (streamTranslator && streamTranslator.available) {
      logger.debug('[STREAM] 使用流式翻译器:', toProvider, '→', fromProvider);
      const state = {};
      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const parsed = parseSSE(trimmed);
            if (!parsed) continue;

            if (parsed.type === 'done') {
              const endMarker = streamTranslator.endOfStream;
              if (endMarker) res.write(streamTranslator.format(endMarker));
              continue;
            }

            if (parsed.type === 'data') {
              const output = streamTranslator.translate(parsed.data, state);
              if (output) {
                if (Array.isArray(output)) {
                  for (const chunk of output) res.write(streamTranslator.format(chunk));
                } else {
                  res.write(streamTranslator.format(output));
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(t('server.stream-error') + ':', err.message);
      }
    } else {
      logger.debug('[STREAM] 同格式透传，逐块转发');
      res.flushHeaders();
      const reader = result.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch (err) {
        console.error(t('server.stream-error') + ':', err.message);
      }
    }

    res.end();
    return;
  }

  // ---- 非流式响应处理 ----
  setRateLimitHeaders(res, result.rateLimitHeaders);
  let translatedRes;
  try {
    translatedRes = translateResponse(result.body, toProvider, fromProvider, body.model);
  } catch (err) {
    logger.warn('翻译响应失败:', err.message);
    return res.status(500).json({ error: { message: `翻译响应失败: ${err.message}` } });
  }

  logger.debug('[OUT]', JSON.stringify(translatedRes).slice(0, 500));
  res.json(translatedRes);
}
