# ✦ CSB Reply Assistant

A Chrome extension that helps you reply to comments on your LinkedIn posts, in your own voice.

Open one of your posts and a small **✦ Reply** button appears under each comment. Click it and you get:

- the **type of comment** (lead, question, compliment, hiring, collab, disagreement, spam, other),
- a one-line summary of what the person is really saying,
- **3 reply options**: one warm and short, one that adds an insight, one that ends with a question,
- for leads, hiring and collab comments, a **suggested DM**.

Click **Use** and the reply is typed into LinkedIn's own reply box. Edit it if you like, then **you click Post**.

> **The extension never posts on its own.** It never clicks Post, Send or Like, never scrolls or loads more comments by
> itself, and never reads anything until you click ✦ Reply on a comment. It doesn't use the LinkedIn API and never sees
> your LinkedIn password.

---

## Contents

1. [Install (5 minutes)](#1-install-5-minutes)
2. [Get an API key](#2-get-an-api-key)
3. [Set it up](#3-set-it-up)
4. [Using it on LinkedIn](#4-using-it-on-linkedin)
5. [Try it without LinkedIn (test page)](#5-try-it-without-linkedin-test-page)
6. [Updating after new changes](#6-updating-after-new-changes)
7. [When LinkedIn changes its layout (fixing selectors)](#7-when-linkedin-changes-its-layout-fixing-selectors)
8. [Manual test checklist for LinkedIn](#8-manual-test-checklist-for-linkedin)
9. [Troubleshooting](#9-troubleshooting)
10. [Privacy and safety](#10-privacy-and-safety)
11. [For developers](#11-for-developers)

---

## 1. Install (5 minutes)

You don't need to install anything else. There is no build step.

1. **Download this folder.** On GitHub click the green **Code** button → **Download ZIP**, then unzip it. (Or `git clone` it
   if you use git.) Remember where the folder is. It's the one that contains `manifest.json`.
2. Open Chrome and go to **`chrome://extensions`** (type it into the address bar).
3. Turn on **Developer mode** (switch in the top-right corner).
4. Click **Load unpacked** (top-left).
5. Select the **CSB-Reply-Assistant** folder (the one with `manifest.json` inside) and click **Select**.
6. The extension appears in the list. Click the **puzzle-piece icon** in Chrome's toolbar and **pin** "CSB Reply Assistant"
   so its ✦ icon is always visible.
7. **Refresh any LinkedIn tabs** that were already open (press F5). Extensions only start in tabs opened or refreshed after
   installing.

## 2. Get an API key

The extension needs an API key from one AI provider. Pick one (you can switch any time). Each provider bills you
directly for what you use. Replying to comments costs very little: roughly a cent or less per comment, and less
with the faster "flash"/"mini" models.

| Provider | Where to get a key | Where to check current model names |
| --- | --- | --- |
| **Anthropic (Claude)** | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys): sign in → **Create Key**. Add credit under Billing. Key starts with `sk-ant-`. | [Models overview](https://platform.claude.com/docs/en/models/overview) |
| **Google (Gemini)** | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey): sign in with Google → **Create API key**. Has a free tier with limits. Key usually starts with `AIza`. | [Gemini models](https://ai.google.dev/gemini-api/docs/models) |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys): sign in → **Create new secret key**. Add credit under Billing. Key starts with `sk-`. | [OpenAI models](https://platform.openai.com/docs/models) |

Treat the key like a password: don't paste it in chats, emails or documents.

### About model names

Model names change over time, so the model is a text field in settings, not hard-coded. Defaults:

| Provider | Default model (change it in settings) |
| --- | --- |
| Anthropic | `claude-sonnet-5-5` |
| Gemini | `gemini-3.5-flash` |
| OpenAI | `gpt-5.4-mini` |

If a default stops working (**Test connection** says the model wasn't recognised), open the "check current model names"
link for your provider (also shown under the model field in settings), copy the exact model ID and paste it in.
Faster/cheaper models ("flash", "mini", "haiku") are plenty for short replies.

## 3. Set it up

Click the ✦ icon in the toolbar to open settings. Everything saves automatically.

1. **AI provider**: choose Anthropic, Gemini or OpenAI.
2. **API key**: paste your key. (Each provider keeps its own key, so switching providers doesn't lose them.) Use
   **Show / Hide** to check it.
3. **Model name**: leave the default, or paste a current model ID. **Default** resets it.
4. Click **Test connection**. You should see "✓ Connected…". If not, the exact error from the provider is shown.
5. Click **Try a sample comment** to see the kind of replies you'll get, using a built-in example lead comment. No
   LinkedIn needed.
6. **Your voice**:
   - **Voice profile**: who you are and how you sound. The AI only uses facts about you from this box, so add anything
     you'd like it to be able to mention (series names, services, cities…).
   - **Default tone**: Friendly / Professional / Witty.
   - **Length**: Short (1–2 sentences) or Medium (2–3).
   - **Allow emojis**: max one per reply when on, none when off.
   - **Banned phrases**: one per line. The AI is told never to use them, and any option that slips one in gets a ⚠
     warning.
7. **On LinkedIn**:
   - **Your LinkedIn name**: exactly as it appears on your profile (e.g. `Shahran Ahmed`). This is how the extension
     knows which posts are yours and which replies in a thread are yours.
   - **Only show buttons on my own posts**: on by default. Turn it off to get ✦ Reply on any post.
   - **Debug mode**: see [section 7](#7-when-linkedin-changes-its-layout-fixing-selectors).

## 4. Using it on LinkedIn

1. Open one of your posts (from your profile's Activity, a notification, or the feed) and open its comments.
2. Under each comment you'll see **✦ Reply** next to LinkedIn's own Like | Reply. (It isn't shown on your own comments.)
3. Click **✦ Reply**. A small panel opens next to it:
   - a **category badge** and a one-line **summary**,
   - **3 options**, each with **Use** and **Copy**,
   - a **Suggested DM** with **Copy DM**, for leads, hiring and collab comments,
   - an **instruction box**: type something like `make it funnier` or `mention our Beyond Places series` and press
     Enter or **↻ Regenerate** for fresh options that follow it. Regenerate also avoids repeating earlier options.
4. Click **Use** on the one you like. The extension clicks LinkedIn's **Reply** link (never Post) to open the reply box,
   types the text in and leaves the cursor at the end. If you're replying inside a thread, LinkedIn's @mention is kept.
5. Edit if you want, then **click LinkedIn's Post/Reply button yourself**.

Handy extras:

- **Alt+R** opens the assistant for the comment that's focused, or the one closest to the middle of the screen.
- **Esc** or clicking anywhere outside closes the panel.
- If typing into LinkedIn's box ever fails, the reply is **copied** instead. Click Reply on the comment and paste
  (Ctrl+V / Cmd+V). Every option also has its own **Copy** button.
- **Spam** gets a single "no reply needed" suggestion instead of reply options.
- A small **✓** appears next to ✦ Reply on comments you've already generated replies for (remembered in this browser).
- **Reply queue**: click the ✦ toolbar icon → **Reply queue** tab. It lists comments on the open post that don't
  have a reply from you yet. **Show** scrolls that comment into view so you can click ✦ Reply. It only lists comments
  already loaded on the page; to include more, click LinkedIn's "Load more comments" yourself and press **Refresh**.

## 5. Try it without LinkedIn (test page)

`test/mock-linkedin.html` is a fake LinkedIn post page with comments, a reply thread, a Hinglish comment, a
disagreement, spam, a hiring comment and a "Load more comments" button.

- **Double-click** `test/mock-linkedin.html` (or drag it into a Chrome tab). No login and no API key are needed.
- It uses the real extension code but **canned answers** (no AI is called). A yellow "Mock controls" box lets you
  simulate errors (missing key, wrong model, rate limit, network failure, bad JSON), turn on debug mode and dark mode,
  and see **the exact prompt** that would be sent to the AI.
- The "Post/Reply submits" counter must stay at 0 unless *you* click LinkedIn's Reply button on the page. That's the
  proof that the extension never posts.

To try real AI answers without LinkedIn, use **Try a sample comment** in settings.

## 6. Updating after new changes

When you download or pull a new version of this folder:

1. Go to **`chrome://extensions`**.
2. Find **CSB Reply Assistant** and click its **reload icon** (circular arrow).
3. **Refresh your LinkedIn tabs** (F5).

Your settings and API keys are kept. If you downloaded a fresh ZIP into a *different* folder, click **Remove** on the
old one, then **Load unpacked** the new folder. (Removing the extension deletes its saved settings and keys, so you'd
paste your key again.)

If a panel says *"The extension was reloaded or updated. Refresh this LinkedIn tab"*, just press F5.

## 7. When LinkedIn changes its layout (fixing selectors)

LinkedIn changes its page structure from time to time. When that happens you might see no ✦ Reply buttons, buttons on
the wrong posts, or **Use** falling back to Copy. All the "how to find things on the page" rules live in one file,
[`src/content/selectors.js`](src/content/selectors.js). Each item has 3–4 fallbacks, from most stable (data attributes,
aria-labels) to least.

**To see what's going on:**

1. Open settings → turn on **Debug mode**. (Open LinkedIn tabs update straight away.)
2. On your post you'll now see:
   - a **purple dashed outline** around each detected comment where a button is shown,
   - an **orange outline** where a comment was detected but skipped, with the reason (e.g. "your own comment",
     "post by someone else, not you", "post author not found"),
   - a small label like `comment#1 · author #1 · text #1 · reply #1`. The numbers say which fallback in
     `selectors.js` matched. `NOT FOUND` means none did,
   - a purple **"CSB debug" pill** in the bottom-left with counts and a **Copy debug report** button.
3. For more detail, open Chrome DevTools (**right-click the page → Inspect → Console tab**) and look for lines starting
   with `[CSB Reply]`. There's a summary table of every comment and which selector matched.

**What to send to whoever maintains the extension (or to Claude) if something breaks:**

1. Click **Copy debug report** in the pill and paste it. It contains selector matches and an outline of the page
   structure (tag and class names only). It has **no comment text and no names**.
2. If a specific comment misbehaves: **right-click that comment → Inspect**. In the Elements panel, find the
   `<article …>` line that wraps the whole comment (hovering highlights it on the page), **right-click it → Copy → Copy
   outerHTML**, and paste that too. (This one does include the comment's text, so pick a comment you're happy to share.)
3. If the problem is with *Use*, click LinkedIn's own Reply on that comment, right-click inside the reply box →
   **Inspect**, and copy the outerHTML of the element with `contenteditable="true"` the same way.
4. Say what you expected and what happened (e.g. "no button under replies", "buttons on other people's posts", "Use
   copied instead of typing").

**Fixing it yourself:** in `selectors.js`, find the list for the broken part (e.g. `commentAuthor`) and add a new
`{ name, css }` line near the top with a CSS selector that matches the new layout. Save, then reload the extension and
refresh LinkedIn ([section 6](#6-updating-after-new-changes)).

Note: the selectors assume LinkedIn is set to **English** (they look for labels like "Reply to …").

## 8. Manual test checklist for LinkedIn

Do these once after installing (and after LinkedIn looks different), with **Debug mode on** the first time:

**Buttons**

- [ ] Open one of **your** posts that has comments. Every comment by someone else shows **✦ Reply**, including replies
      inside threads. Your own comments don't.
- [ ] Open someone else's post: no ✦ buttons (with "Only show buttons on my own posts" on).
- [ ] Click LinkedIn's **Load more comments** / **Load previous replies**: the new comments get ✦ Reply within a second.
- [ ] Scroll around and open/close comments: no duplicate ✦ buttons.

**Panel**

- [ ] Click ✦ Reply: loading spinner, then a category, summary and 3 options. For a lead-type comment, a Suggested DM.
- [ ] Replies mention something specific from the comment, don't quote prices, and contain none of your banned phrases.
- [ ] Type an instruction (e.g. `make it funnier`) → Regenerate → new options that follow it.
- [ ] Esc closes the panel. Clicking outside closes it. Alt+R opens it for the comment in view.
- [ ] Light and dark mode (LinkedIn → Me → Settings → Display) both look right.

**Inserting**

- [ ] Click **Use** on a top-level comment: LinkedIn's reply box opens with the text in it and the cursor at the end.
      LinkedIn's Post/Reply button becomes clickable (so LinkedIn "saw" the text). **Nothing is posted.**
- [ ] Click **Use** on a reply inside a thread: LinkedIn's @mention of that person stays, followed by the text.
- [ ] Edit the text, then post it yourself. It posts normally.
- [ ] **Copy** and **Copy DM** put the text on the clipboard.

**Errors**

- [ ] Temporarily change the model name to `wrong-model` → ✦ Reply shows a clear "model name wasn't recognised" error
      with **Open settings**. Change it back.
- [ ] Remove the key → "No API key saved" error. Paste it back.

**If something fails:** turn on Debug mode, click **Copy debug report**, and send it with the outerHTML described in
[section 7](#7-when-linkedin-changes-its-layout-fixing-selectors).

## 9. Troubleshooting

| What you see | What to do |
| --- | --- |
| No ✦ buttons at all | Refresh the tab (F5). Make sure the comments are open. Check **Your LinkedIn name** matches your profile exactly, or turn off "Only show buttons on my own posts" to test. Then use Debug mode (section 7). |
| "No API key saved…" | Click the ✦ icon and paste a key for the selected provider. |
| "…rejected the API key" | The key is wrong, revoked, or for a different provider. Create a new key. |
| "The model name … wasn't recognised" | Check the current model ID at your provider's models page (section 2) and paste it into **Model name**. |
| "rate limit reached" | Wait a minute and try again. |
| "quota or credit has run out" / "needs credit" | Add credit / check billing on your provider account. |
| "Couldn't reach …" | Check your internet connection, VPN or firewall. |
| "…wasn't in the expected format" | Click **Regenerate**. If it keeps happening, try a different model. |
| "The extension was reloaded…" | Refresh the LinkedIn tab (F5). |
| Use copied the text instead of typing it | LinkedIn's reply box may have changed. Paste it with Ctrl/Cmd+V, and see section 7. |

## 10. Privacy and safety

- **Your API key** is stored only in Chrome's extension storage on this computer (`chrome.storage.local`). It's only ever
  sent to the provider you chose, in the request header. It's never logged, never shown to LinkedIn's page, and never
  written to any file in this folder.
- **What is sent to the AI**, and only when you click ✦ Reply or Regenerate: the post text and author name, the comment
  you clicked (name, headline, text), the other comments in that same thread, your voice profile and settings, and your
  one-line instruction. Nothing else from the page.
- **What is stored locally**: your settings, and the IDs of comments you've generated replies for (for the ✓ marks). No
  comment text is stored.
- **What the extension never does**: post, reply, like, send, click LinkedIn's Post/Send buttons, scroll the feed on its
  own, open pages, load more comments, run in the background, use the LinkedIn API, or touch your LinkedIn login. (The
  one scroll it does is when *you* click **Show** in the Reply queue.)
- **Permissions**: `storage`, plus access to `www.linkedin.com` and the three AI API domains only.
- The git repo ignores `.env`, key and secret files, and a test checks that no key-shaped strings are ever committed.

## 11. For developers

No build step, no bundler, no npm dependencies: plain Manifest V3 JavaScript, HTML and CSS.

```
manifest.json
icons/                         toolbar/extension icons
src/shared/defaults.js         default settings, provider info (model defaults, links)
src/shared/prompt.js           system + user prompt builder, safe JSON parser
src/background/providers.js    callAnthropic / callGemini / callOpenAI → same { text, finishReason } shape + error mapping
src/background/service-worker.js  message handlers: generate, testConnection, settings, ✓ marks; only place AI is called
src/content/selectors.js       ALL LinkedIn DOM selectors (with fallbacks) + finder helpers
src/content/content.js         observer, ✦ buttons, panel, insertion, Alt+R, debug mode, reply queue
src/content/panel.css          styles, all scoped to #csb-ra-panel / .csb-ra-*
src/popup/                     settings + reply queue (also used as the options page)
test/mock-linkedin.html        fake LinkedIn page (real class names) for manual testing
test/mock-extension.js         fake extension bridge with canned answers, used only by the mock page
test/unit.test.js              unit tests
```

Unit tests need Node 18+ and nothing else:

```
node --test test/unit.test.js
```

They cover the prompt builder, the JSON parser (fences, chatter, bad JSON), the request format for each provider,
error mapping, key redaction, the manifest's permissions, and a scan for accidentally committed keys.

Message flow: content script → `chrome.runtime.sendMessage({ type: 'csb:generate', context })` → service worker builds
the prompt, calls the provider with the stored key, parses the JSON → returns
`{ category, summary, replies[], dm_draft, warnings[] }` to the panel. The content script never sees the API key.
