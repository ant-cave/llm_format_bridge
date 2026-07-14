#!/usr/bin/env node
/**
 * LLM Format Bridge — 翻译器单元测试
 * Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
 *
 * 测试覆盖 6 个方向的所有翻译器：
 *   请求 / 响应 / 流式 / 错误
 * 字段格式通过 OpenAI OpenAPI 官方规范 (openai.yaml) 和 Anthropic API 文档验证。
 *
 * OpenAI Chat Completions:
 *   POST /v1/chat/completions
 *   Request:  model(required), messages(required), temperature, top_p, max_tokens, stop, stream,
 *             frequency_penalty, presence_penalty, logit_bias, seed, n, tools, tool_choice, ...
 *   Response: id, object="chat.completion", created, model, choices[{index,message,finish_reason}], usage
 *   Stream:   id, object="chat.completion.chunk", choices[{delta:{role/content},finish_reason}]
 *
 * OpenAI Responses:
 *   POST /v1/responses
 *   Request:  model(required), input(required), instructions, max_output_tokens, temperature, top_p, tools, tool_choice, stream, store, metadata
 *   Response: id, object="response", status, model, output[{type,id,role,content}], usage
 *
 * Anthropic Messages:
 *   POST /v1/messages
 *   Request:  model(required), messages(required), max_tokens(required), system, temperature, top_p, top_k, stop_sequences, stream, metadata, tools, tool_choice
 *   Response: id, type="message", role, content[{type,text}], model, stop_reason, usage{input_tokens,output_tokens}
 *   Stream:   event: message_start / content_block_delta / message_delta / message_stop
 */

let pass = 0, fail = 0;

function assert(condition, msg) {
  if (condition) { pass++; }
  else { fail++; console.error(`  FAIL: ${msg}`); }
}

import {
  translateRequest,
  translateResponse,
  translateAndFormatError,
  getStreamTranslator,
  parseSSE,
  parseDataURI,
  buildDataURI,
  stripThinkingParams,
  forceDisableThinking,
  stripStreamThinking
} from '../lib/translate.js';

// ================================================================
// 1. 请求翻译
// ================================================================

// ---- 1a. OpenAI Chat → Anthropic ----

{
  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi!' }
    ],
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: 200,
    stop: ['\n', 'END'],
    stream: true,
    tools: [{
      type: 'function',
      function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }
    }],
    tool_choice: 'auto',
    metadata: { session: 'abc' }
  };
  const r = translateRequest(body, 'openai_completions', 'anthropic', {});
  assert(r.model === 'gpt-4o', 'Chat→Anth: model');
  assert(r.messages.length === 1, 'Chat→Anth: system extracted');
  assert(r.messages[0].role === 'user', 'Chat→Anth: user role');
  assert(r.system === 'You are helpful.', 'Chat→Anth: system top-level');
  assert(r.max_tokens === 200, 'Chat→Anth: max_tokens');
  assert(r.temperature === 0.7, 'Chat→Anth: temperature');
  assert(r.top_p === 0.9, 'Chat→Anth: top_p');
  assert(r.stream === true, 'Chat→Anth: stream');
  assert(r.stop_sequences[0] === '\n', 'Chat→Anth: stop→stop_sequences');
  assert(r.tools[0].name === 'get_weather', 'Chat→Anth: tool name');
  assert(r.tools[0].input_schema.type === 'object', 'Chat→Anth: tool input_schema');
  assert(r.tool_choice.type === 'auto', 'Chat→Anth: tool_choice auto');
  assert(r.metadata.session === 'abc', 'Chat→Anth: metadata');
}

// ---- 1b. Anthropic → OpenAI Chat ----

{
  const body = {
    model: 'claude-sonnet-4-20250514',
    messages: [
      { role: 'user', content: 'Hi!' }
    ],
    system: 'You are helpful.',
    max_tokens: 200,
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    stop_sequences: ['\n'],
    stream: true,
    tools: [{
      name: 'get_weather',
      description: 'Get weather',
      input_schema: { type: 'object' }
    }],
    tool_choice: { type: 'auto' },
    metadata: { session: 'abc' }
  };
  const r = translateRequest(body, 'anthropic', 'openai_completions', { default: 'gpt-4o' });
  assert(r.model === 'gpt-4o', 'Anth→Chat: model mapped via default');
  assert(r.messages.length === 2, 'Anth→Chat: system prepended');
  assert(r.messages[0].role === 'system', 'Anth→Chat: first message system');
  assert(r.messages[0].content === 'You are helpful.', 'Anth→Chat: system content');
  assert(r.messages[1].role === 'user', 'Anth→Chat: second message user');
  assert(r.max_tokens === 200, 'Anth→Chat: max_tokens');
  assert(r.temperature === 0.7, 'Anth→Chat: temperature');
  assert(r.top_p === 0.9, 'Anth→Chat: top_p');
  assert(r.top_k === 40, 'Anth→Chat: top_k');  // 透传
  assert(r.stop[0] === '\n', 'Anth→Chat: stop_sequences→stop');
  assert(r.stream === true, 'Anth→Chat: stream');
  assert(r.tools[0].function.name === 'get_weather', 'Anth→Chat: tool function name');
  assert(r.tools[0].function.parameters.type === 'object', 'Anth→Chat: tool parameters');
  assert(r.tool_choice === 'auto', 'Anth→Chat: tool_choice→auto');
  assert(r.metadata.session === 'abc', 'Anth→Chat: metadata');
}

