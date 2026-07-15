#!/usr/bin/env node

import { authenticateRequest } from '../lib/auth.js';

let pass = 0, fail = 0;
function assert(condition, msg) {
  if (condition) { pass++; }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

function req(headers) {
  return { headers };
}

// ================================================================
// 1. Bearer Token (OpenAI 风格)
// ================================================================

{
  const result = authenticateRequest(req({ authorization: 'Bearer my-secret-key' }), { api_key: 'my-secret-key' });
  assert(result.ok === true, 'Bearer Token 正确应通过');
}

{
  const result = authenticateRequest(req({ authorization: 'Bearer wrong-key' }), { api_key: 'my-secret-key' });
  assert(result.ok === false, 'Bearer Token 错误应拒绝');
}

{
  const result = authenticateRequest(req({ authorization: 'bearer my-secret-key' }), { api_key: 'my-secret-key' });
  assert(result.ok === true, 'Bearer 大小写不敏感');
}

{
  const result = authenticateRequest(req({ authorization: 'Bearer my-secret-key ' }), { api_key: 'my-secret-key' });
  assert(result.ok === true, 'Bearer Token 尾部空白应不影响');
}

// ================================================================
// 2. x-api-key (Anthropic 风格)
// ================================================================

{
  const result = authenticateRequest(req({ 'x-api-key': 'my-bridge-key' }), { api_key: 'my-bridge-key' });
  assert(result.ok === true, 'x-api-key 正确应通过');
}

{
  const result = authenticateRequest(req({ 'x-api-key': 'wrong' }), { api_key: 'my-bridge-key' });
  assert(result.ok === false, 'x-api-key 错误应拒绝');
}

// ================================================================
// 3. 无请求头
// ================================================================

{
  const result = authenticateRequest(req({}), { api_key: 'my-key' });
  assert(result.ok === false, '无认证请求头应拒绝');
  assert(result.error !== undefined, '应返回错误信息');
}

// ================================================================
// 4. 空 api_key 配置
// ================================================================

{
  const result = authenticateRequest(req({ authorization: 'Bearer ' }), { api_key: 'my-key' });
  assert(result.ok === false, '空 Bearer Token 应拒绝');
}

{
  const result = authenticateRequest(req({ 'x-api-key': '' }), { api_key: 'my-key' });
  assert(result.ok === false, '空 x-api-key 应拒绝');
}

// ================================================================
// 5. 仅 authorization header（无 Bearer 前缀兜底）
// ================================================================

{
  const result = authenticateRequest(req({ authorization: 'my-secret-key' }), { api_key: 'my-secret-key' });
  assert(result.ok === true, '无 Bearer 前缀的 Authorization header 应匹配（兜底逻辑）');
}

// ================================================================
// 6. 同时提供两个请求头
// ================================================================

{
  const result = authenticateRequest(req({
    'authorization': 'Bearer bad-key',
    'x-api-key': 'good-key'
  }), { api_key: 'good-key' });
  assert(result.ok === true, 'x-api-key 正确即使 Bearer 错误也应通过');
}

// ================================================================
// 结果
// ================================================================

console.log(`\n${pass} passed, ${fail} failed ${fail === 0 ? '✅' : '❌'}\n`);
process.exit(fail > 0 ? 1 : 0);
