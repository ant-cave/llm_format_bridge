#!/usr/bin/env node

import { t, detectLang, setLang } from '../lib/i18n.js';

let pass = 0, fail = 0;
function assert(condition, msg) {
  if (condition) { pass++; }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

// ================================================================
// 1. 翻译函数 t()
// ================================================================

// 先强制设为中文以消除环境变量影响
setLang('zh');

{
  const text = t('app.name');
  assert(text === 'LLM Format Bridge', 'zh app.name 翻译正确');
}

{
  const text = t('menu.start');
  assert(text === '启动 Bridge 服务', 'zh menu.start 翻译正确');
}

// 切换英文
setLang('en');

{
  const text = t('app.name');
  assert(text === 'LLM Format Bridge', 'en app.name 翻译正确');
}

{
  const text = t('menu.start');
  assert(text === 'Start Bridge Server', 'en menu.start 翻译正确');
}

// ================================================================
// 2. %s 占位符替换
// ================================================================

setLang('zh');

{
  const text = t('config.err.duplicate-name', 'upstream', 'my-name');
  assert(text.includes('upstream') && text.includes('my-name'), 'zh %s 占位符替换正确');
}

setLang('en');

{
  const text = t('config.err.duplicate-name', 'route', 'test-route');
  assert(text.includes('route') && text.includes('test-route'), 'en %s 占位符替换正确');
}

// ================================================================
// 3. fallback 行为：不存在的 key 返回 key 本身
// ================================================================

{
  const text = t('nonexistent.key.xyz');
  assert(text === 'nonexistent.key.xyz', '不存在的 key fallback 返回 key 本身');
}

// ================================================================
// 4. setLang / detectLang
// ================================================================

setLang('zh');
assert(detectLang() === 'zh', 'setLang zh 生效');

setLang('en');
assert(detectLang() === 'en', 'setLang en 生效');

// 设置不存在的语言应忽略
setLang('ja');
assert(detectLang() === 'en', 'setLang 不存在的语言应忽略');

// ================================================================
// 结果
// ================================================================

console.log(`\n${pass} passed, ${fail} failed ${fail === 0 ? '✅' : '❌'}\n`);
process.exit(fail > 0 ? 1 : 0);