// ---- 1c. OpenAI Chat → OpenAI Responses ----

{
  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hi!' }
    ],
    temperature: 0.7,
    max_tokens: 200,
    stream: true,
    store: true,
    metadata: { session: 'abc' }
  };
  const r = translateRequest(body, 'openai_completions', 'openai_responses', {});
  assert(r.model === 'gpt-4o', 'Chat→Resp: model');
  assert(r.instructions === 'Be helpful.', 'Chat→Resp: instructions from system');
  assert(r.input.length === 1, 'Chat→Resp: system removed from input');
  assert(r.input[0].role === 'user', 'Chat→Resp: input[0].role');
  assert(r.input[0].content[0].type === 'input_text', 'Chat→Resp: content type');
  assert(r.input[0].content[0].text === 'Hi!', 'Chat→Resp: content text');
  assert(r.max_output_tokens === 200, 'Chat→Resp: max_output_tokens');
  assert(r.temperature === 0.7, 'Chat→Resp: temperature');
  assert(r.store === true, 'Chat→Resp: store');
  assert(r.metadata.session === 'abc', 'Chat→Resp: metadata');
  assert(r.stream === true, 'Chat→Resp: stream');
}

// ---- 1d. OpenAI Responses → OpenAI Chat ----

{
  const body = {
    model: 'gpt-4o',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'Hi!' }] }
    ],
    instructions: 'Be helpful.',
    max_output_tokens: 200,
    temperature: 0.7,
    metadata: { session: 'abc' },
    stream: true
  };
  const r = translateRequest(body, 'openai_responses', 'openai_completions', {});
  assert(r.model === 'gpt-4o', 'Resp→Chat: model');
  assert(r.messages.length === 2, 'Resp→Chat: instructions→system');
  assert(r.messages[0].role === 'system', 'Resp→Chat: first system');
  assert(r.messages[0].content === 'Be helpful.', 'Resp→Chat: system content');
  assert(r.messages[1].content[0].text === 'Hi!', 'Resp→Chat: user content');
  assert(r.max_tokens === 200, 'Resp→Chat: max_tokens');
  assert(r.temperature === 0.7, 'Resp→Chat: temperature');
  assert(r.metadata.session === 'abc', 'Resp→Chat: metadata');
}

// ---- 1e. 模型名映射 ----

{
  const r = translateRequest({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }, 'openai_completions', 'anthropic', { 'gpt-4o': 'claude-sonnet-4-20250514', default: 'claude-haiku' });
  assert(r.model === 'claude-sonnet-4-20250514', 'model mapping exact');

  const r2 = translateRequest({ model: 'unknown', messages: [{ role: 'user', content: 'hi' }] }, 'openai_completions', 'anthropic', { 'gpt-4o': 'claude-sonnet-4', default: 'claude-haiku' });
  assert(r2.model === 'claude-haiku', 'model mapping default');

  const r3 = translateRequest({ model: 'unknown', messages: [{ role: 'user', content: 'hi' }] }, 'openai_completions', 'anthropic', {});
  assert(r3.model === 'unknown', 'model mapping passthrough');
}

// ---- 1f. 多模态图片转换 ----

{
  const body = {
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAA=',
            detail: 'auto' } }
      ]
    }]
  };
  const r = translateRequest(body, 'openai_completions', 'anthropic', {});
  assert(r.messages[0].content[0].type === 'text', 'multimodal: text preserved');
  assert(r.messages[0].content[1].type === 'image', 'multimodal: image_url→image');
  assert(r.messages[0].content[1].source.type === 'base64', 'multimodal: source type');
  assert(r.messages[0].content[1].source.media_type === 'image/png', 'multimodal: media_type');
  assert(r.messages[0].content[1].source.data === 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAA=', 'multimodal: data');

  // 反向
  const r2 = translateRequest(r, 'anthropic', 'openai_completions', {});
  assert(r2.messages[0].content[1].type === 'image_url', 'reverse: image→image_url');
  assert(r2.messages[0].content[1].image_url.url.startsWith('data:'), 'reverse: data URI');
}

// ---- 1g. Chain translators（全字段验证） ----

// Anthropic → OpenAI Responses (chain: Anth → Chat → Resp)
{
  const body = {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'Hi!' }],
    system: 'Be helpful.',
    max_tokens: 200,
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    stop_sequences: ['\n'],
    stream: true
  };
  const r = translateRequest(body, 'anthropic', 'openai_responses', { default: 'gpt-4o' });
  assert(r.model === 'gpt-4o', 'Anth→Resp chain: model mapped');
  assert(r.instructions === 'Be helpful.', 'Anth→Resp chain: system→instructions');
  assert(r.input[0].role === 'user', 'Anth→Resp chain: input role');
  assert(r.input[0].content[0].type === 'input_text', 'Anth→Resp chain: input_text');
  assert(r.input[0].content[0].text === 'Hi!', 'Anth→Resp chain: content text');
  assert(r.max_output_tokens === 200, 'Anth→Resp chain: max_output_tokens');
  assert(r.temperature === 0.7, 'Anth→Resp chain: temperature');
  assert(r.top_p === 0.9, 'Anth→Resp chain: top_p');
  assert(r.stream === true, 'Anth→Resp chain: stream');
}

