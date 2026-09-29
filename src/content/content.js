/*
 * CSB Reply Assistant: content script (runs on linkedin.com only).
 *
 * - Adds a small "✦ Reply" button under each comment on your posts.
 * - When you click it, reads ONLY that comment, its thread and the post,
 *   asks the background worker for reply options, and shows a panel.
 * - "Use" opens LinkedIn's own reply box and types the text in.
 *
 * It never clicks Post/Send/Like, never scrolls or loads more comments,
 * and never reads anything until you click.
 */
(function () {
  'use strict';

  if (globalThis.__CSB_RA_LOADED__) return;
  globalThis.__CSB_RA_LOADED__ = true;

  const DOM = globalThis.CSB_DOM;
  const LOG = '[CSB Reply]';
  const ext = makeBridge();
  if (!DOM || !ext) return;

  const OPTION_LABELS = ['Warm', 'Insight', 'Question'];
  const CATEGORY_LABELS = {
    lead: 'Lead',
    question: 'Question',
    compliment: 'Compliment',
    hiring: 'Hiring',
    collab: 'Collab',
    disagreement: 'Disagreement',
    spam: 'Spam',
    other: 'Other',
  };

  let settings = { onlyMyPosts: true, profileName: '', debug: false, hasKey: false };
  let settingsVersion = 0;

  const state = {
    panel: null, // { el, commentEl, btn, key, requestId }
    cache: new Map(), // comment key → { result, meta, shown[], instruction }
    slots: new WeakMap(), // comment element → our injected slot
    meta: new WeakMap(), // comment element → { version, eligible, reason, key }
    posts: new WeakMap(), // post element → { version, author, own }
    generated: new Set(), // comment keys you've generated replies for (shows ✓)
    askedGenerated: new Set(), // keys already looked up in storage
    lastUrl: location.href,
  };

  // ───────────────────────── Bridge to the extension ─────────────────────────

  /**
   * On LinkedIn this talks to the background worker via chrome.runtime.
   * On test/mock-linkedin.html (no extension), a fake bridge is provided.
   */
  function makeBridge() {
    const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
    if (hasRuntime) {
      return {
        send(msg) {
          try {
            return chrome.runtime.sendMessage(msg);
          } catch (err) {
            return Promise.reject(err);
          }
        },
        onMessage(fn) {
          chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (sender.id !== chrome.runtime.id) return false;
            const out = fn(msg);
            if (out === undefined) return false;
            Promise.resolve(out).then(sendResponse, () => sendResponse(null));
            return true;
          });
        },
      };
    }
    return globalThis.CSB_MOCK_EXT || null;
  }

  function bridgeError(err) {
    const msg = String((err && err.message) || err || '');
    if (/context invalidated|receiving end does not exist|could not establish connection|message port closed/i.test(msg)) {
      return {
        kind: 'reload',
        message: 'The extension was reloaded or updated. Refresh this LinkedIn tab (F5) to reconnect.',
        detail: msg,
      };
    }
    return { kind: 'other', message: "Couldn't reach the extension.", detail: msg };
  }

  // ───────────────────────── Small DOM helpers ─────────────────────────

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(fn, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return fn();
  }

  function hash(str) {
    let x = 5381;
    for (let i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }

  function isMe(name) {
    return !!settings.profileName && DOM.sameName(name, settings.profileName);
  }

  function isDarkPage() {
    const html = document.documentElement;
    if (/\btheme--dark\b/.test(html.className)) return true;
    if (/\btheme--light\b/.test(html.className)) return false;
    for (const el of [document.body, html]) {
      if (!el) continue;
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [r, g, b, a = 1] = m[1].split(',').map((n) => parseFloat(n));
      if (a < 0.5) continue;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** The top-level comment of a thread (itself if it isn't a reply). */
  function topLevel(commentEl) {
    let top = commentEl;
    for (let p = DOM.ownerComment(top.parentElement); p; p = DOM.ownerComment(top.parentElement)) top = p;
    return top;
  }

  /** A stable key per comment: LinkedIn's URN, or a hash (no text is stored). */
  function commentKey(commentEl) {
    const id = DOM.getCommentId(commentEl);
    if (id) return id;
    const post = DOM.findPost(commentEl).el;
    const postId = (post && (post.getAttribute('data-urn') || post.getAttribute('data-id'))) || location.pathname;
    const author = DOM.getCommentAuthor(commentEl).value;
    const text = DOM.getCommentText(commentEl).value.slice(0, 120);
    return 'h:' + hash(`${postId}|${author}|${text}`);
  }

  // ───────────────────────── Finding comments + injecting buttons ─────────────────────────

  function postInfo(postEl) {
    const cached = state.posts.get(postEl);
    if (cached && cached.version === settingsVersion && cached.author) return cached;
    const author = DOM.getPostAuthor(postEl);
    const info = {
      version: settingsVersion,
      author: author.value,
      matched: author.matched,
      own: !settings.profileName || isMe(author.value),
    };
    state.posts.set(postEl, info);
    return info;
  }

  function evaluate(commentEl) {
    const cached = state.meta.get(commentEl);
    // Re-check only after a settings change, or while the post author is still unknown.
    if (cached && cached.version === settingsVersion && (cached.eligible || cached.pInfo.author)) return cached;

    const post = DOM.findPost(commentEl);
    const pInfo = postInfo(post.el);
    const author = DOM.getCommentAuthor(commentEl);
    let eligible = true;
    let reason = '';
    if (settings.onlyMyPosts && !pInfo.own) {
      eligible = false;
      reason = pInfo.author ? `post by ${pInfo.author}, not you` : 'post author not found';
    } else if (author.value && isMe(author.value)) {
      eligible = false;
      reason = 'your own comment';
    }
    const key = eligible ? commentKey(commentEl) : '';
    const meta = { version: settingsVersion, eligible, reason, key, author, post, pInfo };
    state.meta.set(commentEl, meta);
    return meta;
  }

  /** Our slot for this comment, if it's still attached (ignores nested replies' slots). */
  function existingSlot(commentEl) {
    const slot = state.slots.get(commentEl);
    if (slot && slot.isConnected && commentEl.contains(slot)) return slot;
    // Remove stale slots left by an older copy of the extension (e.g. after reload).
    commentEl.querySelectorAll('.csb-ra-slot').forEach((s) => {
      if (DOM.ownerComment(s) === commentEl) s.remove();
    });
    return null;
  }

  function injectSlot(commentEl, meta) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'csb-ra-btn',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        title: 'Draft a reply with CSB Reply Assistant (Alt+R)',
      },
      h('span', { class: 'csb-ra-star', 'aria-hidden': 'true', text: '✦' }),
      ' Reply'
    );
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.panel && state.panel.commentEl === commentEl) closePanel();
      else openPanel(commentEl, btn);
    });

    const slot = h('span', { class: 'csb-ra-slot', 'data-csb-for': meta.key }, btn);

    const bar = DOM.findSocialBar(commentEl);
    const reply = DOM.findReplyButton(commentEl).el;
    if (bar.el && reply && bar.el.contains(reply)) {
      let anchor = reply;
      while (anchor.parentElement && anchor.parentElement !== bar.el) anchor = anchor.parentElement;
      anchor.after(slot);
    } else if (bar.el) {
      bar.el.appendChild(slot);
    } else {
      slot.classList.add('csb-ra-slot--block');
      const textEl = DOM.getCommentText(commentEl).el;
      if (textEl) textEl.after(slot);
      else commentEl.appendChild(slot);
    }
    state.slots.set(commentEl, slot);
    return slot;
  }

  /** Show a ✓ next to ✦ Reply on comments you've already generated replies for. */
  function updateCheck(slot, key) {
    if (!slot) return;
    const has = state.generated.has(key);
    let check = slot.querySelector('.csb-ra-check');
    if (has && !check) {
      check = h('span', { class: 'csb-ra-check', title: 'You already generated replies for this comment', text: '✓' });
      const btn = slot.querySelector('.csb-ra-btn');
      if (btn) btn.after(check);
      else slot.appendChild(check);
    } else if (!has && check) check.remove();
  }

  /** Ask storage (once per comment) whether replies were generated before. */
  let lookupTimer = null;
  const pendingLookup = new Set();
  function lookupGenerated(keys) {
    const fresh = keys.filter((k) => k && !state.askedGenerated.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => {
      state.askedGenerated.add(k);
      pendingLookup.add(k);
    });
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(async () => {
      const batch = Array.from(pendingLookup);
      pendingLookup.clear();
      try {
        const res = await ext.send({ type: 'csb:getGenerated', keys: batch });
        if (res && res.ok) res.keys.forEach((k) => state.generated.add(k));
      } catch (_) {
        return;
      }
      for (const { el } of DOM.findComments(document)) {
        const meta = state.meta.get(el);
        if (meta && meta.eligible) updateCheck(state.slots.get(el), meta.key);
      }
    }, 100);
  }

  function processComment(commentEl) {
    const meta = evaluate(commentEl);
    const mark = meta.eligible ? 'on' : 'skip';
    if (commentEl.getAttribute('data-csb-ra') !== mark) commentEl.setAttribute('data-csb-ra', mark);
    const slot = existingSlot(commentEl);
    if (!meta.eligible) {
      if (slot) slot.remove();
      state.slots.delete(commentEl);
      return meta;
    }
    if (!slot) updateCheck(injectSlot(commentEl, meta), meta.key);
    return meta;
  }

  function scan() {
    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      closePanel();
    }
    const found = DOM.findComments(document);
    const keys = [];
    for (const f of found) {
      const meta = processComment(f.el);
      if (meta.eligible) keys.push(meta.key);
    }
    lookupGenerated(keys);
    if (state.panel && !state.panel.commentEl.isConnected) closePanel();
    if (settings.debug) debugUpdate(found);
    return found;
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 250);
  }

  /** Nodes we add ourselves (buttons, panel, toasts, debug labels) don't need a rescan. */
  function isOurNode(n) {
    if (!n || n.nodeType !== 1) return n && n.nodeType === 3 && n.parentElement && isOurNode(n.parentElement);
    if (n.id === 'csb-ra-panel') return true;
    return Array.from(n.classList || []).some((c) => c.startsWith('csb-ra-'));
  }

  function onMutations(records) {
    for (const r of records) {
      for (const n of r.addedNodes) if (!isOurNode(n)) return scheduleScan();
      // A removed ✦ button must come back, so that removal does need a rescan.
      for (const n of r.removedNodes) {
        if (!isOurNode(n) || (n.classList && n.classList.contains('csb-ra-slot'))) return scheduleScan();
      }
    }
    return undefined;
  }

  // ───────────────────────── Debug mode ─────────────────────────
  // Outlines every detected comment (purple = button shown, orange = skipped),
  // labels which selector matched, logs a summary to the console and shows a
  // small "Copy debug report" pill. Nothing here reads or logs comment text.

  const dbg = { tags: new WeakMap(), outlined: new Set(), pill: null, lastSig: '', report: null };

  function short(matched) {
    return matched ? matched.split(' ')[0] : 'NOT FOUND';
  }

  function dlog(...args) {
    if (settings.debug) console.log(LOG, ...args);
  }

  function debugDetails(el) {
    return {
      author: DOM.getCommentAuthor(el),
      headline: DOM.getCommentHeadline(el).matched,
      text: DOM.getCommentText(el).matched,
      reply: DOM.findReplyButton(el).matched,
      bar: DOM.findSocialBar(el).matched,
    };
  }

  function debugTag(el, text, skipped) {
    let tag = dbg.tags.get(el);
    if (!tag || !tag.isConnected) {
      tag = h('span', { class: 'csb-ra-debug-tag' });
      const slot = state.slots.get(el);
      if (slot && slot.isConnected) slot.appendChild(tag);
      else {
        const bar = DOM.findSocialBar(el).el;
        if (bar) bar.appendChild(tag);
        else el.insertBefore(tag, el.firstChild);
      }
      dbg.tags.set(el, tag);
    }
    tag.classList.toggle('csb-ra-debug-tag--skip', skipped);
    tag.textContent = text;
    tag.title = text;
  }

  function debugUpdate(found) {
    const rows = [];
    const selectorCounts = {};
    const bump = (group, matched) => {
      selectorCounts[group] = selectorCounts[group] || {};
      const k = matched || 'NOT FOUND';
      selectorCounts[group][k] = (selectorCounts[group][k] || 0) + 1;
    };
    const posts = new Map();
    const problems = [];
    const skippedReasons = {};

    found.forEach((f, i) => {
      const el = f.el;
      const meta = state.meta.get(el) || evaluate(el);
      const d = debugDetails(el);
      bump('comment', f.matched);
      bump('commentAuthor', d.author.matched);
      bump('commentHeadline', d.headline);
      bump('commentText', d.text);
      bump('replyButton', d.reply);
      bump('socialBar', d.bar);
      if (!d.author.matched) problems.push(`comment ${i + 1}: author NOT FOUND`);
      if (!d.text) problems.push(`comment ${i + 1}: text NOT FOUND`);
      if (!d.reply) problems.push(`comment ${i + 1}: LinkedIn Reply button NOT FOUND (Use will fall back to Copy)`);
      if (!meta.eligible) skippedReasons[meta.reason] = (skippedReasons[meta.reason] || 0) + 1;

      const postEl = meta.post && meta.post.el;
      if (postEl && !posts.has(postEl)) {
        posts.set(postEl, {
          selector: meta.post.matched,
          authorSelector: meta.pInfo.matched || 'NOT FOUND',
          author: meta.pInfo.author,
          yours: meta.pInfo.own,
          textSelector: DOM.getPostText(postEl).matched || 'NOT FOUND',
        });
      }

      el.classList.add('csb-ra-debug-outline');
      el.classList.toggle('csb-ra-debug-skip', !meta.eligible);
      dbg.outlined.add(el);
      const label =
        `${short(f.matched)} · author ${short(d.author.matched).replace('commentAuthor', '')}` +
        ` · text ${short(d.text).replace('commentText', '')} · reply ${short(d.reply).replace('replyButton', '')}` +
        (meta.eligible ? '' : ` · skipped: ${meta.reason}`);
      debugTag(el, label, !meta.eligible);

      rows.push({
        '#': i + 1,
        author: d.author.value || '(not found)',
        comment: f.matched,
        authorSel: d.author.matched || 'NOT FOUND',
        textSel: d.text || 'NOT FOUND',
        replySel: d.reply || 'NOT FOUND',
        button: meta.eligible ? 'shown' : `skipped (${meta.reason})`,
      });
    });

    const loadMore = DOM.findLoadMore(document);
    loadMore.forEach((l) => bump('loadMore', l.matched));
    const shown = found.filter((f) => state.meta.get(f.el) && state.meta.get(f.el).eligible).length;
    const postList = Array.from(posts.values());
    posts.forEach((p) => bump('postAuthor', p.authorSelector === 'NOT FOUND' ? null : p.authorSelector));

    const firstComment = found[0] && found[0].el;
    const firstPost = posts.keys().next().value;
    dbg.report = {
      tool: 'CSB Reply Assistant debug report (contains no comment text or names)',
      version: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || 'mock',
      time: new Date().toISOString(),
      page: location.hostname + location.pathname.replace(/\d{6,}/g, '…'),
      browser: navigator.userAgent,
      settings: { onlyMyPosts: settings.onlyMyPosts, profileNameSet: !!settings.profileName },
      counts: { comments: found.length, buttonsShown: shown, skipped: found.length - shown, posts: posts.size, loadMoreButtons: loadMore.length },
      skippedReasons: Object.fromEntries(Object.entries(skippedReasons).map(([k, v]) => [k.replace(/post by .+, not you/, 'post by someone else'), v])),
      selectorsMatched: selectorCounts,
      posts: postList.map((p) => ({ selector: p.selector, authorSelector: p.authorSelector, authorFound: !!p.author, yours: p.yours, textSelector: p.textSelector })),
      problems: problems.slice(0, 30),
      firstCommentStructure: firstComment ? DOM.skeleton(firstComment).join('\n') : null,
      firstPostStructure: firstPost ? DOM.skeleton(firstPost, 0, 7).slice(0, 60).join('\n') : null,
      pageStructure: found.length ? null : DOM.skeleton(document.querySelector('main') || document.body, 0, 8).slice(0, 150).join('\n'),
    };

    updatePill(found.length, shown, posts.size);

    // Log only when something changed, so the console stays readable.
    const sig = JSON.stringify([selectorCounts, skippedReasons, postList, problems.length]);
    if (sig !== dbg.lastSig) {
      dbg.lastSig = sig;
      console.groupCollapsed(`${LOG} Debug: ${found.length} comments, ${shown} buttons, ${found.length - shown} skipped, ${posts.size} posts`);
      console.log('Which selector matched (see src/content/selectors.js):', selectorCounts);
      postList.forEach((p) =>
        console.log(`Post via ${p.selector}: author "${p.author || 'NOT FOUND'}" via ${p.authorSelector} → ${p.yours ? 'yours' : 'not yours'}; text via ${p.textSelector}`)
      );
      if (Object.keys(skippedReasons).length) console.log('Skipped:', skippedReasons);
      if (problems.length) console.warn(LOG, 'Problems:', problems);
      if (loadMore.length) console.log(`"Load more" buttons on page: ${loadMore.length} (never clicked by the extension)`);
      if (rows.length && console.table) console.table(rows);
      if (!found.length) console.warn(LOG, 'No comments detected. Open the comments under a post, or click "Copy debug report" and send it over.');
      console.groupEnd();
    }
  }

  function updatePill(comments, shown, posts) {
    if (!dbg.pill || !dbg.pill.isConnected) {
      const copyBtn = h('button', { type: 'button', class: 'csb-ra-debug-copy', text: 'Copy debug report' });
      copyBtn.addEventListener('click', async () => {
        const ok = await copyText(JSON.stringify(dbg.report, null, 2));
        copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => copyBtn.isConnected && (copyBtn.textContent = 'Copy debug report'), 1500);
        if (ok) console.log(LOG, 'Debug report copied to clipboard:', dbg.report);
      });
      dbg.pill = h('div', { class: 'csb-ra-debug-pill', role: 'status' }, h('span', { class: 'csb-ra-debug-text' }), copyBtn);
      document.body.appendChild(dbg.pill);
    }
    dbg.pill.querySelector('.csb-ra-debug-text').textContent = comments
      ? `✦ CSB debug · ${comments} comments · ${shown} buttons · ${comments - shown} skipped · ${posts} posts`
      : '✦ CSB debug · no comments detected yet';
  }

  function clearDebug() {
    dbg.outlined.forEach((el) => el.classList.remove('csb-ra-debug-outline', 'csb-ra-debug-skip'));
    dbg.outlined.clear();
    document.querySelectorAll('.csb-ra-debug-tag').forEach((t) => t.remove());
    if (dbg.pill) dbg.pill.remove();
    dbg.pill = null;
    dbg.lastSig = '';
    dbg.tags = new WeakMap();
  }

  // ───────────────────────── Reading the clicked comment ─────────────────────────

  function readContext(commentEl) {
    const post = DOM.findPost(commentEl).el;
    const top = topLevel(commentEl);
    const threadEls = [top, ...DOM.findComments(top).map((f) => f.el).filter((el) => el !== top)];
    const thread = threadEls.map((el) => {
      const author = DOM.getCommentAuthor(el).value;
      return {
        author,
        headline: DOM.getCommentHeadline(el).value,
        text: DOM.getCommentText(el).value,
        isMe: isMe(author),
        isTarget: el === commentEl,
      };
    });
    const target = thread.find((t) => t.isTarget) || {};
    return {
      post: { author: DOM.getPostAuthor(post).value, text: DOM.getPostText(post).value },
      comment: { author: target.author, headline: target.headline, text: target.text, isReply: top !== commentEl },
      thread,
    };
  }

  // ───────────────────────── Panel ─────────────────────────

  function openPanel(commentEl, btn) {
    closePanel();
    const meta = evaluate(commentEl);
    const el = h('div', {
      id: 'csb-ra-panel',
      role: 'dialog',
      'aria-label': 'CSB Reply Assistant',
      tabindex: '-1',
      'data-theme': isDarkPage() ? 'dark' : 'light',
    });
    document.body.appendChild(el);
    state.panel = { el, commentEl, btn, key: meta.key, requestId: 0, author: meta.author.value };
    btn.setAttribute('aria-expanded', 'true');

    const cached = state.cache.get(meta.key);
    if (cached) renderResult(cached);
    else generate('');
    el.focus({ preventScroll: true });
  }

  function closePanel({ restoreFocus = false } = {}) {
    const p = state.panel;
    if (!p) return;
    state.panel = null;
    p.el.remove();
    if (p.btn) {
      p.btn.setAttribute('aria-expanded', 'false');
      if (restoreFocus && p.btn.isConnected) p.btn.focus({ preventScroll: true });
    }
  }

  function positionPanel() {
    const p = state.panel;
    if (!p) return;
    const anchor = p.btn && p.btn.isConnected ? p.btn : p.commentEl;
    const r = anchor.getBoundingClientRect();
    const pw = p.el.offsetWidth;
    const ph = p.el.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + 6;
    if (top + ph > vh - 8 && r.top - 6 - ph >= 8) top = r.top - 6 - ph;
    top = Math.max(8, Math.min(top, vh - ph - 8));
    const left = Math.max(8, Math.min(r.left, vw - pw - 8));
    p.el.style.top = `${Math.round(top)}px`;
    p.el.style.left = `${Math.round(left)}px`;
  }

  let rafPending = false;
  function schedulePosition() {
    if (rafPending || !state.panel) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      positionPanel();
    });
  }

  function header(category) {
    return h(
      'div',
      { class: 'csb-ra-head' },
      h('span', { class: 'csb-ra-mark', 'aria-hidden': 'true', text: '✦' }),
      h('span', { class: 'csb-ra-title', text: 'Reply Assistant' }),
      category
        ? h('span', { class: `csb-ra-badge csb-ra-badge--${category}`, text: CATEGORY_LABELS[category] || category })
        : null,
      h('span', { class: 'csb-ra-spacer' }),
      h('button', {
        type: 'button',
        class: 'csb-ra-close',
        'aria-label': 'Close',
        title: 'Close (Esc)',
        text: '×',
        onclick: () => closePanel({ restoreFocus: true }),
      })
    );
  }

  function render(...bodyChildren) {
    const p = state.panel;
    if (!p) return;
    p.el.textContent = '';
    p.el.appendChild(bodyChildren[0]);
    p.el.appendChild(h('div', { class: 'csb-ra-body' }, bodyChildren.slice(1)));
    positionPanel();
  }

  function forLine() {
    const name = state.panel && state.panel.author;
    return name ? h('p', { class: 'csb-ra-for', text: `Replying to ${name}` }) : null;
  }

  function renderLoading() {
    render(
      header(null),
      forLine(),
      h(
        'div',
        { class: 'csb-ra-loading', role: 'status' },
        h('span', { class: 'csb-ra-spinner', 'aria-hidden': 'true' }),
        'Reading the comment and writing options…'
      )
    );
  }

  function regenRow(value) {
    const input = h('input', {
      type: 'text',
      class: 'csb-ra-input',
      placeholder: 'Instruction, e.g. “make it funnier”',
      'aria-label': 'One-line instruction for Regenerate',
      maxlength: '300',
    });
    input.value = value || '';
    const go = () => generate(input.value.trim());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        go();
      }
    });
    return h(
      'div',
      { class: 'csb-ra-regen' },
      input,
      h('button', { type: 'button', class: 'csb-ra-ghost', text: '↻ Regenerate', onclick: go })
    );
  }

  function copyButton(text, label = 'Copy') {
    const btn = h('button', { type: 'button', class: 'csb-ra-ghost', text: label });
    btn.addEventListener('click', async () => {
      const ok = await copyText(text);
      btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      setTimeout(() => btn.isConnected && (btn.textContent = label), 1500);
    });
    return btn;
  }

  function renderResult(entry) {
    const p = state.panel;
    if (!p) return;
    const { result, meta } = entry;
    const isSpam = result.category === 'spam';

    const cards = result.replies.map((text, i) => {
      const warn = (result.warnings && result.warnings[i]) || [];
      return h(
        'div',
        { class: `csb-ra-card${isSpam ? ' csb-ra-card--note' : ''}` },
        h('p', { class: 'csb-ra-card-label', text: isSpam ? 'Suggestion' : `${i + 1} · ${OPTION_LABELS[i] || 'Option'}` }),
        h('p', { class: 'csb-ra-card-text', text }),
        warn.length ? h('p', { class: 'csb-ra-warn', text: `⚠ Uses a banned phrase: ${warn.join(', ')}` }) : null,
        h(
          'div',
          { class: 'csb-ra-card-actions' },
          copyButton(text),
          isSpam
            ? null
            : h('button', {
                type: 'button',
                class: 'csb-ra-primary',
                text: 'Use',
                title: 'Put this in LinkedIn’s reply box (you still click Post)',
                onclick: (e) => useReply(text, e.currentTarget),
              })
        )
      );
    });

    const dm = result.dm_draft
      ? h(
          'div',
          { class: 'csb-ra-section' },
          h('div', { class: 'csb-ra-section-head' }, h('span', { text: 'Suggested DM' }), copyButton(result.dm_draft, 'Copy DM')),
          h('div', { class: 'csb-ra-card' }, h('p', { class: 'csb-ra-card-text', text: result.dm_draft }))
        )
      : null;

    render(
      header(result.category),
      forLine(),
      result.summary ? h('p', { class: 'csb-ra-summary', text: result.summary }) : null,
      ...cards,
      dm,
      regenRow(entry.instruction),
      h(
        'p',
        { class: 'csb-ra-foot' },
        h('span', { text: 'You post it yourself. Nothing is sent to LinkedIn.' }),
        h('span', { text: (meta && meta.model) || '' })
      )
    );
  }

  const SETTINGS_KINDS = ['missing_key', 'auth', 'model', 'quota'];

  function renderError(err) {
    const e = err || {};
    const actions = [];
    if (e.kind !== 'reload') {
      const again = () => generate((state.panel && state.panel.instruction) || '');
      actions.push(h('button', { type: 'button', class: 'csb-ra-primary', text: 'Try again', onclick: again }));
    }
    if (SETTINGS_KINDS.includes(e.kind)) {
      actions.push(
        h('button', {
          type: 'button',
          class: 'csb-ra-ghost',
          text: 'Open settings',
          onclick: () => ext.send({ type: 'csb:openSettings' }).catch(() => {}),
        })
      );
    }
    render(
      header(null),
      forLine(),
      h(
        'div',
        { class: 'csb-ra-error', role: 'alert' },
        h('p', { class: 'csb-ra-error-title', text: e.message || 'Something went wrong.' }),
        e.detail ? h('p', { class: 'csb-ra-error-detail', text: `Exact error: ${e.detail}` }) : null,
        actions.length ? h('div', { class: 'csb-ra-error-actions' }, actions) : null
      )
    );
  }

  // ───────────────────────── Generating ─────────────────────────

  async function generate(instruction) {
    const p = state.panel;
    if (!p) return;
    const id = ++p.requestId;
    p.instruction = instruction;
    const cached = state.cache.get(p.key);
    const previousReplies = cached ? cached.shown : [];

    renderLoading();

    let context;
    try {
      context = readContext(p.commentEl);
    } catch (err) {
      renderError({ kind: 'dom', message: "Couldn't read this comment from the page.", detail: String(err && err.message) });
      return;
    }
    dlog('Reading clicked comment:', {
      postAuthor: context.post.author || 'NOT FOUND',
      postTextFound: !!context.post.text,
      commentAuthor: context.comment.author || 'NOT FOUND',
      commentTextFound: !!context.comment.text,
      isReply: context.comment.isReply,
      threadItems: context.thread.length,
    });
    if (!context.comment.text) {
      renderError({
        kind: 'dom',
        message: "Couldn't find this comment's text. LinkedIn may have changed its layout. Turn on Debug mode in settings to check.",
      });
      return;
    }

    let res;
    try {
      res = await ext.send({ type: 'csb:generate', context, instruction, previousReplies });
    } catch (err) {
      res = { ok: false, error: bridgeError(err) };
    }
    if (!res) res = { ok: false, error: { kind: 'other', message: 'No answer from the extension. Try again.' } };

    let entry = null;
    if (res.ok) {
      entry = {
        result: res.result,
        meta: res.meta,
        shown: [...previousReplies, ...res.result.replies],
        instruction,
      };
      state.cache.set(p.key, entry);
      state.generated.add(p.key);
      updateCheck(state.slots.get(p.commentEl), p.key);
      ext.send({ type: 'csb:markGenerated', key: p.key }).catch(() => {});
    }

    // Ignore answers that arrive after the panel was closed or regenerated.
    if (state.panel !== p || p.requestId !== id) return;
    if (entry) renderResult(entry);
    else renderError(res.error);
  }

  // ───────────────────────── Inserting into LinkedIn's reply box ─────────────────────────

  function outermostEditable(el) {
    let top = el;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('contenteditable') === 'true') top = n;
    }
    return top;
  }

  /** An open reply box for this comment's thread, preferring the focused one. */
  function findOpenEditor(commentEl) {
    const scope = topLevel(commentEl);
    const editors = DOM.findEditors(scope);
    const active = document.activeElement;
    if (active && active.isContentEditable) {
      const hit = editors.find((e) => e.el === active || e.el.contains(active));
      if (hit) return hit.el;
    }
    return editors.length ? editors[editors.length - 1].el : null;
  }

  /** After clicking LinkedIn's Reply, wait for the reply box it opens. */
  function focusedReplyEditor(commentEl) {
    const active = document.activeElement;
    if (active && active.isContentEditable && !active.closest('#csb-ra-panel')) {
      const ed = outermostEditable(active);
      const hint = `${ed.getAttribute('aria-placeholder') || ''} ${ed.getAttribute('data-placeholder') || ''} ${ed.getAttribute('aria-label') || ''}`;
      if (topLevel(commentEl).contains(ed) || /reply/i.test(hint)) return ed;
    }
    return findOpenEditor(commentEl);
  }

  function norm(t) {
    return String(t || '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function editorHas(editor, text) {
    const needle = norm(text).slice(0, 60);
    return !!needle && norm(editor.innerText || editor.textContent).includes(needle);
  }

  function blockOf(editor, which) {
    const child = which === 'first' ? editor.firstElementChild : editor.lastElementChild;
    return child && /^(P|DIV)$/.test(child.tagName) ? child : editor;
  }

  /** Select what "Use" should replace: everything after LinkedIn's @mention, or everything. */
  function selectReplaceRange(editor) {
    const mention = DOM.lastMention(editor);
    const range = document.createRange();
    if (mention) range.setStartAfter(mention);
    else range.setStart(blockOf(editor, 'first'), 0);
    const last = blockOf(editor, 'last');
    range.setEnd(last, last.childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return { range, mention };
  }

  function placeCaretAtEnd(editor) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let lastText = null;
    while (walker.nextNode()) lastText = walker.currentNode;
    const range = document.createRange();
    if (lastText) range.setStart(lastText, lastText.length);
    else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * Type text into a contenteditable so LinkedIn notices it.
   * 1) execCommand('insertText')  2) a paste event  3) beforeinput + input events.
   */
  function insertIntoEditor(editor, text) {
    const clean = norm(text);
    editor.focus();

    const attempts = [
      ['execCommand insertText', (payload) => document.execCommand('insertText', false, payload)],
      [
        'paste event',
        (payload) => {
          const dt = new DataTransfer();
          dt.setData('text/plain', payload);
          editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        },
      ],
      [
        'input events',
        (payload, range) => {
          const accepted = editor.dispatchEvent(
            new InputEvent('beforeinput', { inputType: 'insertText', data: payload, bubbles: true, cancelable: true })
          );
          if (editorHas(editor, clean) || !accepted) return;
          range.deleteContents();
          range.insertNode(document.createTextNode(payload));
          editor.classList.remove('ql-blank');
          editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: payload, bubbles: true }));
        },
      ],
    ];

    for (const [method, run] of attempts) {
      const before = norm(editor.innerText || editor.textContent);
      const { range, mention } = selectReplaceRange(editor);
      const payload = mention ? ` ${clean}` : clean;
      try {
        run(payload, range);
      } catch (_) {
        /* try the next method */
      }
      if (editorHas(editor, clean)) {
        placeCaretAtEnd(editor);
        return { ok: true, method };
      }
      // Something changed but not correctly: stop rather than risk duplicates.
      if (norm(editor.innerText || editor.textContent) !== before) break;
    }
    return { ok: false };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      /* fall back below */
    }
    const prev = document.activeElement;
    try {
      const ta = h('textarea', { readonly: true, style: 'position:fixed;top:-1000px;left:0;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (prev && prev.focus) prev.focus({ preventScroll: true });
      return ok;
    } catch (_) {
      return false;
    }
  }

  let toastTimer = null;
  function toast(message, warn = false) {
    document.querySelectorAll('.csb-ra-toast').forEach((t) => t.remove());
    const t = h('div', { class: `csb-ra-toast${warn ? ' csb-ra-toast--warn' : ''}`, role: 'status', text: message });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), warn ? 6000 : 3500);
  }

  async function useReply(text, button) {
    const p = state.panel;
    if (!p) return;
    const commentEl = p.commentEl;
    if (button) {
      button.disabled = true;
      button.textContent = 'Inserting…';
    }

    let editor = findOpenEditor(commentEl);
    dlog('Use: reply box already open?', !!editor);
    if (!editor) {
      const reply = DOM.findReplyButton(commentEl);
      dlog('Use: LinkedIn Reply button via', reply.matched || 'NOT FOUND');
      // Safety: only ever click LinkedIn's "Reply" action, never Post/Send.
      if (reply.el && DOM.isSafeReplyAction(reply.el)) {
        reply.el.click();
        editor = await waitFor(() => focusedReplyEditor(commentEl), 3000);
      }
      dlog('Use: reply box found after clicking Reply?', !!editor);
    }

    const done = editor ? insertIntoEditor(editor, text) : { ok: false };
    dlog('Use: inserted?', done.ok, done.method ? `via ${done.method}` : '');
    if (done.ok) {
      closePanel();
      toast('✦ Reply inserted. Edit it if you like, then click Post yourself.');
      return;
    }

    const copied = await copyText(text);
    if (button && button.isConnected) {
      button.disabled = false;
      button.textContent = 'Use';
    }
    toast(
      copied
        ? "Couldn't type into LinkedIn's reply box, so the reply is copied. Click Reply on the comment and paste it (Ctrl/Cmd+V)."
        : "Couldn't insert or copy the reply. Use the Copy button, or select the text and copy it manually.",
      true
    );
  }

  // ───────────────────────── Keyboard + outside click ─────────────────────────

  /** Alt+R: the focused comment, otherwise the one nearest the middle of the screen. */
  function commentForShortcut() {
    const active = document.activeElement;
    const focused = active && DOM.ownerComment(active);
    if (focused && state.slots.get(focused)) return focused;

    const mid = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const { el } of DOM.findComments(document)) {
      const slot = state.slots.get(el);
      if (!slot || !slot.isConnected) continue;
      const r = slot.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || (!r.width && !r.height)) continue;
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestDist) {
        bestDist = d;
        best = el;
      }
    }
    return best;
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && state.panel) {
        e.preventDefault();
        e.stopPropagation();
        closePanel({ restoreFocus: true });
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR') {
        // Pages with no ✦ buttons at all keep Alt+R for themselves.
        if (!document.querySelector('.csb-ra-slot .csb-ra-btn')) return;
        const target = commentForShortcut();
        e.preventDefault();
        e.stopPropagation();
        if (!target) {
          toast('No comment with a ✦ Reply button is in view.');
          return;
        }
        openPanel(target, state.slots.get(target).querySelector('.csb-ra-btn'));
      }
    },
    true
  );

  document.addEventListener(
    'mousedown',
    (e) => {
      if (!state.panel) return;
      const t = e.target;
      if (state.panel.el.contains(t)) return;
      if (t && t.closest && t.closest('.csb-ra-slot')) return; // the ✦ button toggles itself
      closePanel();
    },
    true
  );

  window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
  window.addEventListener('resize', schedulePosition, { passive: true });

  // ───────────────────────── Start ─────────────────────────

  function applySettings(next) {
    if (!next) return;
    const prev = settings;
    settings = { ...settings, ...next };
    const relevant = ['profileName', 'onlyMyPosts', 'debug'].some((k) => prev[k] !== settings[k]);
    if (!relevant && settingsVersion > 0) return;
    settingsVersion += 1;
    if (!settings.debug) clearDebug();
    else dbg.lastSig = '';
    scan();
  }

  // ───────────────────────── Reply queue (asked for by the popup) ─────────────────────────
  // Lists comments already loaded on this page that don't have a reply from
  // you yet. It never loads more comments and nothing leaves your browser.

  function buildQueue() {
    const items = [];
    for (const { el } of DOM.findComments(document)) {
      const meta = evaluate(el);
      if (!meta.eligible) continue;
      const top = topLevel(el);
      const threadEls = [top, ...DOM.findComments(top).map((f) => f.el).filter((x) => x !== top)];
      const after = threadEls.slice(threadEls.indexOf(el) + 1);
      const replied = after.some((x) => isMe(DOM.getCommentAuthor(x).value));
      const text = DOM.getCommentText(el).value.replace(/\s+/g, ' ');
      items.push({
        key: meta.key,
        author: meta.author.value || 'Someone',
        snippet: text.length > 120 ? `${text.slice(0, 119)}…` : text,
        isReply: top !== el,
        replied,
        generated: state.generated.has(meta.key),
      });
    }
    return items;
  }

  function focusComment(key) {
    for (const { el } of DOM.findComments(document)) {
      const meta = state.meta.get(el);
      if (!meta || meta.key !== key) continue;
      // You clicked "Show" in the queue, so bring that one comment into view.
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('csb-ra-flash');
      void el.offsetWidth;
      el.classList.add('csb-ra-flash');
      setTimeout(() => el.classList.remove('csb-ra-flash'), 1800);
      const btn = state.slots.get(el) && state.slots.get(el).querySelector('.csb-ra-btn');
      if (btn) btn.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  ext.onMessage((msg) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type === 'csb:settingsChanged') {
      applySettings(msg.settings);
      return { ok: true };
    }
    if (msg.type === 'csb:getQueue') {
      scan();
      return { ok: true, items: buildQueue(), onlyMyPosts: settings.onlyMyPosts, profileNameSet: !!settings.profileName };
    }
    if (msg.type === 'csb:focusComment') {
      return { ok: focusComment(msg.key) };
    }
    return undefined;
  });

  async function start() {
    try {
      const res = await ext.send({ type: 'csb:getPublicSettings' });
      if (res && res.ok) applySettings(res.settings);
    } catch (err) {
      console.warn(LOG, 'Could not load settings:', bridgeError(err).message);
    }
    if (settings.debug) console.log(LOG, 'Debug mode is on. Detected comments are outlined.');
    scan();
    new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleScan);
    // Pick up settings changed while this tab was in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshSettings();
    });
  }

  async function refreshSettings() {
    try {
      const res = await ext.send({ type: 'csb:getPublicSettings' });
      if (res && res.ok) applySettings(res.settings);
    } catch (_) {
      /* extension reloaded; the ✦ button will say so when clicked */
    }
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
