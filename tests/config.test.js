#!/usr/bin/env node

import { validateConfig, createDefaultConfig } from '../lib/config.js';
import { readFile, writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp_test_config.json');

let pass = 0, fail = 0;
function assert(condition, msg) {
  if (condition) { pass++; }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

function t(errors) { return errors; }

// ================================================================
// 1. validateConfig — 基本结构检查
// ================================================================

{
  const errs = validateConfig({});
  assert(errs.length >= 3, '空对象应报缺失数组错误');
  assert(errs.some(e => e.includes('upstream')), '应提示 upstream 缺失');
  assert(errs.some(e => e.includes('downstream')), '应提示 downstream 缺失');
  assert(errs.some(e => e.includes('routes')), '应提示 routes 缺失');
}

{
  const errs = validateConfig({ upstream: 'not-array', downstream: [], routes: [] });
  assert(errs.some(e => e.includes('upstream')), 'upstream 非数组应报错');
}

// ================================================================
// 2. validateConfig — upstream 校验
// ================================================================

{
  const errs = validateConfig({
    upstream: [{ name: 'u1', provider: 'openai_completions', base_url: 'https://api.openai.com/v1', api_key: 'sk-xxx' }],
    downstream: [],
    routes: []
  });
  assert(errs.length === 0, '合法的 upstream 应无错误');
}

{
  const errs = validateConfig({
    upstream: [{ name: '', provider: 'openai_completions', base_url: 'https://api.openai.com/v1', api_key: 'sk-xxx' }],
    downstream: [],
    routes: []
  });
  assert(errs.some(e => e.includes('name')), '空 name 应报错');
}

{
  const errs = validateConfig({
    upstream: [{ name: 'u1', provider: 'invalid_provider', base_url: 'https://api.openai.com/v1', api_key: 'sk-xxx' }],
    downstream: [],
    routes: []
  });
  assert(errs.some(e => e.includes('provider')), '非法 provider 应报错');
}

{
  const errs = validateConfig({
    upstream: [{ name: 'u1', provider: 'openai_completions', base_url: 'ftp://bad.com', api_key: 'sk-xxx' }],
    downstream: [],
    routes: []
  });
  assert(errs.some(e => e.includes('base_url')), '非 http/https base_url 应报错');
}

{
  const errs = validateConfig({
    upstream: [
      { name: 'dup', provider: 'openai_completions', base_url: 'https://a.com', api_key: 'k' },
      { name: 'dup', provider: 'openai_responses', base_url: 'https://b.com', api_key: 'k' }
    ],
    downstream: [],
    routes: []
  });
  assert(errs.some(e => e.includes('重复') || e.includes('Duplicate')), '重复 name 应报错');
}

// ================================================================
// 3. validateConfig — downstream 校验
// ================================================================

{
  const errs = validateConfig({
    upstream: [],
    downstream: [{ name: 'd1', provider: 'anthropic', port: 8080, api_key: 'bridge-key', description: 'test' }],
    routes: []
  });
  assert(errs.length === 0, '合法的 downstream 应无错误');
}

{
  const errs = validateConfig({
    upstream: [],
    downstream: [{ name: 'd1', provider: 'anthropic', port: 0, api_key: 'k' }],
    routes: []
  });
  assert(errs.some(e => e.includes('port')), '端口 0 应报错');
}

{
  const errs = validateConfig({
    upstream: [],
    downstream: [{ name: 'd1', provider: 'anthropic', port: 99999, api_key: 'k' }],
    routes: []
  });
  assert(errs.some(e => e.includes('port')), '端口 99999 应报错');
}

{
  const errs = validateConfig({
    upstream: [],
    downstream: [
      { name: 'd1', provider: 'anthropic', port: 8080, api_key: 'k' },
      { name: 'd2', provider: 'openai_completions', port: 8080, api_key: 'k' }
    ],
    routes: []
  });
  assert(errs.some(e => e.includes('端口') || e.includes('port')), '重复端口应报错');
}

// ================================================================
// 4. validateConfig — routes 校验
// ================================================================

{
  const errs = validateConfig({
    upstream: [{ name: 'u1', provider: 'openai_completions', base_url: 'https://a.com', api_key: 'k' }],
    downstream: [{ name: 'd1', provider: 'anthropic', port: 8080, api_key: 'k' }],
    routes: [{ name: 'r1', downstream: 'd1', upstream: 'u1' }]
  });
  assert(errs.length === 0, '合法的 route 应无错误');
}

{
  const errs = validateConfig({
    upstream: [{ name: 'u1', provider: 'openai_completions', base_url: 'https://a.com', api_key: 'k' }],
    downstream: [{ name: 'd1', provider: 'anthropic', port: 8080, api_key: 'k' }],
    routes: [{ name: 'r1', downstream: 'nonexistent', upstream: 'u1' }]
  });
  assert(errs.some(e => e.includes('downstream') || e.includes('不存在') || e.includes('non-existent')), '引用不存在的 downstream 应报错');
}

{
  const errs = validateConfig({
    upstream: [{ name: 'u1', provider: 'openai_completions', base_url: 'https://a.com', api_key: 'k' }],
    downstream: [{ name: 'd1', provider: 'anthropic', port: 8080, api_key: 'k' }],
    routes: [{ name: 'r1', downstream: 'd1', upstream: 'nonexistent' }]
  });
  assert(errs.some(e => e.includes('upstream') || e.includes('不存在') || e.includes('non-existent')), '引用不存在的 upstream 应报错');
}

{
  const errs = validateConfig({
    upstream: [{ name: 'u1', provider: 'openai_completions', base_url: 'https://a.com', api_key: 'k' }],
    downstream: [{ name: 'd1', provider: 'anthropic', port: 8080, api_key: 'k' }],
    routes: [
      { name: 'dup', downstream: 'd1', upstream: 'u1' },
      { name: 'dup', downstream: 'd1', upstream: 'u1' }
    ]
  });
  assert(errs.some(e => e.includes('重复') || e.includes('Duplicate')), 'route 重复 name 应报错');
}

// ================================================================
// 5. createDefaultConfig
// ================================================================

{
  const cfg = createDefaultConfig();
  assert(Array.isArray(cfg.upstream) && cfg.upstream.length === 0, 'upstream 应为空数组');
  assert(Array.isArray(cfg.downstream) && cfg.downstream.length === 0, 'downstream 应为空数组');
  assert(Array.isArray(cfg.routes) && cfg.routes.length === 0, 'routes 应为空数组');
  assert(cfg.app_settings.host === '0.0.0.0', '默认 host 应为 0.0.0.0');
  assert(cfg.app_settings.log_level === 'info', '默认 log_level 应为 info');
  assert(cfg.app_settings.round_robin === false, '默认 round_robin 应为 false');
  assert(cfg.app_settings.lang === '', '默认 lang 应为空');
}

// ================================================================
// 结果
// ================================================================

console.log(`\n${pass} passed, ${fail} failed ${fail === 0 ? '✅' : '❌'}\n`);
process.exit(fail > 0 ? 1 : 0);