// OpenAI Responses → Anthropic (chain: Resp → Chat → Anth)
{
  const body = {
    model: 'gpt-4o',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi!' }] }],
    instructions: 'Be helpful.',
    max_output_tokens: 200,
    temperature: 0.7,
    top_p: 0.9,
    stream: true,
    metadata: { session: 'abc' }
  };
  const r = translateRequest(body, 'openai_responses', 'anthropic', { default: 'claude-sonnet-4' });
  assert(r.model === 'claude-sonnet-4', 'Resp→Anth chain: model mapped');
  assert(r.system === 'Be helpful.', 'Resp→Anth chain: instructions→system');
  assert(r.messages.length === 1, 'Resp→Anth chain: single message');
  assert(r.messages[0].role === 'user', 'Resp→Anth chain: user role');
  assert(r.messages[0].content[0].text === 'Hi!', 'Resp→Anth chain: text content');
  assert(r.max_tokens === 200, 'Resp→Anth chain: max_tokens');
  assert(r.temperature === 0.7, 'Resp→Anth chain: temperature');
  assert(r.top_p === 0.9, 'Resp→Anth chain: top_p');
  assert(r.metadata.session === 'abc', 'Resp→Anth chain: metadata passthrough');
  assert(r.stream === true, 'Resp→Anth chain: stream');
}

// Round-trip: OpenAI Chat → Anthropic → OpenAI Chat
{
  const orig = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hi!' }
    ],
    temperature: 0.7,
    max_tokens: 200,
    stop: ['END'],
    stream: true
  };
  const toAnth = translateRequest(orig, 'openai_completions', 'anthropic', {});
  const back = translateRequest(toAnth, 'anthropic', 'openai_completions', {});
  assert(back.messages.length === 2, 'roundtrip: 2 messages');
  assert(back.messages[0].role === 'system', 'roundtrip: system');
  assert(back.messages[0].content === 'Be helpful.', 'roundtrip: system content');
  assert(back.messages[1].role === 'user', 'roundtrip: user');
  assert(back.messages[1].content === 'Hi!', 'roundtrip: user content');
  assert(back.temperature === 0.7, 'roundtrip: temperature');
  assert(back.max_tokens === 200, 'roundtrip: max_tokens');
  assert(back.stop[0] === 'END', 'roundtrip: stop');
  assert(back.stream === true, 'roundtrip: stream');
}

// ---- 1h. 工具调用请求翻译 ----
// 注：以下用例使用 OpenAI response 中的 tool_calls → Anthropic tool_use
// 然后在下一轮请求中 Anthropic tool_use/tool_result → OpenAI tool_calls/tool role

{
  // 多轮工具对话: OpenAI Chat → Anthropic
  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: '天气如何？' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'Sunny 72°F' }
    ],
    tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } } }],
    tool_choice: 'auto'
  };
  const r = translateRequest(body, 'openai_completions', 'anthropic', { default: 'claude-sonnet-4' });
  assert(r.model === 'claude-sonnet-4', 'tool chat→Anth: model');
  assert(r.messages.length === 3, 'tool chat→Anth: 3 messages');
  assert(r.messages[0].role === 'user', 'tool chat→Anth: msg[0] user');
  assert(r.messages[1].role === 'assistant', 'tool chat→Anth: msg[1] assistant');
  assert(Array.isArray(r.messages[1].content), 'tool chat→Anth: msg[1] content array');
  assert(r.messages[1].content[0].type === 'tool_use', 'tool chat→Anth: tool_use type');
  assert(r.messages[1].content[0].name === 'get_weather', 'tool chat→Anth: tool_use name');
  assert(r.messages[1].content[0].input.city === 'Paris', 'tool chat→Anth: tool_use input');
  assert(r.messages[2].role === 'user', 'tool chat→Anth: msg[2] user');
  assert(r.messages[2].content[0].type === 'tool_result', 'tool chat→Anth: tool_result type');
  assert(r.messages[2].content[0].tool_use_id === 'call_1', 'tool chat→Anth: tool_use_id');
  assert(r.messages[2].content[0].content === 'Sunny 72°F', 'tool chat→Anth: tool_result content');
}

