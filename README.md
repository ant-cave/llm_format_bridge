# LLM Format Bridge

**English** | [中文](docs/guide.zh.md)

A lightweight proxy that translates between LLM API formats (OpenAI Chat Completions / Responses, Anthropic). Let downstream agents use their preferred format, bridge auto-converts to the upstream provider.

For full documentation, see [docs/guide.md](docs/guide.md) | 完整文档见 [docs/guide.zh.md](docs/guide.zh.md)

```bash
git clone <repo> && cd llm-format-bridge && npm install
./index.js                 # 交互式菜单
./index.js start           # 启动服务
npm start                  # 同上
```

### Quick Example

Downstream agent sends Anthropic format, bridge converts to OpenAI:

```bash
curl -X POST http://localhost:8080/v1/messages \
  -H "Authorization: Bearer my-bridge-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hi"}],"max_tokens":100}'
```

### Features

- Format translation: openai_completions ↔ openai_responses ↔ anthropic (all 6 directions)
- Multi-modal: automatic image format conversion
- Streaming: SSE event format translation
- Model mapping: one-to-one with `default` fallback
- Auth: per-downstream API key validation
- Language: bilingual (中文 / English) CLI interface
- Lightweight: only 5 dependencies, 1700+ lines of code

---

### 致谢 / Acknowledgments

If you distribute or use this project, please consider mentioning
[ant-cave](https://github.com/ant-cave) in your project or its documentation.
This is **not** a license requirement — it would just greatly encourage me to
keep contributing to the open-source community.

如果你在项目中分发或使用了本项目，请求你在项目或文档中提一下
[ant-cave](https://github.com/ant-cave)。这不是协议强制要求，
但这会让我备受鼓舞，继续为开源社区贡献更多。谢谢！
