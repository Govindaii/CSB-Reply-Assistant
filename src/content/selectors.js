/*
 * CSB Reply Assistant: ALL LinkedIn DOM selectors live in this file.
 *
 * When LinkedIn changes its layout, this is the only file that should need
 * editing. Each list is tried in order; the first entry is the most stable
 * hook (data attributes, aria-labels, roles), then LinkedIn's readable class
 * names, then a text/structure-based fallback.
 *
 * Turn on "Debug mode" in the extension settings to see which entry matched
 * on the current page (outlines + console logs + "Copy debug report").
 *
 * Plain script: exposes globalThis.CSB_DOM for content.js.
 */
(function (root) {
  'use strict';

  // ───────────────────────── Selector lists ─────────────────────────
  // name = what debug mode prints; css = the selector.

  const SELECTORS = {
    /** One comment (or reply). Replies are nested inside their parent comment. */
    comment: [
      { name: 'article[data-id^=urn:li:comment]', css: 'article[data-id^="urn:li:comment"]' },
      { name: 'article.comments-comment-entity', css: 'article.comments-comment-entity' },
      { name: 'article.comments-comment-item', css: 'article.comments-comment-item' },
      { name: '[data-id*=urn:li:comment:]', css: '[data-id*="urn:li:comment:"]' },
      // Last resort (see findComments): the parent <article> of a "Reply to …" button.
    ],

    /** Commenter's name, inside a comment. */
    commentAuthor: [
      { name: '.comments-comment-meta__description-title', css: '.comments-comment-meta__description-title' },
      { name: '.comments-post-meta__name-text [aria-hidden=true]', css: '.comments-post-meta__name-text [aria-hidden="true"]' },
      { name: '.comments-post-meta__name-text / [class*=description-title]', css: '.comments-post-meta__name-text, [class*="comment-meta__description-title"], [class*="post-meta__name"]' },
      { name: 'profile link [aria-hidden=true]', css: 'a[href*="/in/"] span[aria-hidden="true"], a[href*="/company/"] span[aria-hidden="true"]' },
      // Last resort (see getCommentAuthor): parse aria-label "Reply to <Name>’s comment".
    ],

    /** Commenter's headline ("Head of Marketing at …"). */
    commentHeadline: [
      { name: '.comments-comment-meta__description-subtitle', css: '.comments-comment-meta__description-subtitle' },
      { name: '.comments-post-meta__headline', css: '.comments-post-meta__headline' },
      { name: '[class*=meta__headline], [class*=description-subtitle]', css: '[class*="meta__headline"], [class*="description-subtitle"]' },
    ],

    /** The comment's text. */
    commentText: [
      { name: '.comments-comment-item__main-content', css: '.comments-comment-item__main-content' },
      { name: '.comments-comment-entity__content .update-components-text', css: '[class*="comment-entity__content"] .update-components-text, .comments-comment-item-content-body .update-components-text' },
      { name: '[class*=main-content] / .update-components-text', css: '[class*="main-content"], .update-components-text' },
      // Last resort (see getCommentText): the comment's own text minus header/buttons.
    ],

    /** LinkedIn's own "Reply" action under a comment (opens the reply box). */
    replyButton: [
      { name: 'button[aria-label^="Reply to"]', css: 'button[aria-label^="Reply to"], button[aria-label^="Reply"]' },
      { name: '.comments-comment-social-bar__reply-action-button', css: 'button[class*="reply-action-button"]' },
      { name: '.comments-comment-social-bar button (text "Reply")', css: '[class*="comment-social-bar"] button' },
      // Last resort (see findReplyButton): any button whose text is exactly "Reply".
    ],

    /** Row of actions under a comment (Like | Reply). Our button goes here. */
    socialBar: [
      { name: '.comments-comment-social-bar--cr', css: '.comments-comment-social-bar--cr' },
      { name: '.comments-comment-social-bar', css: '.comments-comment-social-bar, [class*="comment-social-bar"]' },
      { name: '[class*=comment-action]', css: '[class*="comment-actions"], [class*="comment-action-bar"]' },
      // Last resort: the parent of LinkedIn's Reply button.
    ],

    /** A post (feed update). Comments live inside it. */
    post: [
      { name: '[data-urn^=urn:li:activity/ugcPost/share]', css: '[data-urn^="urn:li:activity:"], [data-urn^="urn:li:ugcPost:"], [data-urn^="urn:li:share:"]' },
      { name: '[data-id^=urn:li:activity]', css: '[data-id^="urn:li:activity:"], [data-id^="urn:li:ugcPost:"], [data-id^="urn:li:share:"]' },
      { name: '.feed-shared-update-v2', css: '.feed-shared-update-v2, .fie-impression-container' },
      { name: 'role=article / main', css: 'div[role="article"], main' },
    ],

    /** Post author's name (the "actor"). */
    postAuthor: [
      { name: '.update-components-actor__title [aria-hidden=true]', css: '.update-components-actor__title span[aria-hidden="true"], .update-components-actor__name span[aria-hidden="true"], .update-components-actor__single-line-truncate span[aria-hidden="true"]' },
      { name: '.update-components-actor__name / __title', css: '.update-components-actor__name, .update-components-actor__title' },
      { name: '.feed-shared-actor__name', css: '.feed-shared-actor__name, .feed-shared-actor__title' },
      { name: '[class*=actor] profile link', css: '[class*="actor"] a[href*="/in/"] span[aria-hidden="true"], [class*="actor"] a[href*="/company/"] span[aria-hidden="true"]' },
    ],

    /** Post text. */
    postText: [
      { name: '.update-components-update-v2__commentary', css: '.update-components-update-v2__commentary' },
      { name: '.feed-shared-update-v2__description .update-components-text', css: '.feed-shared-update-v2__description .update-components-text, .feed-shared-inline-show-more-text' },
      { name: '.feed-shared-text / [class*=commentary]', css: '.feed-shared-text, [class*="commentary"], [data-test-id*="commentary"]' },
    ],

    /** A rich-text reply box (contenteditable). */
    editor: [
      { name: '.comments-comment-box--reply [contenteditable=true]', css: '[class*="comment-box--reply"] [contenteditable="true"]' },
      { name: '.ql-editor[contenteditable=true]', css: '.ql-editor[contenteditable="true"], .comments-comment-texteditor [contenteditable="true"]' },
      { name: '[contenteditable=true][role=textbox]', css: '[contenteditable="true"][role="textbox"], [contenteditable="true"]' },
    ],

    /** An @mention LinkedIn puts at the start of a reply. We keep it. */
    mention: [
      { name: '.ql-mention', css: '.ql-mention, a.ql-mention, span.ql-mention' },
      { name: '[data-entity-urn] / [data-mention]', css: '[data-entity-urn], [data-mention], [data-entity-type]' },
      { name: 'mention link', css: 'a[href*="/in/"], a[href*="/company/"], .mention' },
    ],

    /** "Load more comments" and "Load previous replies" (debug info only; never clicked). */
    loadMore: [
      { name: '.comments-comments-list__load-more-comments-button', css: '[class*="load-more-comments"]' },
      { name: '.show-prev-replies / replies load button', css: '.show-prev-replies, [class*="replies-list__load"], [class*="load-previous-replies"]' },
      // Last resort: buttons whose text mentions more comments/replies.
    ],
  };

  // ───────────────────────── Helpers ─────────────────────────

  const COMMENT_UNION = SELECTORS.comment.map((s) => s.css).join(', ');
  const heuristicComments = new WeakSet();

  function text(el) {
    if (!el) return '';
    return String(el.innerText || el.textContent || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isVisible(el) {
    return !!(el && el.isConnected && (el.offsetParent !== null || el.getClientRects().length > 0));
  }

  function safeQueryAll(scope, css) {
    try {
      return Array.from(scope.querySelectorAll(css));
    } catch (_) {
      return [];
    }
  }

  function isCommentRoot(el) {
    if (!el || el.nodeType !== 1) return false;
    if (heuristicComments.has(el)) return true;
    try {
      return el.matches(COMMENT_UNION);
    } catch (_) {
      return false;
    }
  }

  /** The comment an element belongs to (nearest comment ancestor). */
  function ownerComment(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (isCommentRoot(n)) return outerSameComment(n);
    }
    return null;
  }

  /** If a wrapper and an inner element share the same data-id, use the outer one. */
  function outerSameComment(el) {
    const id = el.getAttribute('data-id');
    if (!id) return el;
    let best = el;
    for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      if (n.getAttribute('data-id') === id) best = n;
    }
    return best;
  }

  /** First element for `key` inside `commentEl` that belongs to it, not to a nested reply. */
  function ownFirst(commentEl, key, extraFilter) {
    const list = SELECTORS[key] || [];
    for (let i = 0; i < list.length; i++) {
      const found = safeQueryAll(commentEl, list[i].css).find(
        (el) => ownerComment(el) === commentEl && !el.closest('.csb-ra-slot') && (!extraFilter || extraFilter(el))
      );
      if (found) return { el: found, matched: `${key}#${i + 1} ${list[i].name}` };
    }
    return { el: null, matched: null };
  }

  /** First element for `key` inside a post, ignoring anything inside comments. */
  function postFirst(postEl, key) {
    const list = SELECTORS[key] || [];
    for (let i = 0; i < list.length; i++) {
      const found = safeQueryAll(postEl, list[i].css).find((el) => !ownerComment(el) && text(el));
      if (found) return { el: found, matched: `${key}#${i + 1} ${list[i].name}` };
    }
    return { el: null, matched: null };
  }

  /** "Priya Nair • 2nd  Author" → "Priya Nair". */
  function cleanName(raw) {
    let t = String(raw || '').split('\n')[0];
    t = t.split(/\s[•·|]\s|\s•|•/)[0];
    // LinkedIn badges, sometimes glued to the name with no space ("Shahran AhmedAuthor").
    t = t.replace(/\s*(Author|Creator)\s*$/, '');
    t = t.replace(/\b(Verified|Premium|Top Voice|View profile|Follow)\b.*$/i, '');
    t = t.replace(/\((he|she|they)\/[^)]*\)/gi, '');
    t = t.replace(/\b(1st|2nd|3rd\+?)\b/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  /** Compare two names loosely (case, accents, emoji and punctuation ignored). */
  function normName(n) {
    return cleanName(n)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function sameName(a, b) {
    const x = normName(a);
    const y = normName(b);
    return !!x && !!y && x === y;
  }

  // ───────────────────────── Finders ─────────────────────────

  /**
   * All comments inside `scope`. Returns [{ el, matched }].
   * Tries every selector (so mixed old/new layouts both work) and
   * de-duplicates wrappers that share the same data-id.
   */
  function findComments(scope) {
    const out = [];
    const seen = new Set();
    SELECTORS.comment.forEach((s, i) => {
      for (const el of safeQueryAll(scope, s.css)) {
        const rootEl = outerSameComment(el);
        if (seen.has(rootEl)) continue;
        seen.add(rootEl);
        out.push({ el: rootEl, matched: `comment#${i + 1} ${s.name}` });
      }
    });

    if (!out.length) {
      // Fallback: every "Reply to …" button outside a form marks a comment.
      for (const btn of safeQueryAll(scope, 'button[aria-label^="Reply to"]')) {
        if (btn.closest('form')) continue;
        const art = btn.closest('article') || (btn.parentElement && btn.parentElement.parentElement && btn.parentElement.parentElement.parentElement);
        if (!art || seen.has(art)) continue;
        seen.add(art);
        heuristicComments.add(art);
        out.push({ el: art, matched: 'comment#fallback parent of "Reply to…" button' });
      }
    }

    // Keep document order (parents before their replies).
    out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return out;
  }

  function getCommentAuthor(commentEl) {
    const r = ownFirst(commentEl, 'commentAuthor', (el) => cleanName(text(el)));
    if (r.el) return { value: cleanName(text(r.el)), matched: r.matched };
    // Fallback: aria-label="Reply to Priya Nair’s comment"
    const btn = findReplyButton(commentEl).el;
    const label = btn && btn.getAttribute('aria-label');
    const m = label && label.match(/^Reply to (.+?)(?:[’']s)? comment/i);
    if (m) return { value: cleanName(m[1]), matched: 'commentAuthor#fallback Reply button aria-label' };
    return { value: '', matched: null };
  }

  function getCommentHeadline(commentEl) {
    const r = ownFirst(commentEl, 'commentHeadline');
    return { value: r.el ? text(r.el).split('\n')[0] : '', matched: r.matched };
  }

  function getCommentText(commentEl) {
    const r = ownFirst(commentEl, 'commentText', (el) => text(el));
    if (r.el) return { value: stripSeeMore(text(r.el)), matched: r.matched, el: r.el };

    // Fallback: copy the comment, remove replies/header/buttons, read what's left.
    const clone = commentEl.cloneNode(true);
    clone.querySelectorAll(COMMENT_UNION).forEach((n) => n !== clone && n.remove());
    clone
      .querySelectorAll('button, form, time, img, svg, .csb-ra-slot, [class*="meta"], [class*="social-bar"], [contenteditable]')
      .forEach((n) => n.remove());
    return { value: stripSeeMore(text(clone)), matched: 'commentText#fallback comment text minus header/buttons', el: null };
  }

  function stripSeeMore(t) {
    return t.replace(/\s*…?\s*(see more|see less|…more)\s*$/i, '').trim();
  }

  /** Stable ID for a comment: LinkedIn's URN if present. */
  function getCommentId(commentEl) {
    const id = commentEl.getAttribute('data-id') || commentEl.getAttribute('data-urn') || '';
    return /urn:li:comment/.test(id) ? id : '';
  }

  /** LinkedIn's own Reply action for this comment. Never a submit/Post button. */
  function findReplyButton(commentEl) {
    const r = ownFirst(commentEl, 'replyButton', (el) => isSafeReplyAction(el));
    if (r.el) return r;
    const btn = safeQueryAll(commentEl, 'button').find(
      (b) => ownerComment(b) === commentEl && /^reply$/i.test(text(b)) && isSafeReplyAction(b)
    );
    return btn ? { el: btn, matched: 'replyButton#fallback button text "Reply"' } : { el: null, matched: null };
  }

  /**
   * Safety check before clicking anything: it must be a "Reply" *action*,
   * not a form submit / Post / Send / Like button.
   */
  function isSafeReplyAction(btn) {
    if (!btn || btn.closest('.csb-ra-slot, #csb-ra-panel')) return false;
    if (btn.closest('form')) return false; // submit buttons live inside the reply form
    if ((btn.getAttribute('type') || '').toLowerCase() === 'submit') return false;
    const cls = String(btn.className || '');
    if (/submit|send|post-button|like|react/i.test(cls)) return false;
    // Drop the commenter's name from "Reply to <Name>’s comment" before checking
    // for dangerous words, so a name like "Emily Post" can't confuse it.
    const label = `${btn.getAttribute('aria-label') || ''} ${text(btn)}`.replace(/reply to .+? comment/gi, 'reply to comment');
    if (/\b(post|send|submit|like|react|repost|share)\b/i.test(label)) return false;
    return /\breply\b/i.test(label);
  }

  function findSocialBar(commentEl) {
    const r = ownFirst(commentEl, 'socialBar');
    if (r.el) return r;
    const btn = findReplyButton(commentEl).el;
    if (btn && btn.parentElement) return { el: btn.parentElement, matched: 'socialBar#fallback parent of Reply button' };
    return { el: null, matched: null };
  }

  /** The post containing this comment. */
  function findPost(commentEl) {
    for (let i = 0; i < SELECTORS.post.length; i++) {
      let el = null;
      try {
        el = commentEl.closest(SELECTORS.post[i].css);
      } catch (_) {
        el = null;
      }
      if (el) return { el, matched: `post#${i + 1} ${SELECTORS.post[i].name}` };
    }
    return { el: document.body, matched: 'post#fallback whole page' };
  }

  function getPostAuthor(postEl) {
    const r = postFirst(postEl, 'postAuthor');
    return { value: r.el ? cleanName(text(r.el)) : '', matched: r.matched };
  }

  function getPostText(postEl) {
    const r = postFirst(postEl, 'postText');
    return { value: r.el ? stripSeeMore(text(r.el)) : '', matched: r.matched };
  }

  /** Visible reply editors inside `scope`, in document order. */
  function findEditors(scope) {
    const out = [];
    SELECTORS.editor.forEach((s, i) => {
      for (const el of safeQueryAll(scope, s.css)) {
        if (el.closest('#csb-ra-panel') || out.some((o) => o.el === el) || !isVisible(el)) continue;
        // Keep only the outermost editable element (editors can nest them).
        if (el.parentElement && el.parentElement.closest('[contenteditable="true"]')) continue;
        out.push({ el, matched: `editor#${i + 1} ${s.name}` });
      }
    });
    out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return out;
  }

  /** The last @mention inside an editor (LinkedIn adds one when replying to a reply). */
  function lastMention(editor) {
    for (const s of SELECTORS.mention) {
      const all = safeQueryAll(editor, s.css);
      // Ignore inner parts of a mention (keep only the outermost element).
      const outer = all.filter((x) => !all.some((y) => y !== x && y.contains(x)));
      if (outer.length) return outer[outer.length - 1];
    }
    return null;
  }

  function findLoadMore(scope) {
    const out = [];
    SELECTORS.loadMore.forEach((s, i) => {
      safeQueryAll(scope, s.css).forEach((el) => out.push({ el, matched: `loadMore#${i + 1} ${s.name}` }));
    });
    if (!out.length) {
      safeQueryAll(scope, 'button').forEach((b) => {
        if (/(load|show|see) (more|previous) (comments|replies)/i.test(text(b))) {
          out.push({ el: b, matched: 'loadMore#fallback button text' });
        }
      });
    }
    return out;
  }

  /**
   * DOM outline for the debug report: tags, classes, roles and data-* names,
   * but NO text content, so it's safe to paste to someone fixing selectors.
   */
  function skeleton(el, depth = 0, maxDepth = 9, lines = []) {
    if (!el || el.nodeType !== 1 || depth > maxDepth || lines.length > 160) return lines;
    if (el.classList && el.classList.contains('csb-ra-slot')) return lines;
    const attrs = [];
    if (el.id) attrs.push(`#${el.id}`);
    const cls = Array.from(el.classList || []).slice(0, 4);
    if (cls.length) attrs.push('.' + cls.join('.'));
    for (const a of Array.from(el.attributes || [])) {
      if (a.name === 'role' || a.name === 'type' || a.name === 'contenteditable') attrs.push(`[${a.name}="${a.value}"]`);
      else if (a.name === 'aria-label') attrs.push(`[aria-label="${a.value.split(/\s+/).slice(0, 2).join(' ')}…"]`);
      else if (a.name === 'aria-hidden') attrs.push('[aria-hidden]');
      else if (a.name.startsWith('data-')) attrs.push(`[${a.name}${/urn:li:\w+/.test(a.value) ? `="${a.value.match(/urn:li:\w+/)[0]}…"` : ''}]`);
    }
    lines.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${attrs.join('')}`);
    for (const child of Array.from(el.children)) skeleton(child, depth + 1, maxDepth, lines);
    return lines;
  }

  root.CSB_DOM = {
    SELECTORS,
    text,
    isVisible,
    ownerComment,
    findComments,
    getCommentAuthor,
    getCommentHeadline,
    getCommentText,
    getCommentId,
    findReplyButton,
    isSafeReplyAction,
    findSocialBar,
    findPost,
    getPostAuthor,
    getPostText,
    findEditors,
    lastMention,
    findLoadMore,
    cleanName,
    sameName,
    skeleton,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
