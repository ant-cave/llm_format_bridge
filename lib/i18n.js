/**
 * LLM Format Bridge — 国际化模块 (i18n)
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 根据 LANG 环境变量自动切换中/英文界面。
 * 所有用户可见的字符串都通过 t() 函数获取，
 * 扩展新语言只需在 locales 对象中增加对应键值表。
 */

const locales = {
  zh: {
    'app.name': 'LLM Format Bridge',
    'app.description': '多供应商 LLM API 格式中转桥',
    'app.version': '版本',

    'cli.program.description': '多供应商 LLM API 格式中转桥 - 让下游应用用自己习惯的格式，自动转换为上游云厂商的格式',
    'cli.start.description': '启动 Bridge 服务',
    'cli.config.description': '配置管理',
    'cli.config.list': '查看当前配置',
    'cli.config.add-upstream': '添加 Upstream',
    'cli.config.add-downstream': '添加 Downstream',
    'cli.config.add-route': '添加路由',
    'cli.config.remove': '删除配置项 (upstream/downstream/route)',
    'cli.test.description': '测试路由连接',

    'start.no-downstream': '没有配置 downstream，无法启动服务',
    'start.listening': '服务已启动',
    'start.host': '监听地址',
    'start.log-level': '日志级别',
    'start.round-robin': '轮询模式',
    'start.on': '开',
    'start.off': '关',
    'start.stop-hint': '按 Ctrl+C 停止服务',
    'start.starting': '启动中...',
    'start.failed': '启动服务失败',
    'start.route-to': '→',
    'start.port': '端口',

    'config.load-error': '配置文件不存在',
    'config.load-error-hint': '使用默认配置...',
    'config.created': '已创建默认配置文件',
    'config.parse-error': '配置文件 JSON 解析失败',
    'config.validate-error': '配置校验失败',

    'config.upstream': 'Upstreams',
    'config.downstream': 'Downstreams',
    'config.routes': 'Routes',
    'config.settings': '应用设置',
    'config.empty': '(空)',
    'config.description': '描述',
    'config.provider': '供应商',
    'config.url': '地址',
    'config.port': '端口',
    'config.model-mapping': '模型映射',

    'config.add.name': '名称:',
    'config.add.description': '描述(可选):',
    'config.add.provider': '供应商类型:',
    'config.add.base-url': 'Base URL:',
    'config.add.api-key': 'API Key:',
    'config.add.port': '监听端口:',
    'config.add.bridge-key': 'Bridge API Key(下游请求时使用):',
    'config.add.route-name': '路由名称:',
    'config.add.downstream': '选择 Downstream:',
    'config.add.upstream': '选择 Upstream:',
    'config.add.model-mapping': '配置模型映射?',
    'config.add.model-mapping-hint': '模型映射 (格式: gpt-4o=claude-3,default=qwen, 逗号分隔):',
    'config.add.success': '已添加',
    'config.add.need-downstream': '请先添加 downstream',
    'config.add.need-upstream': '请先添加 upstream',
    'config.remove.type': '删除类型:',
    'config.remove.select': '选择要删除的',
    'config.remove.no-items': '没有可删除的项目',
    'config.remove.success': '已删除',
    'config.remove.not-found': '未找到',
    'config.remove.invalid-type': '类型无效，有效值: ',
    'config.validation.required': '必填',
    'config.validation.port': '1-65535',

    'menu.title': '请选择操作:',
    'menu.start': '启动 Bridge 服务',
    'menu.add-upstream': '添加上游 (Upstream)',
    'menu.add-downstream': '添加下游 (Downstream)',
    'menu.add-route': '添加路由 (Route)',
    'menu.remove': '删除配置项',
    'menu.list': '查看配置',
    'menu.test': '测试路由',
    'menu.exit': '退出',
    'menu.goodbye': '再见!',

    'test.select-route': '选择要测试的路由:',
    'test.prompt': '测试消息:',
    'test.stream': '启用 Stream?',
    'test.default-prompt': 'Say "hello" in one word',
    'test.original': '原始请求',
    'test.translated': '翻译后请求(发往上游)',
    'test.upstream-error': '上游返回错误',
    'test.upstream-success': '上游响应',
    'test.failed': '测试失败',
    'test.no-routes': '没有配置路由',
    'test.route-invalid': '路由引用的 downstream 或 upstream 不存在',
    'test.translate-failed': '请求翻译失败',

    'server.body-empty': '请求体为空',
    'server.no-downstream': '未关联任何 downstream',
    'server.wrong-path': '格式的请求应使用',
    'server.no-route': '未配置路由',
    'server.no-upstream': '未找到可用的 upstream',
    'server.inner-error': '内部错误',
    'server.translate-request-failed': '翻译请求失败',
    'server.translate-response-failed': '翻译响应失败',
    'server.health-ok': '正常',
    'server.stream-error': 'Stream 读取错误',
    'server.request-error': '请求处理错误',

    'auth.missing-header': '缺少 Authorization 请求头',
    'auth.invalid-key': 'API key 无效',

    'upstream.fetch-failed': '上游请求失败',
    'upstream.error': '上游请求失败',
    'upstream.timeout': '上游请求超时',

    'translate.unsupported': '不支持的翻译方向',

    'cli.option.config': '配置文件路径',
    'cli.option.config-default': '配置文件路径，默认 ./config.json',
    'no-stream-translator': '当前翻译方向不支持流式，将使用非流式模式',

    'config.err.missing-array': '缺少 %s 数组',
    'config.err.duplicate-name': '%s 名称重复: %s',
    'config.err.duplicate-port': '端口重复: %s',
    'config.err.missing-field': '%s "%s" 缺少必填字段: %s',
    'config.err.invalid-provider': '%s "%s" 的 provider 无效，有效值: %s',
    'config.err.invalid-base-url': '%s 的 base_url 格式无效',
    'config.err.invalid-port': '%s 的 port 无效 (1-65535)',
    'config.err.not-found': '%s "%s" 引用了不存在的 %s "%s"',
  },

  en: {
    'app.name': 'LLM Format Bridge',
    'app.description': 'Multi-Provider LLM API Format Bridge',
    'app.version': 'Version',

    'cli.program.description': 'Multi-provider LLM API format bridge - let downstream apps use their preferred format, auto-translate to upstream provider format',
    'cli.start.description': 'Start the Bridge server',
    'cli.config.description': 'Configuration management',
    'cli.config.list': 'View current configuration',
    'cli.config.add-upstream': 'Add Upstream',
    'cli.config.add-downstream': 'Add Downstream',
    'cli.config.add-route': 'Add Route',
    'cli.config.remove': 'Remove config item (upstream/downstream/route)',
    'cli.test.description': 'Test a route connection',

    'start.no-downstream': 'No downstream configured, cannot start',
    'start.listening': 'Bridge server started',
    'start.host': 'Host',
    'start.log-level': 'Log level',
    'start.round-robin': 'Round robin',
    'start.on': 'On',
    'start.off': 'Off',
    'start.stop-hint': 'Press Ctrl+C to stop',
    'start.starting': 'Starting...',
    'start.failed': 'Failed to start server',
    'start.route-to': '→',
    'start.port': 'port',

    'config.load-error': 'Configuration file not found',
    'config.load-error-hint': 'Using default config...',
    'config.created': 'Default config file created',
    'config.parse-error': 'Failed to parse config JSON',
    'config.validate-error': 'Configuration validation failed',

    'config.upstream': 'Upstreams',
    'config.downstream': 'Downstreams',
    'config.routes': 'Routes',
    'config.settings': 'App Settings',
    'config.empty': '(empty)',
    'config.description': 'Description',
    'config.provider': 'Provider',
    'config.url': 'URL',
    'config.port': 'Port',
    'config.model-mapping': 'Model Mapping',

    'config.add.name': 'Name:',
    'config.add.description': 'Description (optional):',
    'config.add.provider': 'Provider:',
    'config.add.base-url': 'Base URL:',
    'config.add.api-key': 'API Key:',
    'config.add.port': 'Listening port:',
    'config.add.bridge-key': 'Bridge API Key (for downstream auth):',
    'config.add.route-name': 'Route name:',
    'config.add.downstream': 'Select Downstream:',
    'config.add.upstream': 'Select Upstream:',
    'config.add.model-mapping': 'Configure model mapping?',
    'config.add.model-mapping-hint': 'Model mapping (format: gpt-4o=claude-3,default=qwen, comma separated):',
    'config.add.success': 'added',
    'config.add.need-downstream': 'Please add a downstream first',
    'config.add.need-upstream': 'Please add an upstream first',
    'config.remove.type': 'Remove type:',
    'config.remove.select': 'Select to remove',
    'config.remove.no-items': 'No items to remove',
    'config.remove.success': 'removed',
    'config.remove.not-found': 'not found',
    'config.remove.invalid-type': 'Invalid type, valid values: ',
    'config.validation.required': 'Required',
    'config.validation.port': '1-65535',

    'menu.title': 'Select an action:',
    'menu.start': 'Start Bridge Server',
    'menu.add-upstream': 'Add Upstream',
    'menu.add-downstream': 'Add Downstream',
    'menu.add-route': 'Add Route',
    'menu.remove': 'Remove Config Item',
    'menu.list': 'View Config',
    'menu.test': 'Test Route',
    'menu.exit': 'Exit',
    'menu.goodbye': 'Goodbye!',

    'test.select-route': 'Select route to test:',
    'test.prompt': 'Test message:',
    'test.stream': 'Enable Stream?',
    'test.default-prompt': 'Say "hello" in one word',
    'test.original': 'Original Request',
    'test.translated': 'Translated Request (to upstream)',
    'test.upstream-error': 'Upstream Error',
    'test.upstream-success': 'Upstream Response',
    'test.failed': 'Test Failed',
    'test.no-routes': 'No routes configured',
    'test.route-invalid': 'Route references non-existent downstream or upstream',
    'test.translate-failed': 'Request translation failed',

    'server.body-empty': 'Request body is empty',
    'server.no-downstream': 'No downstream associated with this port',
    'server.wrong-path': 'requests should use',
    'server.no-route': 'No route configured for this downstream',
    'server.no-upstream': 'No available upstream for this route',
    'server.inner-error': 'Internal error',
    'server.translate-request-failed': 'Request translation failed',
    'server.translate-response-failed': 'Response translation failed',
    'server.health-ok': 'ok',
    'server.stream-error': 'Stream read error',
    'server.request-error': 'Request handler error',

    'auth.missing-header': 'Missing Authorization header',
    'auth.invalid-key': 'Invalid API key',

    'upstream.fetch-failed': 'Upstream request failed',
    'upstream.error': 'Upstream request error',
    'upstream.timeout': 'Upstream request timed out',

    'translate.unsupported': 'Unsupported translation direction',

    'cli.option.config': 'Config file path',
    'cli.option.config-default': 'Config file path, default ./config.json',
    'no-stream-translator': 'Streaming not supported for this direction, using non-streaming mode',

    'config.err.missing-array': 'Missing %s array',
    'config.err.duplicate-name': 'Duplicate %s name: %s',
    'config.err.duplicate-port': 'Duplicate port: %s',
    'config.err.missing-field': '%s "%s" missing required field: %s',
    'config.err.invalid-provider': '%s "%s" invalid provider, valid values: %s',
    'config.err.invalid-base-url': '%s has invalid base_url format',
    'config.err.invalid-port': '%s has invalid port (1-65535)',
    'config.err.not-found': '%s "%s" references non-existent %s "%s"',
  }
};

