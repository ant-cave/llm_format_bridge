#!/usr/bin/env node
/**
 * LLM Format Bridge — 多供应商 LLM API 格式中转桥
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 本源码基于 MIT 许可证开源，详见 LICENSE 文件。
 * 如果你在项目中分发或使用了本代码，请考虑提及原作者，
 * 这能极大地鼓舞我为开源社区做更多贡献。
 */

import { program } from 'commander';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { startServer } from './lib/server.js';
import { loadConfig, saveConfig, validateConfig, createDefaultConfig } from './lib/config.js';
import { t, detectLang, setLang } from './lib/i18n.js';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

// config key 映射：菜单类型 → 配置中的数组名
function configKey(type) {
  return type === 'route' ? 'routes' : type;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 加载配置。如果配置文件不存在则自动创建默认配置。
 * 这是 CL I中所有需要配置的操作的统一入口。
 */
async function getConfig(cfgPath) {
  try {
    const config = await loadConfig(cfgPath);
    if (config.app_settings?.lang) {
      setLang(config.app_settings.lang);
    }
    return config;
  } catch (err) {
    // 配置文件不存在时自动创建默认配置
    if (err.message.includes(t('config.load-error'))) {
      console.log(chalk.yellow(t('config.load-error-hint')));
      const cfg = createDefaultConfig();
      cfg._path = cfgPath;
      await saveConfig(cfg);
      console.log(chalk.green(t('config.created') + ': ' + cfgPath));
      return cfg;
    }
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}

/** 显示启动横幅 */
function printBanner() {
  const desc = detectLang() === 'zh'
    ? '多供应商 LLM API 格式中转桥'
    : 'Multi-Provider LLM API Format Bridge';
  console.log(chalk.cyan(`
  ╔══════════════════════════════════════╗
  ║        LLM Format Bridge v${pkg.version.padEnd(6)}    ║
  ║  ${desc.padEnd(36)}  ║
  ╚══════════════════════════════════════╝
  `));
}

// ============================================================
// Commander 命令注册
// 提供 start / config / test 三个顶层命令
// ============================================================

program
  .name('llm-bridge')
  .description(t('cli.program.description'))
  .version(pkg.version);

// 全局 --lang 选项，在 parse 之前手动解析以尽早生效
const langIdx = process.argv.indexOf('--lang');
if (langIdx !== -1 && process.argv[langIdx + 1]) {
  setLang(process.argv[langIdx + 1]);
}
program.option('--lang <zh|en>', t('cli.option.lang'));

// ---- start 命令：启动 Bridge 代理服务 ----
program
  .command('start')
  .description(t('cli.start.description'))
  .option('-c, --config <path>', t('cli.option.config-default'), './config.json')
  .action(async (options) => {
    const config = await getConfig(options.config);
    printBanner();
    await startServer(config);
  });

// ---- config 子命令组：配置管理 ----
const configCmd = program.command('config').description(t('cli.config.description'));

// config list：查看当前配置
configCmd
  .command('list')
  .description(t('cli.config.list'))
  .option('-c, --config <path>', t('cli.option.config-default'), './config.json')
  .action(async (options) => {
    const config = await getConfig(options.config);
    console.log(chalk.bold('\n' + t('config.upstream') + ':'));
    if (config.upstream.length === 0) {
      console.log('  ' + t('config.empty'));
    }
    for (const u of config.upstream) {
      console.log(`  ${chalk.green(u.name)}`);
      console.log(`    ${t('config.description')}: ${u.description || '-'}`);
      console.log(`    ${t('config.provider')}: ${u.provider}`);
      console.log(`    ${t('config.url')}: ${u.base_url}`);
    }

    console.log(chalk.bold('\n' + t('config.downstream') + ':'));
    if (config.downstream.length === 0) {
      console.log('  ' + t('config.empty'));
    }
    for (const d of config.downstream) {
      console.log(`  ${chalk.green(d.name)}`);
      console.log(`    ${t('config.description')}: ${d.description || '-'}`);
      console.log(`    ${t('config.provider')}: ${d.provider}`);
      console.log(`    ${t('config.port')}: ${d.port}`);
    }

    console.log(chalk.bold('\n' + t('config.routes') + ':'));
    if (config.routes.length === 0) {
      console.log('  ' + t('config.empty'));
    }
    for (const r of config.routes) {
      console.log(`  ${chalk.green(r.name)}`);
      console.log(`    downstream: ${r.downstream} → upstream: ${r.upstream}`);
      if (r.model_mapping) {
        console.log(`    ${t('config.model-mapping')}: ${JSON.stringify(r.model_mapping)}`);
      }
    }

    console.log(chalk.bold('\n' + t('config.settings') + ':'));
    console.log(`  ${JSON.stringify(config.app_settings || {}, null, 2)}`);
    console.log('');
  });

configCmd
  .command('add-upstream')
  .description(t('cli.config.add-upstream'))
  .option('-c, --config <path>', t('cli.option.config-default'), './config.json')
  .action(async (options) => {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'input', name: 'name', message: t('config.add.name'), validate: v => v ? true : t('config.validation.required') },
      { type: 'input', name: 'description', message: t('config.add.description') },
      {
        type: 'list', name: 'provider', message: t('config.add.provider'),
        choices: ['openai_completions', 'openai_responses', 'anthropic']
      },
      { type: 'input', name: 'base_url', message: t('config.add.base-url'), validate: v => v ? true : t('config.validation.required') },
      { type: 'password', name: 'api_key', message: t('config.add.api-key'), validate: v => v ? true : t('config.validation.required') }
    ]);
    answers.description = answers.description || undefined;
    const config = await getConfig(options.config);
    config.upstream.push(answers);
    const errors = validateConfig(config);
    if (errors.length > 0) {
      console.log(chalk.red(errors.join('\n  ')));
      return;
    }
    await saveConfig(config);
    console.log(chalk.green(`✓ ${answers.name} ${t('config.add.success')}`));
  });

