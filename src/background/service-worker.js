/*
 * CSB Reply Assistant: background service worker.
 *
 * The only place that talks to AI providers. The content script (on
 * LinkedIn) and the popup send it messages; it reads the API key from
 * chrome.storage.local, calls the provider, and sends back the result.
 *
 * It does nothing on its own: no alarms, no background jobs, no tab
 * opening. It only answers messages.
 */
importScripts('../shared/defaults.js', '../shared/prompt.js', 'providers.js');

const CSB = self.CSB;
const STORAGE_KEY = 'csbSettings';

// Keep API keys out of reach of content scripts, where Chrome supports it.
try {
  const p = chrome.storage.local.setAccessLevel && chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (p && p.catch) p.catch(() => {});
} catch (_) {
  /* older Chrome: fine, the content script never reads storage anyway */
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return CSB.mergeSettings(stored[STORAGE_KEY]);
}

/** A long AI call shouldn't let Chrome put the worker to sleep mid-request. */
async function withKeepAlive(promise) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}

/** Convert any error into a plain object safe to send to the page. */
function errorPayload(err, apiKey) {
  const redact = (t) => CSB.providers.redact(t, apiKey);
  if (err && err.name === 'ProviderError') {
    return { kind: err.kind, message: redact(err.message), detail: redact(err.detail), status: err.status };
  }
  if (err && err.kind) return { kind: err.kind, message: redact(err.message), detail: redact(err.detail || '') };
  return { kind: 'other', message: 'Something went wrong.', detail: redact(err && err.message) };
}

function emptyAnswerError(provider, finishReason) {
  const name = CSB.providers.LABELS[provider];
  const reason = String(finishReason || '');
  if (/SAFETY|PROHIBITED|BLOCK|RECITATION|refusal|content_filter/i.test(reason)) {
    return { kind: 'empty', message: `${name} returned no text. Its safety filter may have blocked this comment.`, detail: reason };
  }
  if (/max_tokens|length|MAX_TOKENS/.test(reason)) {
    return { kind: 'empty', message: `${name} ran out of room before writing an answer. Click Regenerate to try again.`, detail: reason };
  }
  return { kind: 'empty', message: `${name} returned an empty answer. Click Regenerate to try again.`, detail: reason };
}

// ───────────────────────── Message handlers ─────────────────────────

const HANDLERS = {
  /** Settings for the content script. Never includes API keys. */
  async 'csb:getPublicSettings'() {
    return { ok: true, settings: CSB.publicSettings(await loadSettings()) };
  },

  /**
   * Tiny API call to check the key + model. The popup may pass the values
   * currently typed in the form so you can test before they're saved.
   */
  async 'csb:testConnection'(msg) {
    const settings = await loadSettings();
    const provider = msg.provider || settings.provider;
    const apiKey = msg.apiKey != null ? msg.apiKey : settings.keys[provider];
    const model = msg.model != null ? msg.model : settings.models[provider];
    const started = Date.now();
    try {
      const out = await withKeepAlive(
        CSB.providers.callProvider(provider, {
          apiKey,
          model,
          system: 'You are a connection test. Answer with one word.',
          user: 'Reply with just: OK',
          maxTokens: 64,
        })
      );
      return {
        ok: true,
        provider,
        model: String(model).trim(),
        ms: Date.now() - started,
        sample: (out.text || '').slice(0, 40),
      };
    } catch (err) {
      return { ok: false, error: errorPayload(err, apiKey) };
    }
  },

  /**
   * Generate reply options for one comment.
   * msg.context = { post, comment, thread } read from the comment you clicked.
   * msg.instruction = optional one-line instruction ("make it funnier").
   * msg.previousReplies = options already shown, so Regenerate gives new ones.
   */
  async 'csb:generate'(msg) {
    const settings = await loadSettings();
    const provider = settings.provider;
    const apiKey = settings.keys[provider];
    const model = settings.models[provider];
    const started = Date.now();
    try {
      const { system, user } = CSB.prompt.buildPrompt({
        settings,
        context: msg.context,
        instruction: msg.instruction,
        previousReplies: msg.previousReplies,
      });
      const out = await withKeepAlive(
        CSB.providers.callProvider(provider, { apiKey, model, system, user, json: true })
      );
      if (!out.text) throw emptyAnswerError(provider, out.finishReason);

      let result;
      try {
        result = CSB.prompt.parseReplyJson(out.text);
      } catch (err) {
        if (/max_tokens|length|MAX_TOKENS/.test(out.finishReason)) {
          err.message = 'The AI ran out of room before finishing its answer. Click Regenerate to try again.';
        }
        throw err;
      }

      const banned = CSB.prompt.bannedList(settings);
      result.warnings = result.replies.map((r) => CSB.prompt.findBannedPhrases(r, banned));
      return { ok: true, result, meta: { provider, model, ms: Date.now() - started } };
    } catch (err) {
      return { ok: false, error: errorPayload(err, apiKey), meta: { provider, model } };
    }
  },

  /** Lets the panel's "Open settings" button open the settings page. */
  async 'csb:openSettings'() {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: errorPayload(err) }));
  return true; // keep the channel open for the async answer
});

// Fill in defaults on first install (keeps anything already saved).
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  await chrome.storage.local.set({ [STORAGE_KEY]: CSB.mergeSettings(stored[STORAGE_KEY]) });
});
