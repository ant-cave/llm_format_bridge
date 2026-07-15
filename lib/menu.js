/**
 * LLM Format Bridge — 配置管理 UI 模块
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 把"添加/删除/编辑/列出/测试"这些配置管理操作抽象为统一的函数，
 * CLI 命令和交互菜单都调用同一套代码，避免逻辑双写。
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { t, setLang, detectLang } from './i18n.js';
import { saveConfig, validateConfig } from './config.js';
import { translateRequest, translateResponse } from './translate.js';
import { forwardRequest } from './upstream.js';

const PROVIDERS = ['openai_completions', 'openai_responses', 'anthropic'];

const FALLBACK_MODEL_BY_PROVIDER = {
  openai_completions: 'gpt-4o',
  openai_responses: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514'
};

/**
 * 安全地调用 inquirer.prompt，捕获 Ctrl+C 取消。
 * 返回 null 表示用户取消；调用方应根据返回值决定是否回退到上级菜单。
 */
export async function safePrompt(questions) {
  try {
    return await inquirer.prompt(questions);
  } catch {
    try { process.stdin.setRawMode(false); } catch {}
    try { process.stdin.pause(); } catch {}
    console.log('');
    return null;
  }
}

/**
 * 校验并报告配置错误；如果存在错误会打印并返回 true。
 */
function reportValidationErrors(config) {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.log(chalk.red(errors.join('\n  ')));
    return true;
  }
  return false;
}

/**
 * 列出全部配置（上游 / 下游 / 路由）。
 */
export function listConfig(config) {
  console.log(chalk.bold('\n' + t('config.upstream') + ':'));
  if (config.upstream.length === 0) {
    console.log('  ' + t('config.empty'));
  } else {
    for (const u of config.upstream) {
      console.log(`  ${chalk.green(u.name)} (${u.provider}) → ${u.base_url}`);
    }
  }

  console.log(chalk.bold('\n' + t('config.downstream') + ':'));
  if (config.downstream.length === 0) {
    console.log('  ' + t('config.empty'));
  } else {
    for (const d of config.downstream) {
      console.log(`  ${chalk.green(d.name)} (${d.provider}) :${d.port}`);
    }
  }

  console.log(chalk.bold('\n' + t('config.routes') + ':'));
  if (config.routes.length === 0) {
    console.log('  ' + t('config.empty'));
  } else {
    for (const r of config.routes) {
      console.log(`  ${chalk.green(r.name)}: ${r.downstream} → ${r.upstream}`);
    }
  }
  console.log('');
}

/**
 * 添加 upstream。config 会被原地修改；调用方负责落盘（函数内已落盘）。
 */
export async function addUpstreamInteractive(config) {
  const answers = await safePrompt([
    { type: 'input', name: 'name', message: t('config.add.name'), validate: v => v ? true : t('config.validation.required') },
    { type: 'input', name: 'description', message: t('config.add.description') },
    { type: 'list', name: 'provider', message: t('config.add.provider'), choices: PROVIDERS },
    { type: 'input', name: 'base_url', message: t('config.add.base-url'), validate: v => v ? true : t('config.validation.required') },
    { type: 'password', name: 'api_key', message: t('config.add.api-key'), validate: v => v ? true : t('config.validation.required') }
  ]);
  if (!answers) return false;
  if (config.upstream.some(u => u.name === answers.name)) {
    console.log(chalk.red(t('config.err.duplicate-name', 'upstream', answers.name)));
    return false;
  }
  answers.description = answers.description || undefined;
  config.upstream.push(answers);
  if (reportValidationErrors(config)) {
    config.upstream.pop();
    return false;
  }
  await saveConfig(config);
  console.log(chalk.green(`✓ ${answers.name} ${t('config.add.success')}`));
  return true;
}

/**
 * 添加 downstream。
 */
export async function addDownstreamInteractive(config) {
  const answers = await safePrompt([
    { type: 'input', name: 'name', message: t('config.add.name'), validate: v => v ? true : t('config.validation.required') },
    { type: 'input', name: 'description', message: t('config.add.description') },
    { type: 'list', name: 'provider', message: t('config.add.provider'), choices: PROVIDERS },
    { type: 'number', name: 'port', message: t('config.add.port'), validate: v => v > 0 && v <= 65535 ? true : t('config.validation.port') },
    { type: 'password', name: 'api_key', message: t('config.add.bridge-key'), validate: v => v ? true : t('config.validation.required') },
    { type: 'confirm', name: 'force_disable_thinking', message: t('config.add.force-disable-thinking'), default: false }
  ]);
  if (!answers) return false;
  if (config.downstream.some(d => d.name === answers.name)) {
    console.log(chalk.red(t('config.err.duplicate-name', 'downstream', answers.name)));
    return false;
  }
  answers.description = answers.description || undefined;
  config.downstream.push(answers);
  if (reportValidationErrors(config)) {
    config.downstream.pop();
    return false;
  }
  await saveConfig(config);
  console.log(chalk.green(`✓ ${answers.name} ${t('config.add.success')}`));
  return true;
}