configCmd
  .command('add-downstream')
  .description(t('cli.config.add-downstream'))
  .option('-c, --config <path>', t('cli.option.config-default'), './config.json')
  .action(async (options) => {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'input', name: 'name', message: t('config.add.name'), validate: v => v ? true : t('config.validation.required') },
      { type: 'input', name: 'description', message: t('config.add.description') },
      {
        type: 'list', name: 'provider', message: t('config.add.provider'),
        choices: ['openai_completions', 'openai_responses', 'anthropic']
      },
      { type: 'number', name: 'port', message: t('config.add.port'), validate: v => v > 0 && v <= 65535 ? true : t('config.validation.port') },
      { type: 'password', name: 'api_key', message: t('config.add.bridge-key'), validate: v => v ? true : t('config.validation.required') }
    ]);
    answers.description = answers.description || undefined;
    const config = await getConfig(options.config);
    config.downstream.push(answers);
    const errors = validateConfig(config);
    if (errors.length > 0) {
      console.log(chalk.red(errors.join('\n  ')));
      return;
    }
    await saveConfig(config);
    console.log(chalk.green(`✓ ${answers.name} ${t('config.add.success')}`));
  });

configCmd
  .command('add-route')
  .description(t('cli.config.add-route'))
  .option('-c, --config <path>', t('cli.option.config-default'), './config.json')
  .action(async (options) => {
    const { default: inquirer } = await import('inquirer');
    const config = await getConfig(options.config);

    if (config.downstream.length === 0) {
      console.log(chalk.red(t('config.add.need-downstream')));
      return;
    }
    if (config.upstream.length === 0) {
      console.log(chalk.red(t('config.add.need-upstream')));
      return;
    }

    const answers = await inquirer.prompt([
      { type: 'input', name: 'name', message: t('config.add.route-name'), validate: v => v ? true : t('config.validation.required') },
      {
        type: 'list', name: 'downstream', message: t('config.add.downstream'),
        choices: config.downstream.map(d => ({ name: `${d.name} (${d.provider}:${d.port})`, value: d.name }))
      },
      {
        type: 'list', name: 'upstream', message: t('config.add.upstream'),
        choices: config.upstream.map(u => ({ name: `${u.name} (${u.provider})`, value: u.name }))
      },
      {
        type: 'confirm', name: 'hasMapping', message: t('config.add.model-mapping'), default: false
      }
    ]);

    let model_mapping;
    if (answers.hasMapping) {
      const mappingAnswers = await inquirer.prompt([
        {
          type: 'input', name: 'mappings', message: t('config.add.model-mapping-hint')
        }
      ]);
      if (mappingAnswers.mappings) {
        model_mapping = {};
        for (const pair of mappingAnswers.mappings.split(',')) {
          const [k, v] = pair.split('=').map(s => s.trim());
          if (k && v) model_mapping[k] = v;
        }
      }
    }

    config.routes.push({
      name: answers.name,
      downstream: answers.downstream,
      upstream: answers.upstream,
      ...(model_mapping ? { model_mapping } : {})
    });

    const errors = validateConfig(config);
    if (errors.length > 0) {
      console.log(chalk.red(errors.join('\n  ')));
      return;
    }

    await saveConfig(config);
    console.log(chalk.green(`✓ ${answers.name} ${t('config.add.success')}`));
  });

