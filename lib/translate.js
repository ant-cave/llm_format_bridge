// ============================================================
// LLM Format Bridge — 核心翻译器
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
//
// 支持 6 个方向的格式翻译:
//   openai_completions ↔ openai_responses ↔ anthropic
// 含多模态图片格式转换、流式 SSE 事件转换、错误格式转换。
// ============================================================

import { randomBytes } from 'crypto';

// ---- 工具函数 ----

// 生成 Unix 时间戳（秒级，用于构造 OpenAI 响应中的 created 字段）
function toUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

// 生成随机 ID（OpenAI 风格：chatcmpl-xxxxxxxx... 或 msg_xxxxxxxx...）
function generateId(prefix = 'chatcmpl') {
  return `${prefix}-${randomBytes(18).toString('base64url')}`;
}

// ============================================================
// Data URI 解析工具
// 格式: data:[<mediatype>][;base64],<data>
// 示例: data:image/png;base64,iVBORw0KGgo...
// ============================================================
const DATA_URI_RE = /^data:((image\/(\w+)));base64,(.+)$/;

/**
 * 将 data URI 解析为 media_type + base64 数据。
 * 用于 OpenAI 的 image_url → Anthropic 的 image.source 转换。
 */
export function parseDataURI(uri) {
  const m = uri.match(DATA_URI_RE);
  if (!m) return null;
  return {
    media_type: m[1],  // "image/png"
    format: m[3],      // "png"
    data: m[4]         // base64 编码的图片数据
  };
}

/** 反向操作：将 media_type + base64 数据拼回 data URI */
export function buildDataURI(mediaType, base64Data) {
  return `data:${mediaType};base64,${base64Data}`;
}

// ============================================================
// 多模态图片格式转换
// OpenAI:  {type:"image_url", image_url:{url:"data:..."}}
// Anthropic: {type:"image", source:{type:"base64", media_type:"...", data:"..."}}
// ============================================================

/** OpenAI image_url → Anthropic image (支持 base64 和 URL 两种 source) */
function convertOpenAIImageToAnthropic(contentItem) {
  if (contentItem.type !== 'image_url') return null;
  const url = contentItem.image_url?.url;
  if (!url) return null;

  const parsed = parseDataURI(url);
  if (parsed) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: parsed.media_type,
        data: parsed.data
      }
    };
  }

  // 非 data URI（如 https://...），保留为 URL 形式
  return {
    type: 'image',
    source: {
      type: 'url',
      url: url
    }
  };
}

/** Anthropic image → OpenAI image_url */
function convertAnthropicImageToOpenAI(contentItem) {
  if (contentItem.type !== 'image') return null;
  const src = contentItem.source;
  if (!src) return null;

  if (src.type === 'base64') {
    const dataUri = buildDataURI(src.media_type || 'image/png', src.data);
    return {
      type: 'image_url',
      image_url: { url: dataUri, detail: 'auto' }
    };
  }

  if (src.type === 'url') {
    return {
      type: 'image_url',
      image_url: { url: src.url, detail: 'auto' }
    };
  }

  return null;
}

// ============================================================
// Content 数组转换：在 OpenAI 与 Anthropic 之间翻译消息 content
// OpenAI 支持 string 和 array 两种格式，Anthropic 支持 array 格式
// 转换时递归处理数组中的图片条目
// ============================================================

/** 从 OpenAI 格式读取 content（转为 Anthropic 能理解的格式） */
function convertContentFromOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;
  return content.map(item => {
    if (item.type === 'image_url') {
      return convertOpenAIImageToAnthropic(item) || item;
    }
    return item;
  });
}

/** 转换为 OpenAI 格式的 content */
function convertContentToOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;
  return content.map(item => {
    if (item.type === 'image') {
      return convertAnthropicImageToOpenAI(item) || item;
    }
    return item;
  });
}

/** 从 Anthropic 格式读取 content（转为 OpenAI 能理解的格式） */
function convertContentFromAnthropic(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;
  return content.map(item => {
    if (item.type === 'image') {
      return convertAnthropicImageToOpenAI(item) || item;
    }
    return item;
  });
}

/** 转换为 Anthropic 格式的 content */
function convertContentToAnthropic(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;
  return content.map(item => {
    if (item.type === 'image_url') {
      return convertOpenAIImageToAnthropic(item) || item;
    }
    return item;
  });
}

// ============================================================
// 模型名映射
// 按 route 中 model_mapping 的配置规则：
//   精确匹配 → default → 原样透传
// ============================================================