/**
 * 添加 route。
 */
export async function addRouteInteractive(config) {
  if (config.downstream.length === 0) {
    console.log(chalk.red(t('config.add.need-downstream')));
    return false;
  }
  if (config.upstream.length === 0) {
    console.log(chalk.red(t('config.add.need-upstream')));
    return false;
  }

  const answers = await safePrompt([
    { type: 'input', name: 'name', message: t('config.add.route-name'), validate: v => v ? true : t('config.validation.required') },
    {
      type: 'list', name: 'downstream', message: t('config.add.downstream'),
      choices: config.downstream.map(d => ({ name: `${d.name} (${d.provider}:${d.port})`, value: d.name }))
    },
    {
      type: 'list', name: 'upstream', message: t('config.add.upstream'),
      choices: config.upstream.map(u => ({ name: `${u.name} (${u.provider})`, value: u.name }))
    },
    { type: 'confirm', name: 'hasMapping', message: t('config.add.model-mapping'), default: false }
  ]);
  if (!answers) return false;
  if (config.routes.some(r => r.name === answers.name)) {
    console.log(chalk.red(t('config.err.duplicate-name', 'route', answers.name)));
    return false;
  }

  let model_mapping;
  if (answers.hasMapping) {
    const mAnswers = await safePrompt([
      { type: 'input', name: 'mappings', message: t('config.add.model-mapping-hint') }
    ]);
    if (!mAnswers) return false;
    if (mAnswers.mappings) {
      model_mapping = {};
      for (const pair of mAnswers.mappings.split(',')) {
        const [k, v] = pair.split('=').map(s => s.trim());
        if (k && v) model_mapping[k] = v;
      }
    }
  }

  const newRoute = {
    name: answers.name,
    downstream: answers.downstream,
    upstream: answers.upstream,
    ...(model_mapping ? { model_mapping } : {})
  };
  config.routes.push(newRoute);
  if (reportValidationErrors(config)) {
    config.routes.pop();
    return false;
  }
  await saveConfig(config);
  console.log(chalk.green(`✓ ${answers.name} ${t('config.add.success')}`));
  return true;
}

/**
 * 删除指定的配置项。
 */
export async function removeItemInteractive(config, type) {
  const key = type === 'route' ? 'routes' : (type + 's');
  if (!config[key] || config[key].length === 0) {
    console.log(chalk.yellow(t('config.remove.no-items')));
    return false;
  }
  const nameAnswers = await safePrompt([
    { type: 'list', name: 'name', message: t('config.remove.select') + ' ' + type + ':', choices: config[key].map(i => i.name) }
  ]);
  if (!nameAnswers) return false;
  const idx = config[key].findIndex(i => i.name === nameAnswers.name);
  if (idx === -1) {
    console.log(chalk.red(t('config.remove.not-found') + ` ${type} "${nameAnswers.name}"`));
    return false;
  }
  config[key].splice(idx, 1);
  await saveConfig(config);
  console.log(chalk.green(`✓ ${type} "${nameAnswers.name}" ${t('config.remove.success')}`));
  return true;
}

/**
 * 交互式测试一条路由。
 */
export async function testRouteInteractive(config) {
  if (config.routes.length === 0) {
    console.log(chalk.red(t('test.no-routes')));
    return false;
  }
  const rc = await safePrompt([{
    type: 'list', name: 'route', message: t('test.select-route'),
    choices: config.routes.map(r => ({ name: `${r.name} (${r.downstream} → ${r.upstream})`, value: r }))
  }]);
  if (!rc) return false;
  const route = rc.route;
  const downstream = config.downstream.find(d => d.name === route.downstream);
  const upstream = config.upstream.find(u => u.name === route.upstream);
  if (!downstream || !upstream) {
    console.log(chalk.red(t('test.route-invalid')));
    return false;
  }

  const msgA = await safePrompt([
    { type: 'input', name: 'prompt', message: t('test.prompt'), default: t('test.default-prompt') },
    { type: 'confirm', name: 'stream', message: t('test.stream'), default: false }
  ]);
  if (!msgA) return false;

  // 优先用 model_mapping 第一个非 default 键，否则按下游 provider 选一个合理的兜底
  const mappedModel = Object.keys(route.model_mapping || {}).find(k => k !== 'default');
  const model = mappedModel || FALLBACK_MODEL_BY_PROVIDER[downstream.provider] || 'gpt-4o';
  const testBody = {
    model,
    max_tokens: 100,
    stream: msgA.stream
  };
  if (downstream.provider === 'openai_responses') {
    testBody.input = msgA.prompt;
  } else {
    testBody.messages = [{ role: 'user', content: msgA.prompt }];
  }

  console.log(chalk.cyan(`\n${t('test.original')}:`), JSON.stringify(testBody, null, 2));

  let translated;
  try {
    translated = translateRequest(testBody, downstream.provider, upstream.provider, route.model_mapping);
  } catch (e) {
    console.log(chalk.red(`\n${t('test.translate-failed')}: ${e.message}`));
    return false;
  }
  console.log(chalk.cyan(`\n${t('test.translated')}:`), JSON.stringify(translated, null, 2));

  const res = await forwardRequest(upstream, translated);
  if (res.error) {
    console.log(chalk.red(`\n${t('test.upstream-error')} (${res.status}):`), JSON.stringify(res.body, null, 2));
    return false;
  }
  if (res.isStream) {
    const reader = res.stream.getReader();
    const dec = new TextDecoder();
    let txt = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      txt += dec.decode(value, { stream: true });
    }
    console.log(chalk.green(`\n${t('test.upstream-success')}:`), txt.slice(0, 1000));
  } else {
    const translatedRes = translateResponse(res.body, upstream.provider, downstream.provider, testBody.model);
    console.log(chalk.green(`\n${t('test.upstream-success')}:`), JSON.stringify(translatedRes, null, 2));
  }
  console.log('');
  return true;
}