{
  // 多轮工具对话回环: Anthropic → OpenAI Chat
  const body = {
    model: 'claude-sonnet-4',
    messages: [
      { role: 'user', content: '天气如何？' },
      { role: 'assistant', content: [{ type: 'text', text: '我来查' }, { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Sunny 72°F' }] }
    ],
    tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' } }],
    tool_choice: { type: 'auto' }
  };
  const r = translateRequest(body, 'anthropic', 'openai_completions', { default: 'gpt-4o' });
  assert(r.model === 'gpt-4o', 'tool anth→Chat: model');
  assert(r.messages.length === 3, 'tool anth→Chat: 3 messages (assistant merged)');
  assert(r.messages[0].role === 'user', 'tool anth→Chat: msg[0] user');
  assert(r.messages[1].role === 'assistant', 'tool anth→Chat: msg[1] assistant');
  assert(r.messages[1].content === '我来查', 'tool anth→Chat: assistant text');
  assert(r.messages[1].tool_calls.length === 1, 'tool anth→Chat: tool_calls');
  assert(r.messages[1].tool_calls[0].function.name === 'get_weather', 'tool anth→Chat: tc name');
  assert(r.messages[1].tool_calls[0].function.arguments === '{"city":"Paris"}', 'tool anth→Chat: tc args');
  assert(r.messages[2].role === 'tool', 'tool anth→Chat: msg[2] tool');
  assert(r.messages[2].tool_call_id === 'toolu_1', 'tool anth→Chat: tool_call_id');
  assert(r.messages[2].content === 'Sunny 72°F', 'tool anth→Chat: tool content');
}

// ================================================================
// 2. 响应翻译
// ================================================================

// ---- 2a. Anthropic → OpenAI Chat ----

{
  const res = {
    id: 'msg_abc123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello!' }],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 }
  };
  const r = translateResponse(res, 'anthropic', 'openai_completions', 'gpt-4o');
  assert(r.id === res.id, 'AnthRes→Chat: id preserved');
  assert(r.object === 'chat.completion', 'AnthRes→Chat: object type');
  assert(typeof r.created === 'number', 'AnthRes→Chat: created is number');
  assert(r.model === 'gpt-4o', 'AnthRes→Chat: model name');
  assert(r.choices.length === 1, 'AnthRes→Chat: single choice');
  assert(r.choices[0].index === 0, 'AnthRes→Chat: choice index 0');
  assert(r.choices[0].message.role === 'assistant', 'AnthRes→Chat: message role');
  assert(r.choices[0].message.content === 'Hello!', 'AnthRes→Chat: message content');
  assert(r.choices[0].finish_reason === 'stop', 'AnthRes→Chat: end_turn→stop');
  assert(r.usage.prompt_tokens === 10, 'AnthRes→Chat: usage prompt');
  assert(r.usage.completion_tokens === 5, 'AnthRes→Chat: usage completion');
  assert(r.usage.total_tokens === 15, 'AnthRes→Chat: usage total');
}

// ---- 2b. OpenAI Chat → Anthropic ----

{
  const res = {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: 1741570283,
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
  const r = translateResponse(res, 'openai_completions', 'anthropic', 'claude-sonnet-4-20250514');
  assert(r.type === 'message', 'ChatRes→Anth: type');
  assert(r.role === 'assistant', 'ChatRes→Anth: role');
  assert(r.content[0].type === 'text', 'ChatRes→Anth: content type');
  assert(r.content[0].text === 'Hello!', 'ChatRes→Anth: content text');
  assert(r.model === 'claude-sonnet-4-20250514', 'ChatRes→Anth: model');
  assert(r.stop_reason === 'end_turn', 'ChatRes→Anth: stop→end_turn');
  assert(r.usage.input_tokens === 10, 'ChatRes→Anth: input tokens');
  assert(r.usage.output_tokens === 5, 'ChatRes→Anth: output tokens');
}

// ---- 2c. OpenAI Chat → OpenAI Responses ----

{
  const res = {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
  const r = translateResponse(res, 'openai_completions', 'openai_responses', 'gpt-4o');
  assert(r.object === 'response', 'ChatRes→Resp: object');
  assert(r.status === 'completed', 'ChatRes→Resp: status');
  assert(r.model === 'gpt-4o', 'ChatRes→Resp: model');
  assert(r.output.length === 1, 'ChatRes→Resp: single output');
  assert(r.output[0].type === 'message', 'ChatRes→Resp: output type');
  assert(r.output[0].role === 'assistant', 'ChatRes→Resp: output role');
  assert(r.output[0].content === 'Hello!', 'ChatRes→Resp: output content');
  assert(r.usage.input_tokens === 10, 'ChatRes→Resp: input_tokens');
  assert(r.usage.output_tokens === 5, 'ChatRes→Resp: output_tokens');
}

// ---- 2d. OpenAI Responses → OpenAI Chat ----

{
  const res = {
    id: 'resp_123',
    object: 'response',
    status: 'completed',
    model: 'gpt-4o',
    output: [{
      type: 'message',
      id: 'msg_123',
      role: 'assistant',
      content: 'Hello!',
      index: 0
    }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
  };
  const r = translateResponse(res, 'openai_responses', 'openai_completions', 'gpt-4o');
  assert(r.object === 'chat.completion', 'RespRes→Chat: object');
  assert(r.choices[0].message.content === 'Hello!', 'RespRes→Chat: content');
  assert(r.choices[0].finish_reason === 'stop', 'RespRes→Chat: status→stop');
  assert(r.usage.prompt_tokens === 10, 'RespRes→Chat: prompt');
  assert(r.usage.completion_tokens === 5, 'RespRes→Chat: completion');
}

// ---- 2e. 响应链式翻译（全字段验证） ----

// Anthropic → OpenAI Responses (chain: Anth → Chat → Resp)
{
  const res = {
    content: [{ type: 'text', text: 'Hello!' }],
    model: 'claude-sonnet-4',
    stop_reason: 'end_turn',
    usage: { input_tokens: 5, output_tokens: 3 }
  };
  const r = translateResponse(res, 'anthropic', 'openai_responses', 'gpt-4o');
  assert(r.object === 'response', 'Anth→Resp chain: object');
  assert(r.status === 'completed', 'Anth→Resp chain: status');
  assert(r.model === 'gpt-4o', 'Anth→Resp chain: model');
  assert(r.output.length === 1, 'Anth→Resp chain: single output');
  assert(r.output[0].type === 'message', 'Anth→Resp chain: output type');
  assert(r.output[0].role === 'assistant', 'Anth→Resp chain: output role');
  assert(r.output[0].content === 'Hello!', 'Anth→Resp chain: content');
  assert(r.usage.input_tokens === 5, 'Anth→Resp chain: input_tokens');
  assert(r.usage.output_tokens === 3, 'Anth→Resp chain: output_tokens');
}

// OpenAI Responses → Anthropic (chain: Resp → Chat → Anth)
{
  const res = {
    id: 'resp_123',
    object: 'response',
    status: 'completed',
    model: 'gpt-4o',
    output: [{
      type: 'message',
      id: 'msg_123',
      role: 'assistant',
      content: 'Hello!',
      index: 0
    }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
  };
  const r = translateResponse(res, 'openai_responses', 'anthropic', 'claude-sonnet-4');
  assert(r.type === 'message', 'Resp→Anth chain: type');
  assert(r.role === 'assistant', 'Resp→Anth chain: role');
  assert(r.content[0].type === 'text', 'Resp→Anth chain: content type');
  assert(r.content[0].text === 'Hello!', 'Resp→Anth chain: content text');
  assert(r.model === 'claude-sonnet-4', 'Resp→Anth chain: model');
  assert(r.stop_reason === 'end_turn', 'Resp→Anth chain: stop→end_turn');
  assert(r.usage.input_tokens === 10, 'Resp→Anth chain: input_tokens');
  assert(r.usage.output_tokens === 5, 'Resp→Anth chain: output_tokens');
}

// Round-trip: OpenAI Chat → Anthropic → OpenAI Chat
{
  const orig = {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
  const toAnth = translateResponse(orig, 'openai_completions', 'anthropic', 'claude-sonnet-4');
  const back = translateResponse(toAnth, 'anthropic', 'openai_completions', 'gpt-4o');
  assert(back.choices[0].message.content === 'Hello!', 'resp roundtrip: content');
  assert(back.choices[0].finish_reason === 'stop', 'resp roundtrip: finish_reason');
  assert(back.usage.prompt_tokens === 10, 'resp roundtrip: prompt_tokens');
  assert(back.usage.completion_tokens === 5, 'resp roundtrip: completion_tokens');
}

// ---- 2f. 工具调用响应翻译 ----

{
  // OpenAI Chat → Anthropic (with tool_calls)
  const openaiRes = {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_abc',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' }
        }]
      },
      finish_reason: 'tool_calls'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
  const r = translateResponse(openaiRes, 'openai_completions', 'anthropic', 'claude-sonnet-4');
  assert(r.content.length === 1, 'tool_calls→Anth: content length');
  assert(r.content[0].type === 'tool_use', 'tool_calls→Anth: content type');
  assert(r.content[0].id === 'call_abc', 'tool_calls→Anth: id');
  assert(r.content[0].name === 'get_weather', 'tool_calls→Anth: name');
  assert(r.content[0].input.city === 'Paris', 'tool_calls→Anth: input parsed');
  assert(r.stop_reason === 'tool_use', 'tool_calls→Anth: stop_reason');
}

{
  // Anthropic → OpenAI Chat (with tool_use + text)
  const anthRes = {
    id: 'msg_abc',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: 'I will check...' },
      { type: 'tool_use', id: 'toolu_def', name: 'get_weather', input: { city: 'Paris' } }
    ],
    model: 'claude-sonnet-4',
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 }
  };
  const r2 = translateResponse(anthRes, 'anthropic', 'openai_completions', 'gpt-4o');
  assert(r2.choices[0].message.content === 'I will check...', 'tool_use→Chat: text preserved');
  assert(r2.choices[0].message.tool_calls.length === 1, 'tool_use→Chat: tool_calls length');
  assert(r2.choices[0].message.tool_calls[0].id === 'toolu_def', 'tool_use→Chat: id');
  assert(r2.choices[0].message.tool_calls[0].function.name === 'get_weather', 'tool_use→Chat: function name');
  assert(r2.choices[0].message.tool_calls[0].function.arguments === '{"city":"Paris"}', 'tool_use→Chat: arguments');
  assert(r2.choices[0].finish_reason === 'tool_calls', 'tool_use→Chat: finish_reason');
}