function mapModelName(originalModel, modelMapping) {
  if (!modelMapping) return originalModel;
  if (modelMapping[originalModel]) return modelMapping[originalModel];
  if (modelMapping['default']) return modelMapping['default'];
  return originalModel;
}

// ============================================================
// Request 翻译
// ============================================================

/**
 * OpenAI Chat Completions → Anthropic Messages 请求翻译。
 * 关键转换点：
 *   - system role 的消息提取到顶层 system 字段
 *   - image_url 转为 image.source（base64/URL）
 *   - stop 数组转为 stop_sequences
 *   - max_completion_tokens 转为 max_tokens
 */
/** OpenAI tool → Anthropic tool */
function convertTool_OpenAI_to_Anthropic(tool) {
  if (tool.type === 'function') {
    return {
      name: tool.function?.name || '',
      description: tool.function?.description || '',
      input_schema: tool.function?.parameters || {}
    };
  }
  return tool;
}

/** Anthropic tool → OpenAI tool */
function convertTool_Anthropic_to_OpenAI(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name || '',
      description: tool.description || '',
      parameters: tool.input_schema || {}
    }
  };
}

function translateReq_OpenAIChat_to_Anthropic(body, modelMapping) {
  const messages = body.messages || [];
  const systemParts = [];
  const otherMessages = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const c = typeof msg.content === 'string' ? msg.content : '';
      if (c) systemParts.push(c);
    } else if (msg.role === 'assistant') {
      const anthContent = [];

      if (msg.content) {
        if (typeof msg.content === 'string') {
          anthContent.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const item of convertContentFromOpenAI(msg.content)) {
            anthContent.push(item);
          }
        }
      }

      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let input = {};
          if (typeof tc.function?.arguments === 'string') {
            try { input = JSON.parse(tc.function.arguments); } catch { input = tc.function.arguments; }
          }
          anthContent.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name || '',
            input
          });
        }
      }

      otherMessages.push({ role: 'assistant', content: anthContent.length > 0 ? anthContent : '' });
    } else if (msg.role === 'tool') {
      const toolContent = msg.content || '';
      const resultContent = typeof toolContent === 'string'
        ? toolContent
        : (Array.isArray(toolContent)
          ? toolContent.filter(c => c.type === 'text').map(c => c.text).join('')
          : '');

      otherMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: resultContent
        }]
      });
    } else {
      otherMessages.push({
        role: msg.role,
        content: convertContentFromOpenAI(msg.content)
      });
    }
  }

  const result = {
    model: mapModelName(body.model, modelMapping),
    messages: otherMessages,
    max_tokens: body.max_tokens || body.max_completion_tokens || 4096,
    stream: !!body.stream
  };

  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop) result.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (body.tools) {
    result.tools = Array.isArray(body.tools) ? body.tools.map(convertTool_OpenAI_to_Anthropic) : body.tools;
  }
  if (body.tool_choice) {
    const tc = body.tool_choice;
    if (typeof tc === 'string') {
      result.tool_choice = { type: tc === 'auto' ? 'auto' : tc === 'required' ? 'any' : tc };
    } else if (tc?.type === 'function') {
      result.tool_choice = { type: 'tool', name: tc.function?.name || '' };
    }
  }
  if (body.metadata) result.metadata = body.metadata;
  if (systemParts.length > 0) result.system = systemParts.join('\n');

  return result;
}

/**
 * OpenAI Chat Completions → OpenAI Responses 请求翻译。
 * 转换点：
 *   - messages 数组转为 input 数组
 *   - 每个消息的 content（string）转为 input_text 类型的 content 数组
 *   - image_url 转为 image_file
 *   - max_tokens 转为 max_output_tokens
 */
function translateReq_OpenAIChat_to_OpenAIResponses(body, modelMapping) {
  const messages = body.messages || [];
  const input = [];

  let instructions = '';
  for (const msg of messages) {
    if (msg.role === 'system') {
      const c = typeof msg.content === 'string' ? msg.content : '';
      if (c) instructions += (instructions ? '\n' : '') + c;
      continue;
    }

    const c = typeof msg.content === 'string'
      ? [{ type: 'input_text', text: msg.content }]
      : (Array.isArray(msg.content)
        ? msg.content.map(item => {
            if (item.type === 'image_url') {
              return { type: 'image_file', image_file: { url: item.image_url?.url || '' } };
            }
            return { type: 'input_text', text: item.text || '' };
          })
        : []);

    input.push({
      role: msg.role,
      content: c
    });
  }

  const result = {
    model: mapModelName(body.model, modelMapping),
    input,
    stream: !!body.stream
  };

  if (body.max_tokens || body.max_completion_tokens) result.max_output_tokens = body.max_tokens || body.max_completion_tokens;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.tools) result.tools = body.tools;
  if (body.tool_choice) result.tool_choice = body.tool_choice;
  if (body.metadata) result.metadata = body.metadata;
  if (body.store !== undefined) result.store = body.store;
  if (instructions) result.instructions = instructions;

  return result;
}