configCmd
  .command('remove <type> <name>')
  .description(t('cli.config.remove'))
  .option('-c, --config <path>', t('cli.option.config-default'), './config.json')
  .action(async (type, name, options) => {
    const config = await getConfig(options.config);
    const validTypes = ['upstream', 'downstream', 'route'];
    if (!validTypes.includes(type)) {
      console.log(chalk.red(t('config.remove.invalid-type') + validTypes.join(', ')));
      return;
    }
    const key = type === 'route' ? 'routes' : (type + 's');
    const idx = config[key].findIndex(i => i.name === name);
    if (idx === -1) {
      console.log(chalk.red(t('config.remove.not-found') + ` ${type} "${name}"`));
      return;
    }
    config[key].splice(idx, 1);
    await saveConfig(config);
    console.log(chalk.green(`✓ ${type} "${name}" ${t('config.remove.success')}`));
  });

// ---- test 命令 ----

program
  .command('test')
  .description(t('cli.test.description'))
  .option('-c, --config <path>', t('cli.option.config-default'), './config.json')
  .action(async (options) => {
    const { default: inquirer } = await import('inquirer');
    const config = await getConfig(options.config);

    if (config.routes.length === 0) {
      console.log(chalk.red(t('test.no-routes')));
      return;
    }

    const routeChoice = await inquirer.prompt([{
      type: 'list', name: 'route', message: t('test.select-route'),
      choices: config.routes.map(r => ({
        name: `${r.name} (${r.downstream} → ${r.upstream})`,
        value: r
      }))
    }]);

    const route = routeChoice.route;
    const downstream = config.downstream.find(d => d.name === route.downstream);
    const upstream = config.upstream.find(u => u.name === route.upstream);

    if (!downstream || !upstream) {
      console.log(chalk.red(t('test.route-invalid')));
      return;
    }

    const msgAnswers = await inquirer.prompt([
      {
        type: 'input', name: 'prompt', message: t('test.prompt'), default: t('test.default-prompt')
      },
      {
        type: 'confirm', name: 'stream', message: t('test.stream'), default: false
      }
    ]);

    const testBody = {
      model: Object.keys(route.model_mapping || {}).find(k => k !== 'default') || 'gpt-4o',
      messages: [{ role: 'user', content: msgAnswers.prompt }],
      max_tokens: 100,
      stream: msgAnswers.stream
    };

    const { translateRequest } = await import('./lib/translate.js');
    const { forwardRequest } = await import('./lib/upstream.js');

    console.log(chalk.cyan(`\n${t('test.original')}:`));
    console.log(JSON.stringify(testBody, null, 2));

    let translated;
    try {
      translated = translateRequest(testBody, downstream.provider, upstream.provider, route.model_mapping);
    } catch (err) {
      console.log(chalk.red(`\n${t('test.translate-failed')}: ${err.message}`));
      return;
    }

    console.log(chalk.cyan(`\n${t('test.translated')}:`));
    console.log(JSON.stringify(translated, null, 2));

    const result = await forwardRequest(upstream, translated);

    if (result.error) {
      console.log(chalk.red(`\n${t('test.upstream-error')} (${result.status}):`));
      console.log(JSON.stringify(result.body, null, 2));
      return;
    }

    if (result.isStream) {
      console.log(chalk.green(`\n${t('test.upstream-success')} (Stream):`));
      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      console.log(text.slice(0, 1000) + (text.length > 1000 ? '...' : ''));
    } else {
      console.log(chalk.green(`\n${t('test.upstream-success')} (${result.status}):`));
      const { translateResponse } = await import('./lib/translate.js');
      const translatedRes = translateResponse(result.body, upstream.provider, downstream.provider, testBody.model);
      console.log(JSON.stringify(translatedRes, null, 2));
    }

    console.log('');
  });

// ============================================================
// 交互式菜单
// 无命令行参数时进入此模式，通过 inquirer 提供友好的交互界面。
// 功能覆盖：启动服务、配置增删改查、路由测试。
// ============================================================