// 当前语言缓存，避免每次调用 detectLang 都解析环境变量
let _lang = null;

/**
 * 检测系统语言。优先读 LANG 环境变量，以 "zh" 开头则用中文，否则用英文。
 * 结果会被缓存到 _lang 中，后续调用直接返回缓存值。
 */
export function detectLang() {
  if (_lang) return _lang;
  const env = process.env.LANG || '';
  if (env.startsWith('zh')) {
    _lang = 'zh';
  } else {
    _lang = 'en';
  }
  return _lang;
}

/**
 * 强制指定语言（覆盖环境变量检测）。
 * 仅支持 locales 中已注册的语言代码，不支持的会静默忽略。
 */
export function setLang(lang) {
  if (locales[lang]) {
    _lang = lang;
  }
}

/**
 * 翻译函数：根据当前语言查找 key 对应的文本。
 * 支持 %s 占位符替换，按参数顺序依次填充。
 * 如果当前语言找不到 key，fallback 到英文；
 * 英文也找不到则直接返回 key 本身（便于调试）。
 *
 * @param {string} key - 翻译键
 * @param {...any} args - 待替换的占位参数
 * @returns {string} 翻译后的文本
 */
export function t(key, ...args) {
  const lang = detectLang();
  let text = locales[lang]?.[key] || locales.en?.[key] || key;
  if (args.length > 0) {
    let i = 0;
    text = text.replace(/%s/g, () => args[i++] ?? '');
  }
  return text;
}