/**
 * Anthropic Messages → OpenAI Chat Completions 请求翻译。
 * 关键转换点：
 *   - 顶层 system 字段转为首条 system role 消息
 *   - image.source 转为 image_url（data URI）
 *   - stop_sequences 转为 stop 数组
 */
function translateReq_Anthropic_to_OpenAIChat(body, modelMapping) {
  const messages = body.messages || [];
  const converted = [];
  let systemContent = body.system || '';

  for (const msg of messages) {
    if (msg.role === 'system') {
      const c = typeof msg.content === 'string'
        ? msg.content
        : (Array.isArray(msg.content) ? msg.content.filter(i => i.type === 'text').map(i => i.text).join('\n') : '');
      if (c) systemContent += (systemContent ? '\n' : '') + c;
      continue;
    }

    if (msg.role === 'assistant') {
      const content = msg.content;
      const textParts = [];
      const toolUses = [];

      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'text') {
            textParts.push(item.text);
          } else if (item.type === 'tool_use') {
            toolUses.push(item);
          } else if (item.type === 'image') {
            const converted = convertAnthropicImageToOpenAI(item);
            if (converted) textParts.push('[Image]');
          }
        }
      } else if (typeof content === 'string') {
        textParts.push(content);
      }

      const assistantMsg = { role: 'assistant' };
      const fullText = textParts.join('');
      assistantMsg.content = fullText || (toolUses.length > 0 ? null : fullText);

      if (toolUses.length > 0) {
        assistantMsg.tool_calls = toolUses.map(tu => ({
          id: tu.id || generateId('call'),
          type: 'function',
          function: {
            name: tu.name || '',
            arguments: JSON.stringify(tu.input || {})
          }
        }));
      }

      converted.push(assistantMsg);
    } else if (msg.role === 'user') {
      const content = msg.content;
      if (Array.isArray(content) && content.some(c => c.type === 'tool_result')) {
        const textParts = [];
        for (const item of content) {
          if (item.type === 'tool_result') {
            const resultContent = typeof item.content === 'string'
              ? item.content
              : (Array.isArray(item.content)
                ? item.content.filter(c => c.type === 'text').map(c => c.text).join('')
                : '');
            converted.push({
              role: 'tool',
              tool_call_id: item.tool_use_id,
              content: resultContent
            });
          } else if (item.type === 'text') {
            textParts.push(item.text);
          }
        }
        if (textParts.length > 0) {
          converted.push({ role: 'user', content: textParts.join('\n') });
        }
      } else {
        converted.push({
          role: msg.role,
          content: convertContentFromAnthropic(msg.content)
        });
      }
    } else {
      converted.push({
        role: msg.role,
        content: convertContentFromAnthropic(msg.content)
      });
    }
  }

  const result = {
    model: mapModelName(body.model, modelMapping),
    messages: converted,
    max_tokens: body.max_tokens || 4096,
    stream: !!body.stream
  };

  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.top_k !== undefined) result.top_k = body.top_k;
  if (body.stop_sequences) result.stop = body.stop_sequences;
  if (body.tools) {
    result.tools = Array.isArray(body.tools) ? body.tools.map(convertTool_Anthropic_to_OpenAI) : body.tools;
  }
  if (body.tool_choice) {
    const tc = body.tool_choice;
    if (typeof tc === 'object' && tc.type === 'auto') {
      result.tool_choice = 'auto';
    } else if (typeof tc === 'object' && tc.type === 'any') {
      result.tool_choice = 'required';
    } else if (typeof tc === 'object' && tc.type === 'tool') {
      result.tool_choice = { type: 'function', function: { name: tc.name || '' } };
    }
  }
  if (body.metadata) result.metadata = body.metadata;
  if (systemContent) {
    result.messages.unshift({ role: 'system', content: systemContent });
  }

  return result;
}

/**
 * Anthropic → OpenAI Responses：先转为 OpenAI Chat，再转为 Responses。
 * 通过两层翻译组合实现。
 */