async function interactiveMenu() {
  const { default: inquirer } = await import('inquirer');

  // 启动时从 config 恢复语言设置
  try {
    if (existsSync('./config.json')) {
      const raw = readFileSync('./config.json', 'utf-8');
      const cfg = JSON.parse(raw);
      if (cfg.app_settings?.lang) {
        setLang(cfg.app_settings.lang);
      }
    }
  } catch {}

  // 安全提示：捕获 Ctrl+C，返回 null 表示用户取消，回到主菜单
  async function safePrompt(questions) {
    try {
      return await inquirer.prompt(questions);
    } catch {
      try { process.stdin.setRawMode(false); } catch {}
      try { process.stdin.pause(); } catch {}
      console.log('');
      return null;
    }
  }

  printBanner();

  while (true) {
    const menuResult = await safePrompt([{
      type: 'list',
      name: 'action',
      message: t('menu.title'),
      pageSize: 10,
      choices: [
        { name: t('menu.start'), value: 'start' },
        { name: t('menu.add-upstream'), value: 'add-upstream' },
        { name: t('menu.add-downstream'), value: 'add-downstream' },
        { name: t('menu.add-route'), value: 'add-route' },
        { name: t('menu.edit'), value: 'edit' },
        { name: t('menu.remove'), value: 'remove' },
        { name: t('menu.list'), value: 'list' },
        { name: t('menu.test'), value: 'test' },
        { name: t('menu.switch-lang'), value: 'switch-lang' },
        { name: t('menu.exit'), value: 'exit' }
      ]
    }]);
    if (!menuResult) {
      console.log(t('menu.goodbye'));
      process.exit(0);
    }
    const { action } = menuResult;

    if (action === 'exit') {
      console.log(t('menu.goodbye'));
      process.exit(0);
    }

    const opts = { config: './config.json' };

    switch (action) {
      case 'start': {
        const config = await getConfig(opts.config);
        await startServer(config);
        return;
      }
      case 'list': {
        const config = await getConfig(opts.config);
        console.log(chalk.bold('\n' + t('config.upstream') + ':'));
        if (config.upstream.length === 0) console.log('  ' + t('config.empty'));
        for (const u of config.upstream) {
          console.log(`  ${chalk.green(u.name)} (${u.provider}) → ${u.base_url}`);
        }
        console.log(chalk.bold('\n' + t('config.downstream') + ':'));
        if (config.downstream.length === 0) console.log('  ' + t('config.empty'));
        for (const d of config.downstream) {
          console.log(`  ${chalk.green(d.name)} (${d.provider}) :${d.port}`);
        }
        console.log(chalk.bold('\n' + t('config.routes') + ':'));
        if (config.routes.length === 0) console.log('  ' + t('config.empty'));
        for (const r of config.routes) {
          console.log(`  ${chalk.green(r.name)}: ${r.downstream} → ${r.upstream}`);
        }
        console.log('');
        break;
      }
      case 'add-upstream': {
        try {
          const config1 = await getConfig(opts.config);
          const uAnswers = await safePrompt([
            { type: 'input', name: 'name', message: t('config.add.name'), validate: v => v ? true : t('config.validation.required') },
            { type: 'input', name: 'description', message: t('config.add.description') },
            { type: 'list', name: 'provider', message: t('config.add.provider'), choices: ['openai_completions', 'openai_responses', 'anthropic'] },
            { type: 'input', name: 'base_url', message: t('config.add.base-url'), validate: v => v ? true : t('config.validation.required') },
            { type: 'password', name: 'api_key', message: t('config.add.api-key'), validate: v => v ? true : t('config.validation.required') }
          ]);
          if (!uAnswers) break;
          uAnswers.description = uAnswers.description || undefined;
          config1.upstream.push(uAnswers);
          await saveConfig(config1);
          console.log(chalk.green(`✓ ${uAnswers.name} ${t('config.add.success')}`));
        } catch {}
        break;
      }
      case 'add-downstream': {
        try {
          const config2 = await getConfig(opts.config);
          const dAnswers = await safePrompt([
            { type: 'input', name: 'name', message: t('config.add.name'), validate: v => v ? true : t('config.validation.required') },
            { type: 'input', name: 'description', message: t('config.add.description') },
            { type: 'list', name: 'provider', message: t('config.add.provider'), choices: ['openai_completions', 'openai_responses', 'anthropic'] },
            { type: 'number', name: 'port', message: t('config.add.port'), validate: v => v > 0 && v <= 65535 ? true : t('config.validation.port') },
            { type: 'password', name: 'api_key', message: t('config.add.bridge-key'), validate: v => v ? true : t('config.validation.required') }
          ]);
          if (!dAnswers) break;
          dAnswers.description = dAnswers.description || undefined;
          config2.downstream.push(dAnswers);
          await saveConfig(config2);
          console.log(chalk.green(`✓ ${dAnswers.name} ${t('config.add.success')}`));
        } catch {}
        break;
      }
      case 'remove': {
        try {
          const configR = await getConfig(opts.config);
          const rType = await safePrompt([{ type: 'list', name: 'type', message: t('config.remove.type'), choices: ['upstream', 'downstream', 'route'] }]);
          if (!rType) break;
          let items;
          items = configR[configKey(rType.type)].map(i => i.name);
          if (items.length === 0) { console.log(chalk.yellow(t('config.remove.no-items'))); break; }
          const rName = await safePrompt([{ type: 'list', name: 'name', message: t('config.remove.select') + ' ' + rType.type + ':', choices: items }]);
          if (!rName) break;
          const key = configKey(rType.type);
          const idx = configR[key].findIndex(i => i.name === rName.name);
          if (idx !== -1) { configR[key].splice(idx, 1); await saveConfig(configR); console.log(chalk.green(`✓ ${rType.type} "${rName.name}" ${t('config.remove.success')}`)); }
        } catch {}
        break;
      }
      case 'add-route': {
        try {
          const config3 = await getConfig(opts.config);
          if (config3.downstream.length === 0) { console.log(chalk.red(t('config.add.need-downstream'))); break; }
          if (config3.upstream.length === 0) { console.log(chalk.red(t('config.add.need-upstream'))); break; }
          const rAnswers = await safePrompt([
          { type: 'input', name: 'name', message: t('config.add.route-name'), validate: v => v ? true : t('config.validation.required') },
          { type: 'list', name: 'downstream', message: t('config.add.downstream'), choices: config3.downstream.map(d => ({ name: `${d.name} (${d.provider}:${d.port})`, value: d.name })) },
          { type: 'list', name: 'upstream', message: t('config.add.upstream'), choices: config3.upstream.map(u => ({ name: `${u.name} (${u.provider})`, value: u.name })) },
          { type: 'confirm', name: 'hasMapping', message: t('config.add.model-mapping'), default: false }
        ]);
        let model_mapping;
        if (rAnswers.hasMapping) {
          const mAnswers = await safePrompt([{ type: 'input', name: 'mappings', message: t('config.add.model-mapping-hint') }]);
          if (!mAnswers) break;
          if (mAnswers.mappings) {
            model_mapping = {};
            for (const pair of mAnswers.mappings.split(',')) {
              const [k, v] = pair.split('=').map(s => s.trim());
              if (k && v) model_mapping[k] = v;
            }
          }
        }
        config3.routes.push({ name: rAnswers.name, downstream: rAnswers.downstream, upstream: rAnswers.upstream, ...(model_mapping ? { model_mapping } : {}) });
        await saveConfig(config3);
        console.log(chalk.green(`✓ ${rAnswers.name} ${t('config.add.success')}`));
        } catch {}
        break;
      }
      case 'test': {
        try {
        const config4 = await getConfig(opts.config);
        if (config4.routes.length === 0) { console.log(chalk.red(t('test.no-routes'))); break; }
        const rc = await safePrompt([{ type: 'list', name: 'route', message: t('test.select-route'), choices: config4.routes.map(r => ({ name: `${r.name} (${r.downstream} → ${r.upstream})`, value: r })) }]);
        if (!rc) break;
        const route4 = rc.route;
        const downstream4 = config4.downstream.find(d => d.name === route4.downstream);
        const upstream4 = config4.upstream.find(u => u.name === route4.upstream);
        if (!downstream4 || !upstream4) { console.log(chalk.red(t('test.route-invalid'))); break; }
        const msgA = await safePrompt([
          { type: 'input', name: 'prompt', message: t('test.prompt'), default: t('test.default-prompt') },
          { type: 'confirm', name: 'stream', message: t('test.stream'), default: false }
        ]);
        if (!msgA) break;
        const testBody4 = { model: Object.keys(route4.model_mapping || {}).find(k => k !== 'default') || 'gpt-4o', messages: [{ role: 'user', content: msgA.prompt }], max_tokens: 100, stream: msgA.stream };
        const { translateRequest: tr4, translateResponse: trs4 } = await import('./lib/translate.js');
        const { forwardRequest: fr4 } = await import('./lib/upstream.js');
        console.log(chalk.cyan(`\n${t('test.original')}:`), JSON.stringify(testBody4, null, 2));
        try {
          const trans4 = tr4(testBody4, downstream4.provider, upstream4.provider, route4.model_mapping);
          console.log(chalk.cyan(`\n${t('test.translated')}:`), JSON.stringify(trans4, null, 2));
          const res4 = await fr4(upstream4, trans4);
          if (res4.error) { console.log(chalk.red(`\n${t('test.upstream-error')} (${res4.status}):`), JSON.stringify(res4.body, null, 2)); break; }
          if (res4.isStream) {
            const reader = res4.stream.getReader();
            const dec = new TextDecoder();
            let txt = ''; while (true) { const { done, value } = await reader.read(); if (done) break; txt += dec.decode(value, { stream: true }); }
            console.log(chalk.green(`\n${t('test.upstream-success')}:`), txt.slice(0, 1000));
          } else {
            console.log(chalk.green(`\n${t('test.upstream-success')}:`), JSON.stringify(trs4(res4.body, upstream4.provider, downstream4.provider, testBody4.model), null, 2));
          }
        } catch (e) { console.log(chalk.red(`\n${t('test.failed')}: ${e.message}`)); }
        console.log('');
        } catch {}
        break;
      }
      case 'switch-lang': {
        const curLang = detectLang();
        const newLang = curLang === 'zh' ? 'en' : 'zh';
        setLang(newLang);
        try {
          const cfgL = await getConfig('./config.json');
          if (!cfgL.app_settings) cfgL.app_settings = {};
          cfgL.app_settings.lang = newLang;
          await saveConfig(cfgL);
        } catch {}
        console.log(chalk.green(`${t('lang.changed')} ${newLang}`));
        break;
      }
      case 'edit': {
        try {
          const cfgE = await getConfig('./config.json');
          const typeA = await safePrompt([{ type: 'list', name: 'type', message: t('edit.select-type'), choices: ['upstream', 'downstream', 'route', 'app_settings'] }]);
          if (!typeA) break;
          if (typeA.type === 'app_settings') {
            const item = cfgE.app_settings || {};
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
              if (!a) break;
              if (a.val !== '') {
                const num = Number(a.val);
                updates[f] = isNaN(num) || a.val === '' ? a.val : num;
                if (f === 'lang') setLang(a.val);
              }
            }
            if (Object.keys(updates).length > 0) {
              Object.assign(item, updates);
              cfgE.app_settings = item;
              await saveConfig(cfgE);
              console.log(chalk.green(`✓ app_settings ${t('edit.saved')}`));
            }
            break;
          }
          const keyE = configKey(typeA.type);
          if (cfgE[keyE].length === 0) { console.log(chalk.yellow(t('edit.no-items'))); break; }
          const itemA = await safePrompt([{ type: 'list', name: 'name', message: t('edit.select-item'), choices: cfgE[keyE].map(i => i.name) }]);
          if (!itemA) break;
          const item = cfgE[keyE].find(i => i.name === itemA.name);
          if (!item) break;
          const fields = Object.keys(item).filter(k => k !== '_path');
          const updates = {};
          for (const f of fields) {
            const curVal = item[f] !== undefined ? String(item[f]) : '';
            const a = await safePrompt([{
              type: f === 'api_key' ? 'password' : 'input',
              name: 'val',
              message: `${t('edit.field')} "${f}" (${t('edit.current')}: ${curVal}):`,
              default: ''
            }]);
            if (!a) break;
            if (a.val !== '') {
              updates[f] = isNaN(Number(a.val)) ? a.val : Number(a.val);
            }
          }
          if (Object.keys(updates).length > 0) {
            Object.assign(item, updates);
            await saveConfig(cfgE);
            console.log(chalk.green(`✓ ${typeA.type} "${itemA.name}" ${t('edit.saved')}`));
          }
        } catch {}
        break;
      }
    }
  }
}

// ============================================================
// 程序入口
// 判断逻辑：无参数 → 交互式菜单；有参数 → 命令行模式
// ============================================================

if (process.argv.length <= 2) {
  interactiveMenu();
} else {
  program.parse();
}