{
  // Anthropic → OpenAI Chat (tool_use only, no text)
  const anthRes2 = {
    content: [{ type: 'tool_use', id: 'toolu_xyz', name: 'get_weather', input: { city: 'London' } }],
    model: 'claude-sonnet-4',
    stop_reason: 'tool_use',
    usage: {}
  };
  const r3 = translateResponse(anthRes2, 'anthropic', 'openai_completions', 'gpt-4o');
  assert(r3.choices[0].message.content === null, 'tool_use only→Chat: content null');
  assert(r3.choices[0].message.tool_calls.length === 1, 'tool_use only→Chat: tool_calls');
  assert(r3.choices[0].message.tool_calls[0].function.name === 'get_weather', 'tool_use only→Chat: name');
  assert(r3.choices[0].finish_reason === 'tool_calls', 'tool_use only→Chat: finish_reason');
}

{
  // OpenAI Chat → Anthropic (tool_calls only, content null)
  const openaiRes2 = {
    choices: [{
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_xyz', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] },
      finish_reason: 'tool_calls'
    }],
    usage: {}
  };
  const r4 = translateResponse(openaiRes2, 'openai_completions', 'anthropic', 'claude-3');
  assert(r4.content.length === 1, 'tool_calls only→Anth: content length');
  assert(r4.content[0].type === 'tool_use', 'tool_calls only→Anth: type tool_use');
  assert(r4.content[0].name === 'get_weather', 'tool_calls only→Anth: name');
  assert(r4.stop_reason === 'tool_use', 'tool_calls only→Anth: stop_reason');
}

// ---- 2g. finish_reason 映射全覆盖 ----