function translateReq_Anthropic_to_OpenAIResponses(body, modelMapping) {
  const chatReq = translateReq_Anthropic_to_OpenAIChat(body, modelMapping);
  return translateReq_OpenAIChat_to_OpenAIResponses(chatReq, modelMapping);
}

function translateReq_OpenAIResponses_to_OpenAIChat(body, modelMapping) {
  const input = body.input || [];
  const messages = [];

  for (const item of input) {
    if (item.role) {
      const c = Array.isArray(item.content)
        ? item.content.map(ci => {
            if (ci.type === 'image_file') {
              return { type: 'image_url', image_url: { url: ci.image_file?.url || '' } };
            }
            return { type: 'text', text: ci.text || '' };
          })
        : (typeof item.content === 'string' ? item.content : '');
      messages.push({ role: item.role, content: c });
    }
  }

  if (!messages.some(m => m.role === 'system') && body.instructions) {
    messages.unshift({ role: 'system', content: body.instructions });
  }

  const result = {
    model: mapModelName(body.model, modelMapping),
    messages,
    max_tokens: body.max_output_tokens || 4096,
    stream: !!body.stream
  };

  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.tools) result.tools = body.tools;
  if (body.tool_choice) result.tool_choice = body.tool_choice;
  if (body.metadata) result.metadata = body.metadata;

  return result;
}

function translateReq_OpenAIResponses_to_Anthropic(body, modelMapping) {
  const chatReq = translateReq_OpenAIResponses_to_OpenAIChat(body, modelMapping);
  return translateReq_OpenAIChat_to_Anthropic(chatReq, modelMapping);
}

// ============================================================
// Response 翻译（非流式）
// ============================================================

// ============================================================
// 响应翻译 (非流式)
// 将上游格式的完整 JSON 响应转为下游格式
// ============================================================

/** Anthropic Messages → OpenAI Chat Completions 响应翻译 */
function translateRes_Anthropic_to_OpenAIChat(anthropicRes, modelName) {
  const content = anthropicRes.content || [];
  const textParts = content.filter(c => c.type === 'text').map(c => c.text);
  const fullText = textParts.join('');
  const toolUses = content.filter(c => c.type === 'tool_use');

  const message = { role: 'assistant' };
  message.content = fullText || (toolUses.length > 0 ? null : '');

  if (toolUses.length > 0) {
    message.tool_calls = toolUses.map(tu => ({
      id: tu.id || generateId('call'),
      type: 'function',
      function: {
        name: tu.name || '',
        arguments: JSON.stringify(tu.input || {})
      }
    }));
  }

  const finish_reason = anthropicRes.stop_reason === 'end_turn' ? 'stop'
    : anthropicRes.stop_reason === 'max_tokens' ? 'length'
    : anthropicRes.stop_reason === 'stop_sequence' ? 'stop'
    : anthropicRes.stop_reason === 'tool_use' ? 'tool_calls'
    : 'stop';

  return {
    id: generateId(),
    object: 'chat.completion',
    created: toUnixTimestamp(),
    model: modelName || anthropicRes.model,
    choices: [{
      index: 0,
      message,
      finish_reason
    }],
    usage: anthropicRes.usage ? {
      prompt_tokens: anthropicRes.usage.input_tokens || 0,
      completion_tokens: anthropicRes.usage.output_tokens || 0,
      total_tokens: (anthropicRes.usage.input_tokens || 0) + (anthropicRes.usage.output_tokens || 0)
    } : undefined,
    ...(anthropicRes.id ? { id: anthropicRes.id } : {}),
    system_fingerprint: null
  };
}

/** OpenAI Chat Completions → Anthropic Messages 响应翻译 */
function translateRes_OpenAIChat_to_Anthropic(openaiRes, modelName) {
  const choice = openaiRes.choices?.[0];
  const msg = choice?.message;
  const text = msg?.content || '';
  const toolCalls = msg?.tool_calls;
  const inputTokens = openaiRes.usage?.prompt_tokens || 0;
  const outputTokens = openaiRes.usage?.completion_tokens || 0;

  const content = [];
  if (text) content.push({ type: 'text', text });
  if (toolCalls && Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      let input = {};
      if (typeof tc.function?.arguments === 'string') {
        try { input = JSON.parse(tc.function.arguments); } catch {}
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function?.name || '',
        input
      });
    }
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    id: generateId('msg'),
    type: 'message',
    role: 'assistant',
    content,
    model: modelName || openaiRes.model,
    stop_reason: choice?.finish_reason === 'stop' ? 'end_turn'
      : choice?.finish_reason === 'length' ? 'max_tokens'
      : choice?.finish_reason === 'tool_calls' ? 'tool_use'
      : choice?.finish_reason || 'end_turn',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    }
  };
}

