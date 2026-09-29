/*
 * CSB Reply Assistant: default settings and provider info.
 *
 * Plain script (no modules) so it can be loaded by the service worker
 * (importScripts), the popup (<script>) and the mock test page (file://).
 * Everything is attached to globalThis.CSB.
 */
(function (root) {
  'use strict';

  const CSB = (root.CSB = root.CSB || {});

  CSB.PROVIDERS = {
    anthropic: {
      id: 'anthropic',
      label: 'Anthropic (Claude)',
      // Change it in settings any time. Check current IDs at the link below.
      defaultModel: 'claude-sonnet-5-5',
      modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
      keysUrl: 'https://console.anthropic.com/settings/keys',
      keyHint: 'Starts with sk-ant-',
    },
    gemini: {
      id: 'gemini',
      label: 'Google (Gemini)',
      defaultModel: 'gemini-3.5-flash',
      modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
      keysUrl: 'https://aistudio.google.com/app/apikey',
      keyHint: 'Usually starts with AIza',
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      defaultModel: 'gpt-5.4-mini',
      modelsUrl: 'https://platform.openai.com/docs/models',
      keysUrl: 'https://platform.openai.com/api-keys',
      keyHint: 'Starts with sk-',
    },
  };

  CSB.CATEGORIES = ['lead', 'question', 'compliment', 'hiring', 'collab', 'disagreement', 'spam', 'other'];

  CSB.DEFAULT_VOICE_PROFILE =
    "I'm Shahran Ahmed, Co-Founder and Creative Director of Create Something Beyond (CSB), " +
    'an AI-native creative studio making AI films, brand content, websites and branding for brands worldwide. ' +
    'I care about directorial craft and taste over tools. ' +
    "I'm friendly, direct and a little playful.";

  CSB.DEFAULT_SETTINGS = {
    provider: 'anthropic',
    // API keys, one per provider. Stored only in chrome.storage.local.
    keys: { anthropic: '', gemini: '', openai: '' },
    models: {
      anthropic: CSB.PROVIDERS.anthropic.defaultModel,
      gemini: CSB.PROVIDERS.gemini.defaultModel,
      openai: CSB.PROVIDERS.openai.defaultModel,
    },
    voiceProfile: CSB.DEFAULT_VOICE_PROFILE,
    tone: 'friendly', // friendly | professional | witty
    length: 'short', // short | medium
    emojis: true,
    bannedPhrases: ['Great post', 'Thanks for sharing', 'Absolutely!', 'delve'].join('\n'),
    profileName: 'Shahran Ahmed',
    onlyMyPosts: true,
    debug: false,
  };

  /** Merge stored settings over the defaults (deep enough for keys/models). */
  CSB.mergeSettings = function mergeSettings(stored) {
    const d = CSB.DEFAULT_SETTINGS;
    const s = stored || {};
    return {
      ...d,
      ...s,
      keys: { ...d.keys, ...(s.keys || {}) },
      models: { ...d.models, ...(s.models || {}) },
    };
  };

  /** Settings that are safe to hand to the content script (no API keys). */
  CSB.publicSettings = function publicSettings(settings) {
    const s = CSB.mergeSettings(settings);
    return {
      provider: s.provider,
      model: s.models[s.provider] || '',
      hasKey: Boolean((s.keys[s.provider] || '').trim()),
      profileName: s.profileName,
      onlyMyPosts: s.onlyMyPosts,
      debug: s.debug,
      bannedPhrases: s.bannedPhrases,
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