{
  // Anthropic stop_reason: end_turn → stop, max_tokens → length, stop_sequence → stop
  const tests = [
    { in: 'end_turn', expect: 'stop' },
    { in: 'max_tokens', expect: 'length' },
    { in: 'stop_sequence', expect: 'stop' },
    { in: undefined, expect: 'stop' }
  ];
  for (const t of tests) {
    const res = { content: [{ type: 'text', text: 'x' }], model: 'c', stop_reason: t.in, usage: {} };
    const r = translateResponse(res, 'anthropic', 'openai_completions', 'g');
    assert(r.choices[0].finish_reason === t.expect, `finish_reason: ${t.in}→${t.expect}`);
  }
}

// ================================================================
// 3. 流式翻译
// ================================================================

// ---- 3a. Anthropic → OpenAI SSE ----

{
  const st = getStreamTranslator('anthropic', 'openai_completions');
  assert(st.available === true, 'Anthropic→OpenAI stream available');
  const state = {};

  // message_start
  const e1 = { type: 'message_start', message: { model: 'claude-3' } };
  const out1 = st.translate(e1, state);
  assert(typeof out1 === 'string', 'message_start: output string');
  const p1 = JSON.parse(out1);
  assert(p1.object === 'chat.completion.chunk', 'message_start: chunk type');
  assert(p1.choices[0].delta.role === 'assistant', 'message_start: delta role');

  // content_block_delta
  const e2 = { type: 'content_block_delta', delta: { text: 'Hello' } };
  const out2 = st.translate(e2, state);
  const p2 = JSON.parse(out2);
  assert(p2.choices[0].delta.content === 'Hello', 'content_delta: delta content');

  // message_delta
  const e3 = { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  const out3 = st.translate(e3, state);
  const p3 = JSON.parse(out3);
  assert(p3.choices[0].finish_reason === 'stop', 'message_delta: finish_reason');

  // message_stop
  const e4 = { type: 'message_stop' };
  const out4 = st.translate(e4, state);
  assert(out4 === '[DONE]', 'message_stop: [DONE]');
}

// ---- 3b. OpenAI SSE → Anthropic ----

{
  const st = getStreamTranslator('openai_completions', 'anthropic');
  assert(st.available === true, 'OpenAI→Anthropic stream available');
  const state = {};

  // 首块: delta.role + delta.content 合并发出
  const e1 = { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] };
  const out1 = st.translate(e1, state);
  assert(Array.isArray(out1), 'first chunk: array');
  assert(out1.length === 3, 'first chunk: msg_start + content_block_start + content_delta');
  assert(out1[0].event === 'message_start', 'first chunk: event message_start');
  assert(out1[1].event === 'content_block_start', 'first chunk: event content_block_start');
  assert(out1[2].event === 'content_block_delta', 'first chunk: event content_block_delta');
  assert(out1[2].data.delta.text === 'Hello', 'first chunk: delta text');

  // 内容块: delta.content
  const e2 = { choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }] };
  const out2 = st.translate(e2, state);
  assert(out2.length === 1, 'content chunk: single event');
  assert(out2[0].event === 'content_block_delta', 'content chunk: event type');
  assert(out2[0].data.delta.text === ' world', 'content chunk: delta text');

  // 结束块: finish_reason
  const e3 = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  const out3 = st.translate(e3, state);
  assert(out3.length === 3, 'finish chunk: 3 events');
  assert(out3[0].event === 'content_block_stop', 'finish: content_block_stop');
  assert(out3[1].event === 'message_delta', 'finish: message_delta');
  assert(out3[1].data.delta.stop_reason === 'end_turn', 'finish: stop→end_turn');
  assert(out3[2].event === 'message_stop', 'finish: message_stop');
}

// ---- 3c. Anthropic → OpenAI Responses stream ----