/** OpenAI Chat Completions → OpenAI Responses 响应翻译 */
function translateRes_OpenAIChat_to_OpenAIResponses(openaiRes, modelName) {
  return {
    id: generateId('resp'),
    object: 'response',
    status: 'completed',
    model: modelName || openaiRes.model,
    output: openaiRes.choices?.map((c, i) => ({
      type: 'message',
      id: generateId('msg'),
      role: 'assistant',
      content: c.message?.content || '',
      index: i
    })) || [],
    usage: openaiRes.usage ? {
      input_tokens: openaiRes.usage.prompt_tokens || 0,
      output_tokens: openaiRes.usage.completion_tokens || 0,
      total_tokens: openaiRes.usage.total_tokens || 0
    } : undefined
  };
}

/** OpenAI Responses → OpenAI Chat Completions 响应翻译 */
function translateRes_OpenAIResponses_to_OpenAIChat(responsesRes, modelName) {
  const output = responsesRes.output || [];
  const textParts = output.filter(o => o.type === 'message').map(o => o.content || '');
  const fullText = textParts.join('');

  return {
    id: generateId(),
    object: 'chat.completion',
    created: toUnixTimestamp(),
    model: modelName || responsesRes.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: fullText
      },
      finish_reason: responsesRes.status === 'completed' ? 'stop' : 'length'
    }],
    usage: responsesRes.usage ? {
      prompt_tokens: responsesRes.usage.input_tokens || 0,
      completion_tokens: responsesRes.usage.output_tokens || 0,
      total_tokens: responsesRes.usage.total_tokens || 0
    } : undefined
  };
}

/**
 * Anthropic → OpenAI Responses：通过 Chat 格式中转。
 * Anthropic → Chat → Responses，两步组合。
 */
function translateRes_Anthropic_to_OpenAIResponses(anthropicRes, modelName) {
  const chatRes = translateRes_Anthropic_to_OpenAIChat(anthropicRes, modelName);
  return translateRes_OpenAIChat_to_OpenAIResponses(chatRes, modelName);
}

/**
 * OpenAI Responses → Anthropic：通过 Chat 格式中转。
 * Responses → Chat → Anthropic，两步组合。
 */
function translateRes_OpenAIResponses_to_Anthropic(responsesRes, modelName) {
  const chatRes = translateRes_OpenAIResponses_to_OpenAIChat(responsesRes, modelName);
  return translateRes_OpenAIChat_to_Anthropic(chatRes, modelName);
}

// ============================================================
// 错误翻译：将上游返回的错误信息转为下游格式
// 三种格式：
//   openai_completions: {error: {message, type, code}}
//   anthropic: {type: "error", error: {type, message}}
//   openai_responses: {error: {message, code, type}}
// ============================================================

function _translateError(fromProvider, toProvider, errorBody, statusCode) {
  if (toProvider === 'openai_completions') {
    return {
      error: {
        message: errorBody?.error?.message || errorBody?.message || 'Unknown error',
        type: errorBody?.error?.type || 'api_error',
        code: errorBody?.error?.code || statusCode
      }
    };
  }
  if (toProvider === 'anthropic') {
    return {
      type: 'error',
      error: {
        type: errorBody?.error?.type || 'api_error',
        message: errorBody?.error?.message || errorBody?.message || 'Unknown error'
      }
    };
  }
  if (toProvider === 'openai_responses') {
    return {
      error: {
        message: errorBody?.error?.message || errorBody?.message || 'Unknown error',
        code: errorBody?.error?.code || statusCode,
        type: errorBody?.error?.type || 'api_error'
      }
    };
  }
  return errorBody;
}

// ============================================================
// Streaming SSE 事件翻译
// Anthropic 使用 event + data 双行格式：
//   event: content_block_delta
//   data: {"type":"content_block_delta","delta":{"text":"..."}}
// OpenAI 使用纯 data 行格式：
//   data: {"choices":[{"delta":{"content":"..."},"index":0}]}
// ============================================================

