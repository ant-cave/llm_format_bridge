/**
 * LLM Format Bridge — 配置模块
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 负责 config.json 的加载、校验、增删改查。
 * 每个 upstream / downstream / route 都经过严格校验，
 * 确保端口不重复、引用的上下游存在、必填字段完整。
 */

import { readFile, writeFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { t } from './i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, '..', 'config.json');
const EXAMPLE_CONFIG_PATH = join(__dirname, '..', 'config.example.json');

// 当前支持的供应商类型列表，新增供应商需同步修改 translate.js 和此数组
const VALID_PROVIDERS = ['openai_completions', 'openai_responses', 'anthropic'];

/**
 * 配置字段校验规则。
 * required：必填字段列表，缺少任一字段报错
 * optional：可选字段
 * validate：自定义校验函数，返回 null 表示通过，返回字符串表示错误信息
 */
const CONFIG_SCHEMA = {
  upstream: {
    required: ['name', 'provider', 'base_url', 'api_key'],
    optional: ['description'],
    validate: (u) => {
      // 检查 provider 是否在支持列表中
      if (!VALID_PROVIDERS.includes(u.provider)) {
        return t('config.err.invalid-provider', 'upstream', u.name, VALID_PROVIDERS.join(', '));
      }
      // base_url 必须以 http:// 或 https:// 开头
      if (!u.base_url.startsWith('http://') && !u.base_url.startsWith('https://')) {
        return t('config.err.invalid-base-url', u.name);
      }
      return null;
    }
  },
  downstream: {
    required: ['name', 'provider', 'port', 'api_key'],
    optional: ['description'],
    validate: (d) => {
      if (!VALID_PROVIDERS.includes(d.provider)) {
        return t('config.err.invalid-provider', 'downstream', d.name, VALID_PROVIDERS.join(', '));
      }
      // 端口必须在有效范围内
      if (d.port < 1 || d.port > 65535) {
        return t('config.err.invalid-port', d.name);
      }
      return null;
    }
  },
  routes: {
    required: ['name', 'downstream', 'upstream'],
    optional: ['model_mapping'],
    validate: (r, config) => {
      // 确认 route 中引用的 downstream 和 upstream 确实存在
      if (config.downstream && !config.downstream.find(d => d.name === r.downstream)) {
        return t('config.err.not-found', 'route', r.name, 'downstream', r.downstream);
      }
      if (config.upstream && !config.upstream.find(u => u.name === r.upstream)) {
        return t('config.err.not-found', 'route', r.name, 'upstream', r.upstream);
      }
      return null;
    }
  }
};

/**
 * 从磁盘加载并校验配置文件。
 * 若文件不存在或 JSON 格式错误会直接抛出异常。
 * 成功时会在返回的 config 对象上附加 _path 属性，供 saveConfig 回写用。
 *
 * @param {string} [path] - 配置文件路径，缺省则用默认路径
 * @returns {Promise<object>} 解析和校验后的配置对象
 */
export async function loadConfig(path) {
  const configPath = path || DEFAULT_CONFIG_PATH;
  try {
    await access(configPath);
  } catch {
    // config.json 不存在时，尝试从 config.example.json 自动创建
    try {
      await access(EXAMPLE_CONFIG_PATH);
      const exampleRaw = await readFile(EXAMPLE_CONFIG_PATH, 'utf-8');
      await writeFile(configPath, exampleRaw, 'utf-8');
      console.log(t('config.created') + ': ' + configPath + ' (from config.example.json)');
    } catch {
      throw new Error(t('config.load-error') + ': ' + configPath);
    }
  }

  const raw = await readFile(configPath, 'utf-8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(t('config.parse-error') + ': ' + e.message);
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(t('config.validate-error') + ':\n  ' + errors.join('\n  '));
  }

  config._path = configPath;
  return config;
}

/**
 * 全面校验配置对象的合法性。
 * 检查内容：
 *   1. upstream / downstream / routes 三个数组是否存在
 *   2. 每个数组元素是否有重复名称
 *   3. 每个元素是否填写了所有必填字段
 *   4. 端口是否重复
 *   5. route 引用的 downstream 和 upstream 是否存在
 *
 * @param {object} config - 待校验的配置对象
 * @returns {string[]} 错误信息数组，长度为 0 表示校验通过
 */
export function validateConfig(config) {
  const errors = [];

  if (!config.upstream || !Array.isArray(config.upstream)) {
    errors.push(t('config.err.missing-array', 'upstream'));
  }
  if (!config.downstream || !Array.isArray(config.downstream)) {
    errors.push(t('config.err.missing-array', 'downstream'));
  }
  if (!config.routes || !Array.isArray(config.routes)) {
    errors.push(t('config.err.missing-array', 'routes'));
  }

  // 校验 upstream 数组：名称唯一 + 必填字段 + 自定义规则
  if (config.upstream && Array.isArray(config.upstream)) {
    const names = new Set();
    for (const u of config.upstream) {
      if (names.has(u.name)) errors.push(t('config.err.duplicate-name', 'upstream', u.name));
      names.add(u.name);
      for (const key of CONFIG_SCHEMA.upstream.required) {
        if (u[key] === undefined || u[key] === null || u[key] === '') {
          errors.push(t('config.err.missing-field', 'upstream', u.name, key));
        }
      }
      const err = CONFIG_SCHEMA.upstream.validate(u);
      if (err) errors.push(err);
    }
  }

  // 校验 downstream 数组：名称唯一 + 端口唯一 + 必填字段 + 自定义规则
  if (config.downstream && Array.isArray(config.downstream)) {
    const names = new Set();
    const ports = new Set();
    for (const d of config.downstream) {
      if (names.has(d.name)) errors.push(t('config.err.duplicate-name', 'downstream', d.name));
      names.add(d.name);
      if (ports.has(d.port)) errors.push(t('config.err.duplicate-port', d.port));
      ports.add(d.port);
      for (const key of CONFIG_SCHEMA.downstream.required) {
        if (d[key] === undefined || d[key] === null || d[key] === '') {
          errors.push(t('config.err.missing-field', 'downstream', d.name, key));
        }
      }
      const err = CONFIG_SCHEMA.downstream.validate(d);
      if (err) errors.push(err);
    }
  }

  // 校验 routes 数组：名称唯一 + 必填字段 + 引用的 downstream/upstream 是否存在
  if (config.routes && Array.isArray(config.routes)) {
    const names = new Set();
    for (const r of config.routes) {
      if (names.has(r.name)) errors.push(t('config.err.duplicate-name', 'route', r.name));
      names.add(r.name);
      for (const key of CONFIG_SCHEMA.routes.required) {
        if (r[key] === undefined || r[key] === null || r[key] === '') {
          errors.push(t('config.err.missing-field', 'route', r.name, key));
        }
      }
      const err = CONFIG_SCHEMA.routes.validate(r, config);
      if (err) errors.push(err);
    }
  }

  return errors;
}

/**
 * 将配置对象写回磁盘（JSON 格式化，2 空格缩进）。
 * 保存前会自动移除内部使用的 _path 属性。
 */
export async function saveConfig(config) {
  const path = config._path || DEFAULT_CONFIG_PATH;
  const clone = { ...config };
  delete clone._path;
  await writeFile(path, JSON.stringify(clone, null, 2) + '\n', 'utf-8');
}

/**
 * 生成一个空的默认配置，供首次使用时创建。
 */
export function createDefaultConfig() {
  return {
    upstream: [],
    downstream: [],
    routes: [],
    app_settings: {
      host: '0.0.0.0',
      log_level: 'info',
      round_robin: false,
      lang: ''
    }
  };
}
