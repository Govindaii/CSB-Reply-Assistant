/*
 * Fake extension bridge for test/mock-linkedin.html.
 *
 * When the page is opened directly (no extension runtime), content.js uses
 * globalThis.CSB_MOCK_EXT instead of chrome.runtime. It answers the same
 * messages as the real service worker, but with canned replies: NO API
 * calls, no key needed. The prompt that WOULD be sent is built with the
 * real src/shared/prompt.js and shown on the page.
 */
(function () {
  'use strict';

  const CSB = globalThis.CSB;
  const $ = (id) => document.getElementById(id);
  const listeners = [];
  const generated = {};

  function fullSettings() {
    return CSB.mergeSettings({
      profileName: $('mock-profile') ? $('mock-profile').value : 'Shahran Ahmed',
      onlyMyPosts: $('mock-only-mine') ? $('mock-only-mine').checked : true,
      debug: $('mock-debug') ? $('mock-debug').checked : false,
      emojis: false,
    });
  }

  function publicSettings() {
    const s = CSB.publicSettings(fullSettings());
    return { ...s, model: 'mock (canned answers, no AI)', hasKey: true };
  }

  // ───────────────────────── canned answers ─────────────────────────

  const HINGLISH = /\b(bhai|hai|kya|kitna|yaar|accha|nahi|toh|banane|mein|kaunse|haan|laga)\b/i;

  function classify(text) {
    const t = text.toLowerCase();
    if (/check my profile|10x|followers|dm me for|promo/.test(t)) return 'spam';
    if (/price|cost|budget|rate|quote|how much/.test(t)) return 'lead';
    if (/hiring|intern|job|opening|vacanc/.test(t)) return 'hiring';
    if (/podcast|collab|partner|feature you|episode/.test(t)) return 'collab';
    if (/respectfully|disagree|undersell|not sure i agree|overrated/.test(t)) return 'disagreement';
    if (t.includes('?')) return 'question';
    return 'compliment';
  }

  function canned(category, fn, hinglish) {
    const F = fn || 'there';
    if (hinglish) {
      return {
        summary: 'Asks (in Hinglish) how long the film took and which tools were used.',
        replies: [
          `Haha thanks ${F}! Ek hafte mein 70% ban gaya tha, baaki time direction mein gaya.`,
          'Tools fast hain, par pause aur edit ka rhythm set karne mein hi asli time lagta hai.',
          'Sach bolun toh tools se zyada taste pe kaam hota hai. Tum kis type ka project soch rahe ho?',
        ],
      };
    }
    const sets = {
      lead: {
        summary: 'Wants a similar film for an upcoming launch and is asking about cost.',
        replies: [
          `${F}, that pause is my favourite frame too. Sending you a DM so we can talk about your launch properly.`,
          'The feel comes from giving the edit room to breathe, and that works just as well at 30 seconds. Happy to walk you through it over DM.',
          "Love that you noticed the pause. What's the one feeling you want people left with after your launch film?",
        ],
        dm_draft: `Hi ${F}, thanks for the kind words on the tea film! Your launch sounds exciting. Would you be up for a quick 15-minute call this week so I can understand the product and the feeling you're after?`,
      },
      question: {
        summary: 'Asks a genuine question about how the film was made.',
        replies: [
          `Good question ${F}. Short answer: the tools did the heavy lifting, the direction did the rest.`,
          'Most of the time went into rhythm: where to hold a shot and where to cut. That part no tool decides for you.',
          'Happy to break it down further. Which part are you most curious about, the shoot or the edit?',
        ],
      },
      compliment: {
        summary: 'Praises the film, especially a specific moment.',
        replies: [
          `Thank you ${F}, the pour shot took the longest to get right.`,
          'Honestly the edit is where it came together. The tools gave us shots, the rhythm gave us the film.',
          'Means a lot. Which moment stayed with you the most?',
        ],
      },
      disagreement: {
        summary: 'Thinks the "AI-native" label undersells the people doing the work.',
        replies: [
          `Fair point ${F}, the humans are the whole story here. "AI-native" is about how we work, not who does the work.`,
          "I'd push back a little: the label says the tools are native to our process, while the taste stays very human. That's the part I care about.",
          'Maybe the term needs work. What would you call a studio where directors lead and AI does the heavy lifting?',
        ],
      },
      hiring: {
        summary: 'A student asking about internships at the studio.',
        replies: [
          `Love the energy ${F}. Drop me a DM with your reel and I'll take a proper look.`,
          'What I look for in juniors is taste in the edit more than tool skills, so lead with your best cut.',
          'What kind of work do you want to be doing a year from now?',
        ],
        dm_draft: `Hi ${F}, thanks for reaching out under the post. Send over your reel or two pieces you're proudest of, and if there's a fit let's jump on a quick call.`,
      },
      collab: {
        summary: 'Invites the author onto a podcast about craft vs tools.',
        replies: [
          `${F}, a chat on craft vs tools sounds great. Let's take this to DMs.`,
          'Happy to talk about the direction side, since that is the part most people skip when they talk about AI films.',
          "Sounds fun. What's the angle you have in mind for the episode?",
        ],
        dm_draft: `Hi ${F}, thanks for the invite! A conversation on craft vs tools sounds right up my street. Could we do a quick call this week to shape the episode?`,
      },
      spam: {
        summary: 'Generic self-promotion unrelated to the post.',
        replies: ['No reply needed: this looks like self-promotion.'],
      },
    };
    return sets[category] || sets.compliment;
  }

  function mockGenerate(msg) {
    const settings = fullSettings();
    const prompt = CSB.prompt.buildPrompt({
      settings,
      context: msg.context,
      instruction: msg.instruction,
      previousReplies: msg.previousReplies,
    });
    if ($('mock-prompt')) $('mock-prompt').textContent = `SYSTEM:\n${prompt.system}\n\nUSER:\n${prompt.user}`;

    const mode = $('mock-mode') ? $('mock-mode').value : 'success';
    const errors = {
      missing_key: { kind: 'missing_key', message: 'No API key saved for Anthropic. Click the extension icon and paste your key.' },
      model: {
        kind: 'model',
        message: 'The model name “claude-wrong-1” wasn\'t recognised by Anthropic. Check the model name in settings.',
        detail: 'model: claude-wrong-1',
      },
      rate_limit: {
        kind: 'rate_limit',
        message: 'Anthropic rate limit reached. Wait a minute and try again.',
        detail: 'Number of request tokens has exceeded your per-minute rate limit',
      },
      network: { kind: 'network', message: "Couldn't reach Anthropic. Check your internet connection.", detail: 'Failed to fetch' },
    };
    if (errors[mode]) return { ok: false, error: errors[mode], meta: { provider: 'mock', model: 'mock' } };

    const c = msg.context.comment || {};
    const category = classify(c.text || '');
    const fn = CSB.prompt.firstName(c.author);
    const base = canned(category, fn, HINGLISH.test(c.text || ''));
    const round = Math.floor((msg.previousReplies || []).length / 3) + 1;
    const suffix = round > 1 ? ` [mock regenerate #${round}${msg.instruction ? `: ${msg.instruction}` : ''}]` : msg.instruction ? ` [mock: ${msg.instruction}]` : '';
    const answer = {
      category,
      summary: base.summary,
      replies: base.replies.map((r) => r + suffix),
      dm_draft: base.dm_draft || '',
    };
    // Real models sometimes wrap JSON in code fences; the parser handles it.
    const raw = mode === 'bad_json' ? 'Sorry, I am not able to help with that.' : '```json\n' + JSON.stringify(answer) + '\n```';

    try {
      const result = CSB.prompt.parseReplyJson(raw);
      const banned = CSB.prompt.bannedList(settings);
      result.warnings = result.replies.map((r) => CSB.prompt.findBannedPhrases(r, banned));
      return { ok: true, result, meta: { provider: 'mock', model: 'mock (canned answers, no AI)', ms: 0 } };
    } catch (err) {
      return { ok: false, error: { kind: err.kind, message: err.message, detail: err.detail }, meta: {} };
    }
  }

  // ───────────────────────── the bridge ─────────────────────────

  globalThis.CSB_MOCK_EXT = {
    isMock: true,
    async send(msg) {
      const type = msg && msg.type;
      if (type === 'csb:getPublicSettings') return { ok: true, settings: publicSettings() };
      if (type === 'csb:generate') {
        const mode = $('mock-mode') ? $('mock-mode').value : 'success';
        await new Promise((r) => setTimeout(r, mode === 'slow' ? 3000 : 600));
        return mockGenerate(msg);
      }
      if (type === 'csb:markGenerated') {
        generated[msg.key] = Date.now();
        return { ok: true };
      }
      if (type === 'csb:getGenerated') {
        return { ok: true, keys: (msg.keys || []).filter((k) => generated[k]) };
      }
      if (type === 'csb:openSettings') {
        alert('On LinkedIn this opens the extension settings page.');
        return { ok: true };
      }
      return { ok: false, error: { kind: 'other', message: `Mock bridge: unknown message ${type}` } };
    },
    onMessage(fn) {
      listeners.push(fn);
    },
    /** Used by the mock controls, like the real worker's settings broadcast. */
    broadcastSettings() {
      listeners.forEach((fn) => fn({ type: 'csb:settingsChanged', settings: publicSettings() }));
    },
  };
})();
