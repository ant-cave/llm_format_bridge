# LLM Format Bridge Guide

## Overview

LLM Format Bridge is a lightweight proxy that translates between different LLM API formats (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages). Downstream applications use their preferred format, the bridge automatically converts to the upstream provider's format.

```
Agent App (Anthropic) ──→ Bridge (:8080) ──→ OpenAI API
Agent App (OpenAI)    ──→ Bridge (:8081) ──→ Anthropic API
```

## Installation

```bash
git clone <repo> && cd llm-format-bridge && npm install
./index.js                # interactive menu
./index.js start          # start server
npm start                 # same as above
```

## Configuration

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

### Upstream Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `provider` | Yes | `openai_completions` / `openai_responses` / `anthropic` |
| `base_url` | Yes | API base URL, e.g. `https://api.openai.com/v1` |
| `api_key` | Yes | API key |
| `description` | No | Optional description |

### Downstream Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `provider` | Yes | Request format expected from clients |
| `port` | Yes | Listening port (1-65535) |
| `api_key` | Yes | Bridge auth key, clients must send this |
| `description` | No | Optional description |

### Route Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `downstream` | Yes | Reference to a downstream name |
| `upstream` | Yes | Reference to an upstream name |
| `model_mapping` | No | Model name mapping `{"client_model": "upstream_model", "default": "fallback"}` |

### app_settings

| Field | Default | Description |
|-------|---------|-------------|
| `host` | `0.0.0.0` | Listen address |
| `log_level` | `info` | Log level |
| `round_robin` | `false` | Round-robin across multiple upstreams in a route |

## Usage

### CLI

```bash
./index.js                  # interactive menu
./index.js start [-c cfg]   # start server
./index.js config list      # view config
./index.js config add-upstream      # interactive
./index.js config add-downstream
./index.js config add-route
./index.js config remove upstream <name>
./index.js test
```

### API Endpoints

The bridge exposes endpoints based on the downstream's provider:

| Provider | Endpoint |
|----------|----------|
| `openai_completions` | `POST /v1/chat/completions` |
| `openai_responses` | `POST /v1/responses` |
| `anthropic` | `POST /v1/messages` |
| All | `GET /health` |

### Example Request (Anthropic → OpenAI)

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Authorization: Bearer my-bridge-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

The bridge:
1. Converts Anthropic format to OpenAI Chat format
2. Maps model `claude-sonnet-4-20250514` → `gpt-4o`
3. Forwards to OpenAI API
4. Converts response back to Anthropic format

## Format Translation

### Supported Directions

| Downstream ↓ → Upstream → | openai_completions | openai_responses | anthropic |
|---|---|---|---|
| **openai_completions** | passthrough | ✓ | ✓ |
| **openai_responses** | ✓ | passthrough | ✓ |
| **anthropic** | ✓ | ✓ | passthrough |

### Key Translation Features

- **System messages**: OpenAI system role ↔ Anthropic `system` top-level field
- **Multimodal**: `image_url` (OpenAI) ↔ `image.source.base64` (Anthropic) with auto data URI conversion
- **Model mapping**: One-to-one mapping with `default` fallback
- **Streaming**: SSE event format conversion (Anthropic event-based ↔ OpenAI delta-based)
- **Error format**: Upstream errors converted to downstream format
- **Auth**: Bearer token validation per downstream

## Multimodal (Images)

The bridge automatically handles image content format conversion:

```json
// OpenAI format
{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}

// Anthropic format
{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}
```

## Development

```bash
npm run dev    # watch mode
npm start      # production mode
```

### Requirements

- Node.js >= 18 (for native fetch)
- Dependencies: express, cors, commander, inquirer, chalk (only 5)