/**
 * 切换界面语言并写入 app_settings.lang。
 */
export async function switchLangInteractive(config) {
  const curLang = detectLang();
  const newLang = curLang === 'zh' ? 'en' : 'zh';
  setLang(newLang);
  config.app_settings = config.app_settings || {};
  config.app_settings.lang = newLang;
  await saveConfig(config);
  console.log(chalk.green(`${t('lang.changed')} ${newLang}`));
}

/**
 * 编辑配置项：type 取值 'upstream' | 'downstream' | 'route' | 'app_settings'。
 */
export async function editItemInteractive(config, type) {
  if (type === 'app_settings') {
    return await editAppSettings(config);
  }
  return await editEntity(config, type);
}

async function editAppSettings(config) {
  const item = config.app_settings || {};
  const fields = Object.keys(item).filter(k => k !== '_path');
  const updates = {};
  for (const f of fields) {
    const curVal = item[f] !== undefined ? String(item[f]) : '';
    const a = await safePrompt([{
      type: 'input',
      name: 'val',
      message: `${t('edit.field')} "${f}" (${t('edit.current')}: ${curVal}):`,
      default: ''
    }]);
    if (!a) return false;
    if (a.val !== '') {
      const num = Number(a.val);
      updates[f] = isNaN(num) || a.val === '' ? a.val : num;
      if (f === 'lang') setLang(a.val);
    }
  }
  if (Object.keys(updates).length > 0) {
    Object.assign(item, updates);
    config.app_settings = item;
    await saveConfig(config);
    console.log(chalk.green(`✓ app_settings ${t('edit.saved')}`));
  }
  return true;
}

async function editEntity(config, type) {
  const key = type === 'route' ? 'routes' : (type + 's');
  if (!config[key] || config[key].length === 0) {
    console.log(chalk.yellow(t('edit.no-items')));
    return false;
  }
  const itemA = await safePrompt([{ type: 'list', name: 'name', message: t('edit.select-item'), choices: config[key].map(i => i.name) }]);
  if (!itemA) return false;
  const item = config[key].find(i => i.name === itemA.name);
  if (!item) return false;

  const fields = Object.keys(item).filter(k => k !== '_path');
  // downstream 始终允许编辑 force_disable_thinking（即使配置中不存在）
  if (type === 'downstream' && !fields.includes('force_disable_thinking')) {
    fields.push('force_disable_thinking');
  }
  const updates = {};
  for (const f of fields) {
    const isBool = typeof item[f] === 'boolean'
      || (type === 'downstream' && f === 'force_disable_thinking');
    const isArray = Array.isArray(item[f]);
    const curVal = item[f] !== undefined ? (isArray ? item[f].join(', ') : String(item[f])) : '';
    const a = await safePrompt([{
      type: f === 'api_key' ? 'password' : isBool ? 'confirm' : 'input',
      name: 'val',
      message: `${t('edit.field')} "${f}" (${t('edit.current')}: ${curVal}):`,
      default: isBool ? (item[f] === true) : ''
    }]);
    if (!a) return false;
    if (isBool) {
      updates[f] = Boolean(a.val);
    } else if (isArray) {
      updates[f] = a.val.split(',').map(s => s.trim()).filter(Boolean);
    } else if (a.val !== '') {
      updates[f] = isNaN(Number(a.val)) ? a.val : Number(a.val);
    }
  }
  if (Object.keys(updates).length > 0) {
    Object.assign(item, updates);
    if (reportValidationErrors(config)) {
      return false;
    }
    await saveConfig(config);
    console.log(chalk.green(`✓ ${type} "${itemA.name}" ${t('edit.saved')}`));
  }
  return true;
}