/**
 * Anthropic SSE 事件 → OpenAI SSE data 行。
 * 事件对照关系：
 *   message_start              → 首块 (delta.role=assistant)
 *   content_block_start        → tool_use 块起始（记录 tool_use 信息）
 *   content_block_delta(text)  → 内容块 (delta.content)
 *   content_block_delta(input_json_delta) → tool_calls delta (delta.tool_calls)
 *   message_delta              → finish_reason 块
 *   message_stop               → [DONE]
 */
function translateStreamEvent_Anthropic_to_OpenAI(event, state) {
  if (!state || !state.id) { state.id = generateId(); state.model = ''; state.created = toUnixTimestamp(); state.toolCallBuffer = {}; }

  switch (event.type) {
    case 'message_start': {
      state.model = event.message?.model || state.model;
      return JSON.stringify({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
      });
    }
    case 'content_block_start': {
      const block = event.content_block;
      if (block && block.type === 'tool_use') {
        const tIdx = event.index;
        const tcIdx = Object.keys(state.toolCallBuffer).length;
        state.toolCallBuffer[tIdx] = {
          id: block.id,
          name: block.name,
          args: '',
          toolCallIndex: tcIdx
        };
        return JSON.stringify({
          id: state.id,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: tcIdx,
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: '' }
              }]
            },
            finish_reason: null
          }]
        });
      }
      return null;
    }
    case 'content_block_delta': {
      const text = event.delta?.text;
      if (text) {
        return JSON.stringify({
          id: state.id,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
        });
      }
      const partialJson = event.delta?.partial_json;
      if (partialJson) {
        const tIdx = event.index;
        const buf = state.toolCallBuffer[tIdx];
        if (buf) {
          buf.args += partialJson;
          return JSON.stringify({
            id: state.id,
            object: 'chat.completion.chunk',
            created: state.created,
            model: state.model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: buf.toolCallIndex,
                  id: buf.toolCallIndex === 0 && Object.keys(state.toolCallBuffer).length <= 1 ? (buf.id || undefined) : undefined,
                  function: { arguments: partialJson }
                }]
              },
              finish_reason: null
            }]
          });
        }
      }
      return null;
    }
    case 'content_block_stop': {
      return null;
    }
    case 'message_delta': {
      const reason = event.delta?.stop_reason;
      const finish = reason === 'end_turn' ? 'stop'
        : reason === 'max_tokens' ? 'length'
        : reason === 'stop_sequence' ? 'stop'
        : reason === 'tool_use' ? 'tool_calls'
        : null;
      if (!finish) return null;
      return JSON.stringify({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta: {}, finish_reason: finish }]
      });
    }
    case 'message_stop': {
      return '[DONE]';
    }
    default:
      return null;
  }
}

/**
 * OpenAI SSE data → Anthropic SSE 事件。
 * 反向翻译：
 *   delta.role          → message_start
 *   delta.content       → content_block_start(text) + content_block_delta
 *   delta.tool_calls    → content_block_start(tool_use) + content_block_delta(input_json_delta)
 *   finish_reason       → content_block_stop + message_delta + message_stop
 *
 * 注意：一个 OpenAI chunk 可能产生多个 Anthropic 事件，
 * 因此返回值为数组。
 */
function translateStreamEvent_OpenAI_to_Anthropic(event, state) {
  if (!state || !state.msgId) {
    state.msgId = generateId('msg');
    state.model = '';
    state.roleSent = false;
    state.textBlockStarted = false;
    state.textIndex = 0;
    state.toolCallBuffers = {};
    state.nextToolIndex = 1;
  }

  const choices = event.choices?.[0];
  if (!choices) return null;

  const delta = choices.delta || {};
  const finish = choices.finish_reason;
  const toolCallsDelta = delta.tool_calls;

  const events = [];

  if (delta.role && !state.roleSent) {
    state.roleSent = true;
    events.push({
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: state.msgId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: event.model || state.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      }
    });
  }

  if (delta.content) {
    if (!state.textBlockStarted) {
      state.textBlockStarted = true;
      events.push({
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: state.textIndex,
          content_block: { type: 'text', text: '' }
        }
      });
    }
    events.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: state.textIndex,
        delta: { type: 'text_delta', text: delta.content }
      }
    });
  }

  if (toolCallsDelta && Array.isArray(toolCallsDelta)) {
    for (const tc of toolCallsDelta) {
      const tIdx = tc.index;
      if (!state.toolCallBuffers[tIdx]) {
        state.toolCallBuffers[tIdx] = { id: '', name: '', args: '', anthIndex: state.nextToolIndex++ };
      }
      const buf = state.toolCallBuffers[tIdx];

      if (tc.id) {
        buf.id = tc.id;
        buf.name = tc.function?.name || '';
        events.push({
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: buf.anthIndex,
            content_block: { type: 'tool_use', id: tc.id, name: buf.name, input: {} }
          }
        });
      }
      if (tc.function?.arguments) {
        buf.args += tc.function.arguments;
        events.push({
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: buf.anthIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
          }
        });
      }
    }
  }

  if (finish) {
    if (state.textBlockStarted) {
      events.push({
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: state.textIndex }
      });
    }
    const toolIndices = Object.values(state.toolCallBuffers).map(b => b.anthIndex).sort();
    for (const idx of toolIndices) {
      events.push({
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: idx }
      });
    }
    const stopReason = finish === 'stop' ? 'end_turn'
      : finish === 'length' ? 'max_tokens'
      : finish === 'tool_calls' ? 'tool_use'
      : 'end_turn';
    events.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { input_tokens: state.inputTokens || 0, output_tokens: state.outputTokens || 0 }
      }
    });
    events.push({
      event: 'message_stop',
      data: { type: 'message_stop' }
    });
  }

  return events;
}