{
  const st = getStreamTranslator('anthropic', 'openai_responses');
  assert(st.available === true, 'Anth→Resp stream available');
  const state = {};

  const e1 = { type: 'message_start', message: { model: 'claude-3' } };
  const out1 = st.translate(e1, state);
  assert(out1.type === 'response.output_message.added', 'message_start event type');

  const e2 = { type: 'content_block_delta', delta: { text: 'Hi' } };
  const out2 = st.translate(e2, state);
  assert(out2.type === 'response.output_text.delta', 'delta event type');
  assert(out2.data.delta === 'Hi', 'delta text');

  const e3 = { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  const out3 = st.translate(e3, state);
  assert(out3.type === 'response.completed', 'completed event type');
}

// ---- 3d. SSE 格式化输出 ----

{
  const st = getStreamTranslator('anthropic', 'openai_completions');
  // 正常数据
  const formatted = st.format(JSON.stringify({ id: 'x', choices: [{ delta: { content: 'Hi' } }] }));
  assert(formatted.startsWith('data: '), 'SSE format: data: prefix');
  assert(formatted.endsWith('\n\n'), 'SSE format: double newline');
  // [DONE]
  const done = st.format('[DONE]');
  assert(done === 'data: [DONE]\n\n', 'SSE format: [DONE]');
}

// ---- 3e. 流式工具调用翻译 ----

{
  // OpenAI → Anthropic: tool_calls stream
  const st = getStreamTranslator('openai_completions', 'anthropic');
  const state = {};

  // Chunk 1: role only
  const c1 = { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] };
  const out1 = st.translate(c1, state);
  assert(Array.isArray(out1), 'tool stream: array');
  assert(out1.length === 1, 'tool stream: only message_start');
  assert(out1[0].event === 'message_start', 'tool stream: first event message_start');

  // Chunk 2: tool_call id + name
  const c2 = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] }, finish_reason: null }] };
  const out2 = st.translate(c2, state);
  assert(out2.length === 1, 'tool stream: tool_call start');
  assert(out2[0].event === 'content_block_start', 'tool stream: content_block_start');
  assert(out2[0].data.content_block.type === 'tool_use', 'tool stream: tool_use type');
  assert(out2[0].data.content_block.id === 'call_1', 'tool stream: tool_use id');
  assert(out2[0].data.content_block.name === 'get_weather', 'tool stream: tool_use name');

  // Chunk 3: tool_call arguments delta
  const c3 = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }, finish_reason: null }] };
  const out3 = st.translate(c3, state);
  assert(out3.length === 1, 'tool stream: args delta');
  assert(out3[0].event === 'content_block_delta', 'tool stream: delta event');
  assert(out3[0].data.delta.type === 'input_json_delta', 'tool stream: input_json_delta');
  assert(out3[0].data.delta.partial_json === '{"city":', 'tool stream: partial json');

  // Chunk 4: finish
  const c4 = { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  const out4 = st.translate(c4, state);
  assert(out4.length === 3, 'tool stream: finish 3 events');
  assert(out4[0].event === 'content_block_stop', 'tool stream: stop event');
  assert(out4[0].data.index === 1, 'tool stream: tool_use index');
  assert(out4[1].event === 'message_delta', 'tool stream: message_delta');
  assert(out4[1].data.delta.stop_reason === 'tool_use', 'tool stream: stop_reason tool_use');
  assert(out4[2].event === 'message_stop', 'tool stream: message_stop');
}

