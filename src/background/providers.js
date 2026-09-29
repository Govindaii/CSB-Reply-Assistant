/*
 * CSB Reply Assistant: AI provider calls.
 *
 * One function per provider. They all take the same input and return the
 * same output, so the rest of the extension doesn't care which one is used:
 *
 *   input:  { apiKey, model, system, user, maxTokens, json }
 *   output: { text, finishReason }
 *   errors: throws CSB.ProviderError { kind, status, message, detail }
 *
 * kind is one of: missing_key | auth | model | rate_limit | quota |
 *                 overloaded | network | timeout | empty | bad_request | other
 *
 * Runs ONLY in the background service worker. The API key never leaves
 * this file except in the request header to the provider itself, and it
 * is never logged.
 */
(function (root) {
  'use strict';

  const CSB = (root.CSB = root.CSB || {});
  const TIMEOUT_MS = 60000;

  class ProviderError extends Error {
    constructor(kind, message, { status = 0, detail = '', provider = '' } = {}) {
      super(message);
      this.name = 'ProviderError';
      this.kind = kind;
      this.status = status;
      this.detail = detail;
      this.provider = provider;
    }
  }
  CSB.ProviderError = ProviderError;

  const LABELS = { anthropic: 'Anthropic', gemini: 'Gemini', openai: 'OpenAI' };

  /** Remove the API key from any text before it is shown or returned. */
  function redact(text, apiKey) {
    let out = String(text || '');
    if (apiKey && apiKey.length >= 6) out = out.split(apiKey).join('[your key]');
    return out;
  }

  /** fetch() with a timeout and friendly network errors. */
  async function postJson(provider, url, headers, body, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new ProviderError('timeout', `${LABELS[provider]} took longer than ${TIMEOUT_MS / 1000}s to answer.`, {
          provider,
        });
      }
      throw new ProviderError('network', `Couldn't reach ${LABELS[provider]}. Check your internet connection.`, {
        provider,
        detail: redact(err && err.message, apiKey),
      });
    }
    clearTimeout(timer);

    const rawText = await res.text().catch(() => '');
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      data = null;
    }
    return { res, data, rawText: redact(rawText, apiKey) };
  }

  /** Turn a non-2xx response into a ProviderError with a friendly message. */
  function httpError(provider, model, status, providerMessage, providerCode, apiKey) {
    const name = LABELS[provider];
    const detail = redact(providerMessage || `HTTP ${status}`, apiKey);
    const msg = (detail + ' ' + (providerCode || '')).toLowerCase();
    const opts = { status, detail, provider };

    const looksLikeModel =
      providerCode === 'model_not_found' ||
      providerCode === 'not_found_error' ||
      /model[^.]*(not found|does not exist|not supported|is not available|unknown|invalid)/.test(msg) ||
      /(not found|unknown|invalid)[^.]*model/.test(msg) ||
      (status === 404 && provider !== 'openai') ||
      (status === 404 && /model/.test(msg));

    if (status === 401 || /api key not valid|invalid api key|incorrect api key|invalid x-api-key|api_key_invalid/.test(msg)) {
      return new ProviderError('auth', `${name} rejected the API key. Check it in the extension settings.`, opts);
    }
    if (looksLikeModel) {
      return new ProviderError(
        'model',
        `The model name “${model}” wasn't recognised by ${name}. Check the model name in settings.`,
        opts
      );
    }
    if (status === 403) {
      return new ProviderError(
        'auth',
        `${name} says this key doesn't have permission for that request. Check the key and your account.`,
        opts
      );
    }
    if (status === 429) {
      if (/quota|billing|insufficient|credit/.test(msg)) {
        return new ProviderError(
          'quota',
          `${name} says your quota or credit has run out. Check billing on your ${name} account.`,
          opts
        );
      }
      return new ProviderError('rate_limit', `${name} rate limit reached. Wait a minute and try again.`, opts);
    }
    if (/credit balance|billing/.test(msg)) {
      return new ProviderError('quota', `${name} says your account needs credit. Check billing on your ${name} account.`, opts);
    }
    if (status === 529 || status === 503 || status === 502 || status === 500 || /overloaded/.test(msg)) {
      return new ProviderError('overloaded', `${name} is busy or having issues right now. Try again in a moment.`, opts);
    }
    if (status === 400) {
      return new ProviderError('bad_request', `${name} couldn't process the request.`, opts);
    }
    return new ProviderError('other', `${name} returned an error (HTTP ${status}).`, opts);
  }

  function requireKey(provider, apiKey) {
    if (!apiKey || !String(apiKey).trim()) {
      throw new ProviderError(
        'missing_key',
        `No API key saved for ${LABELS[provider]}. Click the extension icon and paste your key.`,
        { provider }
      );
    }
  }

  function requireModel(provider, model) {
    if (!model || !String(model).trim()) {
      throw new ProviderError('model', `No model name set for ${LABELS[provider]}. Add one in settings.`, { provider });
    }
  }

  // ───────────────────────── Anthropic (Claude) ─────────────────────────

  async function callAnthropic({ apiKey, model, system, user, maxTokens = 1500 }) {
    const provider = 'anthropic';
    requireKey(provider, apiKey);
    requireModel(provider, model);

    const { res, data, rawText } = await postJson(
      provider,
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      {
        model: model.trim(),
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      },
      apiKey
    );

    if (!res.ok) {
      const e = (data && data.error) || {};
      throw httpError(provider, model, res.status, e.message || rawText, e.type, apiKey);
    }

    const text = ((data && data.content) || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return { text, finishReason: (data && data.stop_reason) || '' };
  }

  // ───────────────────────── Google (Gemini) ─────────────────────────

  async function callGemini({ apiKey, model, system, user, maxTokens = 8192, json = false }) {
    const provider = 'gemini';
    requireKey(provider, apiKey);
    requireModel(provider, model);

    const cleanModel = model.trim().replace(/^models\//, '');
    const generationConfig = { maxOutputTokens: maxTokens };
    if (json) generationConfig.responseMimeType = 'application/json';

    const { res, data, rawText } = await postJson(
      provider,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`,
      // Key goes in a header (not the URL) so it never shows up in logs.
      { 'x-goog-api-key': apiKey.trim() },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
      },
      apiKey
    );

    if (!res.ok) {
      const e = (data && data.error) || {};
      const reason = ((e.details || []).find((d) => d && d.reason) || {}).reason || e.status || '';
      throw httpError(provider, model, res.status, e.message || rawText, reason, apiKey);
    }

    const cand = (data && data.candidates && data.candidates[0]) || null;
    const text = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => p && typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    const finishReason = (cand && cand.finishReason) || (data && data.promptFeedback && data.promptFeedback.blockReason) || '';
    return { text, finishReason };
  }

  // ───────────────────────── OpenAI ─────────────────────────

  async function callOpenAI({ apiKey, model, system, user, maxTokens = 4000, json = false }) {
    const provider = 'openai';
    requireKey(provider, apiKey);
    requireModel(provider, model);

    const m = model.trim();
    const body = {
      model: m,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
    };
    if (json) body.response_format = { type: 'json_object' };
    // Reasoning models think before answering; keep that short for quick replies.
    if (/^(gpt-5|o\d)/i.test(m) && !/chat/i.test(m)) body.reasoning_effort = 'low';

    const send = () =>
      postJson(provider, 'https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${apiKey.trim()}` }, body, apiKey);

    let { res, data, rawText } = await send();

    // Some models don't accept optional parameters. Drop them and try once more.
    if (res.status === 400) {
      const msg = String((data && data.error && data.error.message) || '');
      let retry = false;
      for (const param of ['reasoning_effort', 'response_format']) {
        if (param in body && msg.includes(param)) {
          delete body[param];
          retry = true;
        }
      }
      if (retry) ({ res, data, rawText } = await send());
    }

    if (!res.ok) {
      const e = (data && data.error) || {};
      throw httpError(provider, model, res.status, e.message || rawText, e.code || e.type, apiKey);
    }

    const choice = (data && data.choices && data.choices[0]) || {};
    const content = choice.message && choice.message.content;
    const text = (typeof content === 'string' ? content : '').trim();
    return { text, finishReason: choice.finish_reason || '' };
  }

  const CALLS = { anthropic: callAnthropic, gemini: callGemini, openai: callOpenAI };

  /** Call whichever provider is chosen. */
  async function callProvider(provider, input) {
    const fn = CALLS[provider];
    if (!fn) throw new ProviderError('other', `Unknown AI provider “${provider}”.`, { provider });
    return fn(input);
  }

  CSB.providers = { callAnthropic, callGemini, callOpenAI, callProvider, redact, LABELS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