function translateStreamEvent_Anthropic_to_OpenAIResponses(event, state) {
  if (!state || !state.respId) { state.respId = generateId('resp'); state.model = ''; }

  switch (event.type) {
    case 'message_start': {
      state.model = event.message?.model || state.model;
      return {
        type: 'response.output_message.added',
        data: {
          id: generateId('msg'),
          type: 'message',
          role: 'assistant',
          content: [],
          status: 'in_progress'
        }
      };
    }
    case 'content_block_delta': {
      const text = event.delta?.text || '';
      if (!text) return null;
      return {
        type: 'response.output_text.delta',
        data: { delta: text }
      };
    }
    case 'message_delta': {
      return {
        type: 'response.completed',
        data: { status: 'completed' }
      };
    }
    default:
      return null;
  }
}

function formatSSE_OpenAI(data) {
  return `data: ${data}\n\n`;
}

function formatSSE_Anthropic(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function formatSSE_OpenAI_Done() {
  return 'data: [DONE]\n\n';
}

// ============================================================
// 翻译器注册表 & 导出函数
// ============================================================

// 请求翻译器注册表：通过 "下游格式->上游格式" 字符串查找对应翻译函数
const REQUEST_TRANSLATORS = {
  'openai_completions->anthropic': translateReq_OpenAIChat_to_Anthropic,
  'openai_completions->openai_responses': translateReq_OpenAIChat_to_OpenAIResponses,
  'anthropic->openai_completions': translateReq_Anthropic_to_OpenAIChat,
  'anthropic->openai_responses': translateReq_Anthropic_to_OpenAIResponses,
  'openai_responses->openai_completions': translateReq_OpenAIResponses_to_OpenAIChat,
  'openai_responses->anthropic': translateReq_OpenAIResponses_to_Anthropic
};

// 响应翻译器注册表
const RESPONSE_TRANSLATORS = {
  'anthropic->openai_completions': translateRes_Anthropic_to_OpenAIChat,
  'openai_completions->anthropic': translateRes_OpenAIChat_to_Anthropic,
  'openai_completions->openai_responses': translateRes_OpenAIChat_to_OpenAIResponses,
  'openai_responses->openai_completions': translateRes_OpenAIResponses_to_OpenAIChat,
  'anthropic->openai_responses': translateRes_Anthropic_to_OpenAIResponses,
  'openai_responses->anthropic': translateRes_OpenAIResponses_to_Anthropic
};

// 流式翻译器注册表（只支持最常用的方向，其他用透传兜底）
const STREAM_TRANSLATORS = {
  'anthropic->openai_completions': translateStreamEvent_Anthropic_to_OpenAI,
  'openai_completions->anthropic': translateStreamEvent_OpenAI_to_Anthropic,
  'anthropic->openai_responses': translateStreamEvent_Anthropic_to_OpenAIResponses
};

// SSE 格式化器：不同供应商的 SSE 序列化格式不同
const SSE_FORMATTERS = {
  openai_completions: {
    format: (data) => {
      if (data === '[DONE]') return formatSSE_OpenAI_Done();
      return formatSSE_OpenAI(data);
    },
    endOfStream: '[DONE]'
  },
  anthropic: {
    format: (events) => {
      if (!Array.isArray(events)) events = [events];
      return events.map(e => formatSSE_Anthropic(e.event, e.data)).join('');
    },
    endOfStream: null  // Anthropic 没有特殊的结束标记，message_stop 事件即结束
  },
  openai_responses: {
    format: (data) => formatSSE_OpenAI(data),
    endOfStream: '[DONE]'
  }
};

/**
 * 翻译前剥离下游请求中的 thinking 参数。
 * 只处理下游原文格式，确保 Anthropic 的 thinking 不会进入翻译器。
 */
export function stripThinkingParams(body, provider) {
  if (!body) return body;
  if (provider === 'anthropic') {
    delete body.thinking;
  } else if (provider === 'openai_completions' || provider === 'openai_responses') {
    delete body.reasoning_effort;
    delete body.reasoning;
  }
  return body;
}

/**
 * 翻译后强制关闭上游的思考功能。
 * 不同的上游 provider 有不同的 thinking 参数格式：
 *   - openai_completions (DeepSeek):  thinking: {type: "disabled"}
 *   - openai_responses:                reasoning: {effort: "low"}（最低档）
 *   - anthropic:                       删除 thinking 字段即可（已在 stripThinkingParams 处理）
 * 在 translatedBody 上直接修改。
 */
export function forceDisableThinking(body, provider) {
  if (!body) return body;
  if (provider === 'openai_completions') {
    // DeepSeek API: thinking 默认 type: "enabled"，必须显式设为 disabled
    body.thinking = { type: 'disabled' };
  } else if (provider === 'openai_responses') {
    body.reasoning = { effort: 'low' };
  }
  return body;
}

/**
 * 从流式 SSE 事件（parsed data）中剥离 thinking/reasoning 相关字段。
 * 用于 force_disable_thinking 时拦截上游响应中可能残留的思考内容。
 */
export function stripStreamThinking(event, provider) {
  if (!event) return event;
  if (provider === 'openai_completions') {
    const choices = event.choices?.[0];
    if (choices?.delta) {
      delete choices.delta.reasoning_content;
    }
  }
  return event;
}

/**
 * 请求翻译入口。上下游格式相同时透传，不同时查注册表翻译。
 */
export function translateRequest(body, fromProvider, toProvider, modelMapping) {
  if (fromProvider === toProvider) return body;

  const key = `${fromProvider}->${toProvider}`;
  const translator = REQUEST_TRANSLATORS[key];
  if (!translator) throw new Error(`不支持的请求翻译方向: ${key}`);

  return translator(body, modelMapping);
}

/**
 * 响应翻译入口。上下游格式相同时透传，不同时查注册表翻译。
 */
export function translateResponse(body, fromProvider, toProvider, modelName) {
  if (fromProvider === toProvider) return body;

  const key = `${fromProvider}->${toProvider}`;
  const translator = RESPONSE_TRANSLATORS[key];
  if (!translator) throw new Error(`不支持的响应翻译方向: ${key}`);

  return translator(body, modelName);
}

/**
 * 错误翻译入口：将上游错误转为下游格式。
 * 参数顺序注意：fromProvider 是上游，toProvider 是下游。
 */
export function translateAndFormatError(errorBody, statusCode, fromProvider, toProvider) {
  return _translateError(fromProvider, toProvider, errorBody, statusCode);
}

/**
 * 获取流式翻译器。格式相同时返回 null（表示直接透传）。
 * 返回格式：{ available, translate, format, endOfStream }
 *   available=false 表示该翻译方向不支持流式
 */
export function getStreamTranslator(fromProvider, toProvider) {
  if (fromProvider === toProvider) return null;

  const key = `${fromProvider}->${toProvider}`;
  const translator = STREAM_TRANSLATORS[key];
  if (!translator) {
    return { available: false };
  }

  const formatter = SSE_FORMATTERS[toProvider];
  return {
    available: true,
    translate: translator,
    format: formatter.format,
    endOfStream: formatter.endOfStream
  };
}

/**
 * 解析单行 SSE 数据。
 * 支持三种格式：
 *   data: {...}    → { type: 'data', data: {...} }
 *   data: [DONE]   → { type: 'done' }
 *   event: xxx     → { type: 'event', event: 'xxx' }
 */
export function parseSSE(line) {
  if (line.startsWith('data: ')) {
    const data = line.slice(6);
    if (data === '[DONE]') return { type: 'done', data: null };
    try {
      return { type: 'data', data: JSON.parse(data) };
    } catch {
      return { type: 'raw', data };
    }
  }
  if (line.startsWith('event: ')) {
    return { type: 'event', event: line.slice(7) };
  }
  return null;
}