{
  // Anthropic → OpenAI: tool_use stream (input_json_delta)
  const st = getStreamTranslator('anthropic', 'openai_completions');
  const state = {};

  // message_start
  const e1 = st.translate({ type: 'message_start', message: { model: 'claude-3' } }, state);
  const p1 = JSON.parse(e1);
  assert(p1.choices[0].delta.role === 'assistant', 'anth tool stream: role');

  // content_block_start for tool_use
  const e2 = st.translate({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_abc', name: 'get_weather' } }, state);
  assert(e2 !== null, 'anth tool stream: content_block_start not null');

  // content_block_delta with input_json_delta
  const e3 = st.translate({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":' } }, state);
  const p3 = JSON.parse(e3);
  assert(p3.choices[0].delta.tool_calls[0].function.arguments === '{"city":', 'anth tool stream: args delta');

  // message_delta with tool_use
  const e4 = st.translate({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }, state);
  const p4 = JSON.parse(e4);
  assert(p4.choices[0].finish_reason === 'tool_calls', 'anth tool stream: finish_reason');

  // message_stop
  const e5 = st.translate({ type: 'message_stop' }, state);
  assert(e5 === '[DONE]', 'anth tool stream: done');
}

// ---- 3f. parseSSE ----

{
  const p1 = parseSSE('data: {"key":"val"}');
  assert(p1.type === 'data', 'parseSSE: data type');
  assert(p1.data.key === 'val', 'parseSSE: data parsed');

  const p2 = parseSSE('data: [DONE]');
  assert(p2.type === 'done', 'parseSSE: done');

  const p3 = parseSSE('event: message_start');
  assert(p3.type === 'event', 'parseSSE: event type');
  assert(p3.event === 'message_start', 'parseSSE: event name');

  const p4 = parseSSE('not a sse line');
  assert(p4 === null, 'parseSSE: invalid null');
}

// ================================================================
// 4. 错误翻译
// ================================================================

{
  // OpenAI error → Anthropic
  const e1 = translateAndFormatError(
    { error: { message: 'Rate limit', type: 'rate_limit_error', code: 429 } },
    429, 'openai_completions', 'anthropic'
  );
  assert(e1.type === 'error', 'error->Anth: type');
  assert(e1.error.message === 'Rate limit', 'error->Anth: message');
  assert(e1.error.type === 'rate_limit_error', 'error->Anth: type');

  // Anthropic error → OpenAI
  const e2 = translateAndFormatError(
    { type: 'error', error: { type: 'rate_limit_error', message: 'Too fast' } },
    429, 'anthropic', 'openai_completions'
  );
  assert(e2.error.message === 'Too fast', 'error->Chat: message');
  assert(e2.error.code === 429, 'error->Chat: code');

  // Anthropic error → OpenAI Responses
  const e3 = translateAndFormatError(
    { type: 'error', error: { type: 'invalid_request', message: 'Bad req' } },
    400, 'anthropic', 'openai_responses'
  );
  assert(e3.error.message === 'Bad req', 'error->Resp: message');
  assert(e3.error.code === 400, 'error->Resp: code');

  // Unknown → fallback
  const e4 = translateAndFormatError(
    { message: 'Unknown' }, 500, 'unknown', 'openai_completions'
  );
  assert(e4.error.message === 'Unknown', 'error unknown: message fallback');
}

// ================================================================
// 5. data URI 工具
// ================================================================

{
  const uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAA=';
  const parsed = parseDataURI(uri);
  assert(parsed !== null, 'parseDataURI: valid');
  assert(parsed.media_type === 'image/png', 'parseDataURI: media_type');
  assert(parsed.format === 'png', 'parseDataURI: format');
  assert(parsed.data === 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAA=', 'parseDataURI: data');

  const built = buildDataURI('image/png', 'iVBORw0KGgo');
  assert(built === 'data:image/png;base64,iVBORw0KGgo', 'buildDataURI');

  const invalid = parseDataURI('not-a-data-uri');
  assert(invalid === null, 'parseDataURI: invalid null');
}

// ================================================================
// 6. 透传（相同格式）
// ================================================================

{
  const body = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
  const r = translateRequest(body, 'openai_completions', 'openai_completions', {});
  assert(r === body, 'passthrough: returns same ref');

  const st = getStreamTranslator('openai_completions', 'openai_completions');
  assert(st === null, 'passthrough stream: null');
}

// ================================================================
// 7. 强制关闭思考 (stripThinkingParams + forceDisableThinking + stripStreamThinking)
// ================================================================

{
  // ---- 7a. stripThinkingParams（翻译前剥离下游原文） ----

  // Anthropic: 删除 thinking 字段
  const body1 = { model: 'claude-3', messages: [], thinking: { type: 'enabled', budget_tokens: 1024 } };
  stripThinkingParams(body1, 'anthropic');
  assert(body1.thinking === undefined, 'stripThinking: Anthropic thinking removed');

  // Anthropic: 无 thinking 字段时不受影响
  const body2 = { model: 'claude-3', messages: [] };
  stripThinkingParams(body2, 'anthropic');
  assert(Object.keys(body2).length === 2, 'stripThinking: Anthropic no thinking unchanged');

  // OpenAI Completions: 删除 reasoning_effort
  const body3 = { model: 'gpt-4o', messages: [], reasoning_effort: 'high' };
  stripThinkingParams(body3, 'openai_completions');
  assert(body3.reasoning_effort === undefined, 'stripThinking: OpenAI reasoning_effort removed');

  // null body: 不抛异常
  assert(stripThinkingParams(null, 'anthropic') === null, 'stripThinking: null body returns null');

  // ---- 7b. forceDisableThinking（翻译后强制上游关闭思考） ----

  // DeepSeek: openai_completions 格式 → 设置 thinking: {type: "disabled"}
  const body_ds = { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] };
  forceDisableThinking(body_ds, 'openai_completions');
  assert(body_ds.thinking.type === 'disabled', 'forceDisable: DeepSeek thinking.type=disabled');

  // OpenAI Responses 格式 → 设置 reasoning: {effort: "low"}
  const body_resp = { model: 'o3', input: [] };
  forceDisableThinking(body_resp, 'openai_responses');
  assert(body_resp.reasoning.effort === 'low', 'forceDisable: Responses reasoning.effort=low');

  // Anthropic 格式 → 不做额外处理
  const body_anth = { model: 'claude-3', messages: [] };
  forceDisableThinking(body_anth, 'anthropic');
  assert(body_anth.thinking === undefined, 'forceDisable: Anthropic no change');

  // null body
  assert(forceDisableThinking(null, 'openai_completions') === null, 'forceDisable: null');

  // 完整链路: Anthropic 原文带 thinking → strip → 翻译 → force disable
  const body_chain = {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'hi' }],
    thinking: { type: 'enabled', budget_tokens: 1024 }
  };
  stripThinkingParams(body_chain, 'anthropic');
  assert(body_chain.thinking === undefined, 'chain: original thinking stripped');

  const translated = translateRequest(body_chain, 'anthropic', 'openai_completions', {});
  assert(translated.thinking === undefined, 'chain: translated has no thinking (translator does not carry it)');

  forceDisableThinking(translated, 'openai_completions');
  assert(translated.thinking.type === 'disabled', 'chain: force disabled after translation');
  assert(translated.model === 'claude-sonnet-4-20250514', 'chain: model preserved');
  assert(translated.messages.length === 1, 'chain: messages preserved');

  // ---- 7c. stripStreamThinking（流式响应中剥离 reasoning_content） ----

  // OpenAI 流式: 剥离 reasoning_content
  const event1 = { choices: [{ delta: { content: 'hello', reasoning_content: 'thinking...' } }] };
  stripStreamThinking(event1, 'openai_completions');
  assert(event1.choices[0].delta.content === 'hello', 'stripStream: content preserved');
  assert(event1.choices[0].delta.reasoning_content === undefined, 'stripStream: reasoning_content removed');

  // 空 delta
  const event2 = { choices: [{ delta: { content: 'hello' } }] };
  stripStreamThinking(event2, 'openai_completions');
  assert(event2.choices[0].delta.content === 'hello', 'stripStream: no reasoning no change');

  // 无 choices
  const event3 = {};
  stripStreamThinking(event3, 'openai_completions');
  assert(Object.keys(event3).length === 0, 'stripStream: empty event');

  // null
  assert(stripStreamThinking(null, 'openai_completions') === null, 'stripStream: null');
}

// ================================================================
// 8. 不支持的方向
// ================================================================

{
  try {
    translateRequest({ model: 'x', messages: [] }, 'openai_completions', 'nonexistent', {});
    assert(false, 'unsupported direction: should throw');
  } catch (e) {
    assert(e.message.includes('不支持的请求翻译方向'), 'unsupported direction: error msg');
  }
}

// ================================================================
// 结果
// ================================================================

console.log(`\n${pass} passed, ${fail} failed${fail > 0 ? ' ❌' : ' ✅'}`);
process.exit(fail > 0 ? 1 : 0);
