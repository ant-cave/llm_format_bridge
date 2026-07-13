/**
 * LLM Format Bridge — 日志模块
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 支持级别: debug / info / warn / error
 * 通过 config.app_settings.log_level 控制，
 * 交互菜单启动时默认 info，--log-level 或 config 可覆盖。
 */

let _level = 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export function setLogLevel(level) {
  if (LEVELS[level] !== undefined) _level = level;
}

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[_level];
}

function prefix(level) {
  const ts = new Date().toISOString().slice(11, 23);
  const tag = level.toUpperCase().padEnd(5);
  return `[${ts}] [${tag}]`;
}

export const logger = {
  debug: (...args) => shouldLog('debug') && console.log(prefix('debug'), ...args),
  info: (...args) => shouldLog('info') && console.log(prefix('info'), ...args),
  warn: (...args) => shouldLog('warn') && console.warn(prefix('warn'), ...args),
  error: (...args) => shouldLog('error') && console.error(prefix('error'), ...args),
};
