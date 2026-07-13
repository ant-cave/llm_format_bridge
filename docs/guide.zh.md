# LLM Format Bridge 使用指南

## 概述

LLM Format Bridge 是一个轻量级代理，在不同的 LLM API 格式（OpenAI Chat Completions、OpenAI Responses、Anthropic Messages）之间进行翻译转换。下游应用使用自己习惯的格式，bridge 自动转换为上游云厂商的格式。

```
Agent 应用 (Anthropic 格式) ──→ Bridge (:8080) ──→ OpenAI API
Agent 应用 (OpenAI 格式)    ──→ Bridge (:8081) ──→ Anthropic API
```

## 安装

```bash
# 全局安装（发布后）
npm install -g llm-format-bridge
llm-bridge

# 本地开发
git clone <仓库地址> && cd llm-format-bridge && npm install
./index.js                # 交互式菜单
./index.js start          # 启动服务
npm start                 # 同上
```

## 配置

### config.json

```json
{
  "upstream": [
    {
      "name": "openai",
      "provider": "openai_completions",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-xxxx"
    }
  ],
  "downstream": [
    {
      "name": "my-agent",
      "provider": "anthropic",
      "port": 8080,
      "api_key": "my-bridge-key"
    }
  ],
  "routes": [
    {
      "name": "agent-to-openai",
      "downstream": "my-agent",
      "upstream": "openai",
      "model_mapping": {
        "claude-sonnet-4-20250514": "gpt-4o",
        "default": "gpt-4o-mini"
      }
    }
  ],
  "app_settings": {
    "host": "0.0.0.0",
    "log_level": "info",
    "round_robin": false
  }
}
```

### Upstream 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✓ | 唯一标识 |
| `provider` | ✓ | `openai_completions` / `openai_responses` / `anthropic` |
| `base_url` | ✓ | API 地址，如 `https://api.openai.com/v1` |
| `api_key` | ✓ | API Key |
| `description` | | 描述 |

### Downstream 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✓ | 唯一标识 |
| `provider` | ✓ | 客户端使用的请求格式 |
| `port` | ✓ | 监听端口 (1-65535) |
| `api_key` | ✓ | Bridge 鉴权 Key，客户端请求需携带此 Key |
| `description` | | 描述 |

### Route 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✓ | 唯一标识 |
| `downstream` | ✓ | 引用 downstream 名称 |
| `upstream` | ✓ | 引用 upstream 名称 |
| `model_mapping` | | 模型名映射 `{"客户端模型": "上游模型", "default": "默认模型"}` |

### app_settings

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `host` | `0.0.0.0` | 监听地址 |
| `log_level` | `info` | 日志级别 |
| `round_robin` | `false` | 同 route 下多个 upstream 是否轮询 |

## 使用方式

### CLI

```bash
# 交互式菜单（全局安装后）
llm-bridge
# 或本地开发
./index.js

# 启动服务
llm-bridge start [-c config.json]   # 全局
./index.js start [-c config.json]   # 本地

# 配置管理
llm-bridge config list              # 全局
./index.js config list              # 本地

llm-bridge config add-upstream      # 交互式
llm-bridge config add-downstream
llm-bridge config add-route
llm-bridge config remove upstream <名称>
llm-bridge test
```

### API 端点

Bridge 根据 downstream 的 provider 暴露对应端点：

| Provider | 端点 |
|----------|------|
| `openai_completions` | `POST /v1/chat/completions` |
| `openai_responses` | `POST /v1/responses` |
| `anthropic` | `POST /v1/messages` |
| 通用 | `GET /health` |

### 请求示例（Anthropic → OpenAI）

下游 agent 用 Anthropic 格式发请求，bridge 自动转成 OpenAI 格式：

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Authorization: Bearer my-bridge-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "你好！"}],
    "max_tokens": 100
  }'
```

Bridge 会自动：
1. 将 Anthropic 格式请求转为 OpenAI Chat Completions 格式
2. 映射模型名 `claude-sonnet-4-20250514` → `gpt-4o`
3. 转发到 OpenAI API
4. 将 OpenAI 响应转回 Anthropic 格式返回

## 格式翻译

### 支持方向

| 下游 ↓ → 上游 → | openai_completions | openai_responses | anthropic |
|---|---|---|---|
| **openai_completions** | 透传 | ✓ | ✓ |
| **openai_responses** | ✓ | 透传 | ✓ |
| **anthropic** | ✓ | ✓ | 透传 |

### 翻译要点

- **System 消息**: OpenAI 的 system role 与 Anthropic 顶层 `system` 字段互转
- **多模态图片**: `image_url` (OpenAI) ↔ `image.source.base64` (Anthropic) 自动转换 data URI
- **模型映射**: 一对一映射，支持 `default` 通配
- **流式响应**: SSE 事件格式自动转换（Anthropic event-based ↔ OpenAI delta-based）
- **错误格式**: 上游错误自动转为下游对应格式
- **鉴权**: 每个 downstream 独立 Bearer Token 验证

## 多模态（图片）

Bridge 自动处理图片内容格式转换：

```json
// OpenAI 格式
{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}

// Anthropic 格式
{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}
```

## 开发

```bash
npm run dev    # watch 模式
npm start      # 生产模式
```

### 依赖

- Node.js >= 18（使用原生 fetch）
- 运行时依赖：express、cors、commander、inquirer、chalk
