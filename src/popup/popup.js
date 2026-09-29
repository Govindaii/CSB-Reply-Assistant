/*
 * CSB Reply Assistant: settings popup.
 *
 * Everything saves automatically as you type. The API key is kept per
 * provider in chrome.storage.local and never printed anywhere.
 */
(function () {
  'use strict';

  const CSB = globalThis.CSB;
  const STORAGE_KEY = 'csbSettings';
  const $ = (id) => document.getElementById(id);

  let settings = CSB.mergeSettings(null);
  let saveTimer = null;

  // Opened as a full tab (e.g. "Open settings" from the panel)?
  if (location.search.includes('tab') || window.innerWidth > 500) document.body.classList.add('is-tab');

  // ───────────────────────── Load + save ─────────────────────────

  async function load() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    settings = CSB.mergeSettings(stored[STORAGE_KEY]);
    fillForm();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    $('saveStatus').textContent = 'Saving…';
    saveTimer = setTimeout(save, 300);
  }

  async function save() {
    clearTimeout(saveTimer);
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    $('saveStatus').textContent = 'Saved ✓';
    setTimeout(() => {
      if ($('saveStatus').textContent === 'Saved ✓') $('saveStatus').textContent = '';
    }, 1500);
  }

  // Save anything pending if the popup is closed mid-typing.
  window.addEventListener('pagehide', () => {
    if (saveTimer) chrome.storage.local.set({ [STORAGE_KEY]: settings });
  });

  // ───────────────────────── Form ─────────────────────────

  function fillProviderFields() {
    const p = settings.provider;
    const info = CSB.PROVIDERS[p];
    $('apiKey').value = settings.keys[p] || '';
    $('model').value = settings.models[p] || '';
    $('model').placeholder = info.defaultModel;
    $('keyHint').textContent = `(${info.keyHint})`;
    $('keysLink').href = info.keysUrl;
    $('keysLink').textContent = `Get a ${info.label} key ↗`;
    $('modelsLink').href = info.modelsUrl;
    hideResult();
  }

  function fillForm() {
    $('provider').value = settings.provider;
    fillProviderFields();
    $('voiceProfile').value = settings.voiceProfile;
    $('tone').value = settings.tone;
    $('length').value = settings.length;
    $('emojis').checked = !!settings.emojis;
    $('bannedPhrases').value = settings.bannedPhrases;
    $('profileName').value = settings.profileName;
    $('onlyMyPosts').checked = !!settings.onlyMyPosts;
    $('debug').checked = !!settings.debug;
  }

  function bind() {
    $('provider').addEventListener('change', (e) => {
      settings.provider = e.target.value;
      fillProviderFields();
      scheduleSave();
    });

    $('apiKey').addEventListener('input', (e) => {
      settings.keys[settings.provider] = e.target.value.trim();
      scheduleSave();
    });

    $('model').addEventListener('input', (e) => {
      settings.models[settings.provider] = e.target.value.trim();
      scheduleSave();
    });

    $('resetModel').addEventListener('click', () => {
      const def = CSB.PROVIDERS[settings.provider].defaultModel;
      settings.models[settings.provider] = def;
      $('model').value = def;
      scheduleSave();
    });

    $('toggleKey').addEventListener('click', () => {
      const input = $('apiKey');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('toggleKey').textContent = show ? 'Hide' : 'Show';
      $('toggleKey').setAttribute('aria-pressed', String(show));
    });

    const text = { voiceProfile: 'voiceProfile', bannedPhrases: 'bannedPhrases', profileName: 'profileName' };
    for (const [id, key] of Object.entries(text)) {
      $(id).addEventListener('input', (e) => {
        settings[key] = e.target.value;
        scheduleSave();
      });
    }

    for (const id of ['tone', 'length']) {
      $(id).addEventListener('change', (e) => {
        settings[id] = e.target.value;
        scheduleSave();
      });
    }

    for (const id of ['emojis', 'onlyMyPosts', 'debug']) {
      $(id).addEventListener('change', (e) => {
        settings[id] = e.target.checked;
        scheduleSave();
      });
    }

    $('testConnection').addEventListener('click', testConnection);
  }

  // ───────────────────────── Test connection ─────────────────────────

  function hideResult() {
    const box = $('testResult');
    box.hidden = true;
    box.textContent = '';
  }

  function showResult(kind, title, detail) {
    const box = $('testResult');
    box.hidden = false;
    box.className = `result ${kind}`;
    box.textContent = title;
    if (detail) {
      const d = document.createElement('span');
      d.className = 'detail';
      d.textContent = detail;
      box.appendChild(d);
    }
  }

  async function testConnection() {
    const btn = $('testConnection');
    const provider = settings.provider;
    const label = CSB.PROVIDERS[provider].label;
    btn.disabled = true;
    showResult('info', `Testing ${label}…`);
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'csb:testConnection',
        provider,
        apiKey: $('apiKey').value.trim(),
        model: $('model').value.trim(),
      });
      if (res && res.ok) {
        showResult('ok', `✓ Connected to ${label} using “${res.model}” (${(res.ms / 1000).toFixed(1)}s).`);
      } else {
        const err = (res && res.error) || {};
        showResult('err', `✗ ${err.message || 'Test failed.'}`, err.detail ? `Exact error: ${err.detail}` : '');
      }
    } catch (e) {
      showResult('err', '✗ Could not reach the extension background.', String(e && e.message));
    } finally {
      btn.disabled = false;
    }
  }

  bind();
  load();
})();
