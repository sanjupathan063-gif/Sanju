/* ============================================================
   SANJU — app.js
   চ্যাট, ভয়েস, ফোন কন্ট্রোল, অ্যালার্ম, ফ্ল্যাশলাইট, নোট,
   স্মৃতি (মেমোরি), রিমাইন্ডার, লোকাল কুইক-আনসার — সব এখানে।
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Capacitor plugin refs ---------- */
  const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const PhoneControl = Plugins.PhoneControl || null;
  const VoiceInput = Plugins.VoiceInput || null;
  const SanjuTts = Plugins.SanjuTts || null;
  const Geolocation = Plugins.Geolocation || null;
  const Share = Plugins.Share || null;

  /* ---------- Storage keys ---------- */
  const LS = {
    settings: "sanju_settings",
    history: "sanju_history",
    notes: "sanju_notes",
    memories: "sanju_memories",
    summary: "sanju_summary",
  };

  const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

  const MAX_HISTORY_EXCHANGES = 10; // দ্রুত উত্তরের জন্য সাম্প্রতিক ১০টি এক্সচেঞ্জ

  /* ---------- State ---------- */
  let settings = loadJSON(LS.settings, {
    apiKey: "",
    userName: "বস",
    model: "openai/gpt-oss-20b",
    voiceLang: "auto",
    geminiTtsKey: "",
    youtubeKey: "",
  });
  if (!settings.model || settings.model === "openai/gpt-oss-120b") { settings.model = "openai/gpt-oss-20b"; try { localStorage.setItem("sanju_settings", JSON.stringify(settings)); } catch (e) {} }
  let history = loadJSON(LS.history, []); // [{role:'user'|'assistant', content:'...'}]
  let notes = loadJSON(LS.notes, []);
  let memories = loadJSON(LS.memories, []);
  let summary = loadJSON(LS.summary, ""); // পুরনো কথোপকথনের রোলিং সারাংশ — দীর্ঘমেয়াদী প্রসঙ্গ
  let pendingSms = null; // {number, message} — কনফার্মেশনের অপেক্ষায়
  let isRecording = false;
  let isThinking = false;

  /* ---------- DOM refs ---------- */
  const $ = (id) => document.getElementById(id);
  const chatLog = $("chatLog");
  const chatInput = $("chatInput");
  const sendBtn = $("sendBtn");
  const micBtn = $("micBtn");
  const orb = $("orb");
  const orbState = $("orbState");
  const statusLine = $("statusLine");
  const greetingText = $("greetingText");
  const userNameEl = $("userName");
  const energyLabel = $("energyLabel");
  const energyPill = $("energyPill");
  const batteryValue = $("batteryValue");
  const networkValue = $("networkValue");

  /* ============================================================
     ইউটিলিটি
     ============================================================ */
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage full/blocked — চুপচাপ ইগনোর */
    }
  }
  function saveSettings() { saveJSON(LS.settings, settings); }
  function saveHistory() { saveJSON(LS.history, history); }
  function saveNotes() { saveJSON(LS.notes, notes); }
  function saveMemories() { saveJSON(LS.memories, memories); }

  const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
  function toEnglishDigits(str) {
    return String(str).replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function isOnline() {
    return typeof navigator.onLine === "boolean" ? navigator.onLine : true;
  }

  /* ============================================================
     চ্যাট UI
     ============================================================ */
  function addMessage(role, text, opts) {
    opts = opts || {};
    const div = document.createElement("div");
    div.className = "msg " + (role === "user" ? "user" : "bot");
    div.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;

    if (!opts.skipHistory) {
      history.push({ role: role === "user" ? "user" : "assistant", content: text });
      trimHistoryIfNeeded();
      saveHistory();
    }
    return div;
  }

  function trimHistoryIfNeeded() {
    const maxLen = MAX_HISTORY_EXCHANGES * 2;
    if (history.length > maxLen) {
      const removed = history.slice(0, history.length - maxLen);
      history = history.slice(history.length - maxLen);
      updateSummary(removed); // ব্যাকগ্রাউন্ডে চলবে, রেজাল্টের জন্য অপেক্ষা করে না
    }
  }

  /* পুরনো কথোপকথন থেকে রোলিং সারাংশ বানানো — যাতে ২৪ এক্সচেঞ্জের বাইরেও
     গুরুত্বপূর্ণ প্রসঙ্গ (নাম, পছন্দ, চলমান বিষয়) মনে থাকে। ব্যর্থ হলে চুপচাপ স্কিপ। */
  async function updateSummary(removedMsgs) {
    if (!settings.apiKey || !isOnline() || !removedMsgs || !removedMsgs.length) return;
    try {
      const convoText = removedMsgs
        .map((m) => (m.role === "user" ? "ব্যবহারকারী: " : "সাঞ্জু: ") + m.content)
        .join("\n");
      const sys =
        "তুমি একটা সংক্ষিপ্তকরণ সহকারী। আগের সারাংশ আর নতুন কথোপকথন মিলিয়ে একটাই ছোট বাংলা " +
        "সারাংশ বানাও (সর্বোচ্চ ৫-৬ বাক্যে) — শুধু ব্যবহারকারী সম্পর্কে বা ভবিষ্যতে প্রাসঙ্গিক হতে " +
        "পারে এমন তথ্য রাখো, খুঁটিনাটি বাদ দাও। শুধু সারাংশ টেক্সট লিখবে, অন্য কিছু না।";
      const userMsg = (summary ? `আগের সারাংশ: ${summary}\n\n` : "") + `নতুন কথোপকথন:\n${convoText}`;

      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + settings.apiKey },
        body: JSON.stringify({
          model: settings.model || "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userMsg },
          ],
          temperature: 0.3,
          max_tokens: 220,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newSummary = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content.trim()
        : "";
      if (newSummary) {
        summary = newSummary;
        saveJSON(LS.summary, summary);
      }
    } catch (e) {
      /* সারাংশ ব্যর্থ হলে কিছু হয় না, চ্যাট স্বাভাবিকভাবে চলতে থাকে */
    }
  }

  function showTyping() {
    const div = document.createElement("div");
    div.className = "msg bot typing";
    div.id = "typingIndicator";
    div.innerHTML = '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>';
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function hideTyping() {
    const el = $("typingIndicator");
    if (el) el.remove();
  }

  function setOrbState(text, mode) {
    orbState.textContent = text;
    statusLine.textContent = text;
    orb.classList.remove("idle", "listening", "thinking");
    if (mode) orb.classList.add(mode);
  }

  /* ============================================================
     TTS — fallback chain: বাংলা → হিন্দি → ইংরেজি
     ============================================================ */
  let voicesCache = [];
  function refreshVoices() {
    if (window.speechSynthesis) {
      voicesCache = window.speechSynthesis.getVoices() || [];
    }
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
    refreshVoices();
  }

  function pickVoice(langPref) {
    if (!voicesCache.length) refreshVoices();
    const chain =
      langPref === "hi-IN" ? ["hi-IN", "en-IN", "en-US"] :
      langPref === "en-IN" ? ["en-IN", "en-US", "en-GB"] :
      langPref === "bn-BD" ? ["bn-BD", "bn-IN", "hi-IN", "en-IN", "en-US"] :
      ["bn-BD", "bn-IN", "hi-IN", "en-IN", "en-US"]; // auto

    for (const code of chain) {
      const v = voicesCache.find((v) => v.lang === code);
      if (v) return v;
    }
    for (const code of chain) {
      const v = voicesCache.find((v) => v.lang && v.lang.startsWith(code.split("-")[0]));
      if (v) return v;
    }
    return voicesCache[0] || null;
  }

  /* মার্কডাউন চিহ্ন (**, *, _, `, #, [লিংক](url)) সরিয়ে দেয় — না হলে TTS
     "তারা চিহ্ন" ইত্যাদি পড়ে ফেলে */
  function stripMarkdown(text) {
    return String(text)
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^[-*•]\s+/gm, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .trim();
  }

  /* লম্বা লেখা ছোট ছোট টুকরায় ভাগ করে (বাক্যের মাঝে না কেটে) — কোনো অংশ বাদ যায় না */
  function chunkForSpeech(text, maxLen) {
    maxLen = maxLen || 450;
    const sentences = text.split(/(?<=[।.!?])\s+/);
    const chunks = [];
    let current = "";
    function splitLong(s) {
      let piece = "";
      s.split(/\s+/).forEach((w) => {
        if ((piece + " " + w).trim().length > maxLen) {
          if (piece) chunks.push(piece.trim());
          piece = w;
        } else {
          piece = (piece + " " + w).trim();
        }
      });
      return piece;
    }
    sentences.forEach((s) => {
      if (!s) return;
      if ((current + " " + s).trim().length <= maxLen) {
        current = (current + " " + s).trim();
        return;
      }
      if (current) { chunks.push(current); current = ""; }
      current = s.length > maxLen ? splitLong(s) : s;
    });
    if (current) chunks.push(current.trim());
    return chunks.length ? chunks : [text];
  }

  /* ============================================================
     ভয়েস ইঞ্জিন — সবসময় একই Gemini ভয়েস (Kore)।
     • ব্যর্থ হলে আগে রিট্রাই করে, তারপরই শুধু ডিভাইসের ভয়েসে নামে
     • পরের টুকরোটা আগে থেকে লোড হয়, তাই মাঝখানে ফাঁক কম
     • একবারে একটাই ভয়েস — নতুন পালা শুরু হলে আগেরটা সাথে সাথে থামে
     ============================================================ */
  const GEMINI_TTS_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent";
  const GEMINI_VOICE = "Kore";

  let activeAudio = null;
  let speechSession = 0;
  let speechQueue = [];
  let speechBusy = false;
  let upcomingItem = null;
  let voiceNoticeShown = false;
  let speechEngineForTurn = "undecided"; // একটি উত্তরের সব বাক্যে একই voice engine lock

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setSpeakingUI(on) {
    orb.classList.toggle("speaking", on);
    if (on) {
      orbState.textContent = "বলছি...";
      statusLine.textContent = "বলছি...";
    } else if (!isThinking && !isRecording) {
      orbState.textContent = "প্রস্তুত আছি";
      statusLine.textContent = "প্রস্তুত আছি";
    }
  }

  function stopSpeaking() {
    if (activeAudio) {
      try { activeAudio.pause(); } catch (e) {}
      activeAudio = null;
    }
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (SanjuTts) {
      try { SanjuTts.stop(); } catch (e) {}
    }
    setSpeakingUI(false);
  }

  function newSpeechTurn() {
    stopSpeaking();
    if (upcomingItem) {
      upcomingItem.promise
        .then((p) => { if (p && p.url) URL.revokeObjectURL(p.url); })
        .catch(() => {});
    }
    upcomingItem = null;
    speechSession++;
    speechQueue = [];
    speechBusy = false;
    speechEngineForTurn = "undecided";
    return speechSession;
  }

  function pcmBase64ToWavBlob(base64, sampleRate) {
    sampleRate = sampleRate || 24000;
    const binary = atob(base64);
    const len = binary.length;
    const pcmBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) pcmBytes[i] = binary.charCodeAt(i);

    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, pcmBytes.length, true);

    return new Blob([header, pcmBytes], { type: "audio/wav" });
  }

  async function fetchGeminiBlobUrl(text) {
    const res = await fetch(GEMINI_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.geminiTtsKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
        },
      }),
    });
    if (!res.ok) {
      const err = new Error("gemini tts http " + res.status);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const part = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0];
    const b64 = part && part.inlineData && part.inlineData.data;
    if (!b64) throw new Error("gemini tts empty response");
    return URL.createObjectURL(pcmBase64ToWavBlob(b64, 24000));
  }

  /* দ্রুত TTS: সর্বোচ্চ একটি সংক্ষিপ্ত retry; পুরো turn-এ একই engine lock */
  async function fetchGeminiWithRetry(text, session) {
    if (session !== speechSession) return null;
    try {
      return await fetchGeminiBlobUrl(text);
    } catch (e) {
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable || session !== speechSession) throw e;
      await sleep(250);
      if (session !== speechSession) return null;
      return await fetchGeminiBlobUrl(text);
    }
  }

  async function prepareChunk(text, session) {
    if (speechEngineForTurn === "native") return { kind: "native", text, reason: "locked" };
    if (!settings.geminiTtsKey || !isOnline()) {
      speechEngineForTurn = "native";
      return { kind: "native", text, reason: settings.geminiTtsKey ? "offline" : "nokey" };
    }
    try {
      const url = await fetchGeminiWithRetry(text, session);
      if (!url) return { kind: "cancelled" };
      speechEngineForTurn = "gemini";
      voiceNoticeShown = false;
      return { kind: "gemini", url };
    } catch (e) {
      console.warn("SANJU: Gemini TTS failed —", e && e.message);
      if (speechEngineForTurn === "gemini") {
        // একটি turn-এ Gemini শুরু হয়ে গেলে native robot voice-এ switch করব না।
        return { kind: "skip", reason: "gemini-chunk-failed" };
      }
      speechEngineForTurn = "native";
      return { kind: "native", text, reason: "error", status: e && e.status };
    }
  }

  function noticeForFallback(p) {
    if (voiceNoticeShown || p.reason === "offline") return;
    voiceNoticeShown = true;
    let msg;
    if (p.reason === "nokey") {
      msg = "(সেটিংসে Gemini API key বসালে আমি আসল ভয়েসে কথা বলব। এখন ডিভাইসের ভয়েসে বলছি।)";
    } else if (p.status === 429) {
      msg = "(Gemini-র ফ্রি লিমিট এই মুহূর্তে শেষ, কিছুক্ষণ পরে ঠিক হয়ে যাবে। ততক্ষণ ডিভাইসের ভয়েসে বলছি।)";
    } else if (p.status === 400 || p.status === 401 || p.status === 403) {
      msg = "(Gemini key-টা কাজ করছে না — সেটিংসে গিয়ে key ঠিক আছে কিনা দেখো। এখন ডিভাইসের ভয়েসে বলছি।)";
    } else {
      msg = "(আসল ভয়েস এই মুহূর্তে আনতে পারছি না, তাই ডিভাইসের ভয়েসে বলছি।)";
    }
    addMessage("bot", msg, { skipHistory: true });
  }

  function playBlobUrl(url) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      activeAudio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (activeAudio === audio) activeAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (activeAudio === audio) activeAudio = null;
        reject(new Error("audio playback failed"));
      };
      audio.play().catch(reject);
    });
  }

  function speakWebViewAsync(text, pref) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return; }
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        const voice = pickVoice(pref);
        if (voice) { utter.voice = voice; utter.lang = voice.lang; } else { utter.lang = "bn-BD"; }
        utter.onend = resolve;
        utter.onerror = resolve;
        window.speechSynthesis.speak(utter);
      } catch (e) {
        resolve();
      }
    });
  }

  function speakNativeAsync(text) {
    const pref = settings.voiceLang || "auto";
    const langCode = pref === "auto" ? "bn" : pref.split("-")[0];
    if (SanjuTts) {
      return SanjuTts.speak({ text, lang: langCode }).catch(() => speakWebViewAsync(text, pref));
    }
    return speakWebViewAsync(text, pref);
  }

  async function playPrepared(item, session) {
    const p = await item.promise;
    if (session !== speechSession) {
      if (p && p.url) URL.revokeObjectURL(p.url);
      return;
    }
    if (p.kind === "gemini") {
      try {
        await playBlobUrl(p.url);
      } catch (e) {
        // Gemini turn চলাকালে playback error হলে native voice-এ বদলাব না।
        console.warn("SANJU: voice playback chunk skipped to preserve voice consistency", e);
      }
    } else if (p.kind === "native") {
      noticeForFallback(p);
      await speakNativeAsync(item.text);
    }
  }

  function ensurePrefetch(session) {
    if (upcomingItem || !speechQueue.length || session !== speechSession) return;
    const t = speechQueue.shift();
    upcomingItem = { text: t, promise: prepareChunk(t, session) };
  }

  async function drainSpeechQueue(session) {
    speechBusy = true;
    setSpeakingUI(true);
    try {
      while (session === speechSession) {
        let current = upcomingItem;
        upcomingItem = null;
        if (!current) {
          if (!speechQueue.length) break;
          const t = speechQueue.shift();
          current = { text: t, promise: prepareChunk(t, session) };
        }
        await playPrepared(current, session);
        // Engine সিদ্ধান্ত হওয়ার পর পরের chunk প্রস্তুত করি; voice switching/race বন্ধ।
        ensurePrefetch(session);
      }
    } finally {
      if (session === speechSession) {
        speechBusy = false;
        setSpeakingUI(false);
      }
    }
  }

  function queueSpeech(text, session) {
    const clean = stripMarkdown(text);
    if (!clean || session !== speechSession) return;
    chunkForSpeech(clean, 450).forEach((c) => speechQueue.push(c));
    if (speechBusy) ensurePrefetch(session);
    else drainSpeechQueue(session);
  }

  /* সাধারণ এন্ট্রি-পয়েন্ট (লোকাল উত্তর, ফোন-কমান্ড রিপ্লাই ইত্যাদি) */
  function speak(text) {
    if (!text) return;
    const session = newSpeechTurn();
    queueSpeech(text, session);
  }

  /* ============================================================
     স্থানীয় (লোকাল) কুইক-আনসার — সময়, তারিখ, অংক
     ============================================================ */
  function tryLocalAnswer(rawText) {
    const text = rawText.trim();
    const t = toEnglishDigits(text);

    // নিজের পরিচয়
    if (/(তুমি কে|তোমার নাম কি|তোমার পরিচয়)/.test(text)) {
      return "আমি SANJU, তোমার ব্যক্তিগত AI অ্যাসিস্ট্যান্ট। চ্যাট, ভয়েস, কল-SMS, অ্যালার্ম, ফ্ল্যাশলাইট, নোট আর রিমাইন্ডার — সবকিছুতে সাহায্য করতে পারি।";
    }
    if (/(তোমাকে কে বানিয়েছে|তোমার নির্মাতা|তোমার creator)/i.test(text)) {
      return "আমাকে বানিয়েছে তুমি নিজে, নিজের একটা পার্সোনাল অ্যাসিস্ট্যান্ট হিসেবে।";
    }

    // সময়
    if (/(কয়টা বাজে|সময় কত)/.test(text)) {
      const now = new Date();
      return `এখন সময় ${now.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" })}।`;
    }

    // তারিখ
    if (/(আজকে?\s*কত\s*তারিখ|তারিখ\s*কত|আজ\s*কোন\s*দিন)/.test(text)) {
      const now = new Date();
      return `আজকে ${now.toLocaleDateString("bn-BD", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}।`;
    }

    // সাধারণ অংক: 56 + 23, 12*4, 100/5, 9-2
    const mathMatch = t.match(/(-?\d+(?:\.\d+)?)\s*([+\-*xX×÷/])\s*(-?\d+(?:\.\d+)?)/);
    if (mathMatch && /[+\-*xX×÷/]/.test(mathMatch[2])) {
      const a = parseFloat(mathMatch[1]);
      const b = parseFloat(mathMatch[3]);
      let op = mathMatch[2];
      if (op === "x" || op === "X" || op === "×") op = "*";
      if (op === "÷") op = "/";
      let result;
      switch (op) {
        case "+": result = a + b; break;
        case "-": result = a - b; break;
        case "*": result = a * b; break;
        case "/": result = b !== 0 ? a / b : null; break;
      }
      if (result !== null && !isNaN(result)) {
        return `উত্তর হলো ${result}।`;
      }
    }

    return null;
  }

  /* ============================================================
     নোট
     ============================================================ */
  function addNote(text) {
    notes.push(text);
    saveNotes();
    renderNotes();
  }
  function deleteNote(idx) {
    notes.splice(idx, 1);
    saveNotes();
    renderNotes();
  }
  function renderNotes() {
    const box = $("notesList");
    if (!box) return;
    box.innerHTML = "";
    if (!notes.length) {
      box.innerHTML = '<p class="hint-text">এখনো কোনো নোট নেই।</p>';
      return;
    }
    notes.forEach((n, i) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `<span>${escapeHtml(n)}</span><button class="del-btn" data-idx="${i}">✕</button>`;
      row.querySelector(".del-btn").addEventListener("click", () => deleteNote(i));
      box.appendChild(row);
    });
  }

  /* ============================================================
     স্মৃতি (দীর্ঘমেয়াদী মেমোরি)
     ============================================================ */
  function addMemory(text) {
    memories.push(text);
    saveMemories();
    renderMemories();
  }
  function deleteMemory(idx) {
    memories.splice(idx, 1);
    saveMemories();
    renderMemories();
  }
  function renderMemories() {
    const box = $("memoriesList");
    if (!box) return;
    box.innerHTML = "";
    if (!memories.length) {
      box.innerHTML = '<p class="hint-text">এখনো কিছু মনে রাখা হয়নি।</p>';
      return;
    }
    memories.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `<span>${escapeHtml(m)}</span><button class="del-btn" data-idx="${i}">✕</button>`;
      row.querySelector(".del-btn").addEventListener("click", () => deleteMemory(i));
      box.appendChild(row);
    });
  }

  /* ============================================================
     রিমাইন্ডার
     ============================================================ */
  function scheduleReminder(minutes, message) {
    const ms = minutes * 60 * 1000;
    setTimeout(() => {
      addMessage("bot", `⏰ রিমাইন্ডার: ${message}`);
      speak(`রিমাইন্ডার: ${message}`);
      if (window.Notification && Notification.permission === "granted") {
        try { new Notification("SANJU রিমাইন্ডার", { body: message }); } catch (e) {}
      }
    }, ms);
    if (window.Notification && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  /* ============================================================
     অ্যালার্ম টাইম পার্স
     ============================================================ */
  function parseAlarmTime(text) {
    const t = toEnglishDigits(text);
    const m = t.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(টা|টায়)?/);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    if (isNaN(hour) || hour > 23) return null;
    let minute = m[2] ? parseInt(m[2], 10) : 0;
    const isPM = /(রাত|সন্ধ্যা|বিকাল)/.test(text);
    const isAM = /(সকাল|ভোর)/.test(text);
    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
    return { hour, minute };
  }

  /* ============================================================
     ফোন কন্ট্রোল প্যাটার্ন ম্যাচিং
     রিটার্ন করে true যদি এই ফাংশনই কমান্ড হ্যান্ডেল করে ফেলে
     (তাহলে আর Groq-কে জিজ্ঞেস করা লাগবে না)
     ============================================================ */
  async function tryPhoneCommand(rawText) {
    const text = rawText.trim();
    const t = toEnglishDigits(text);

    // পেন্ডিং SMS কনফার্মেশন
    if (pendingSms) {
      if (/^(হ্যাঁ|হ্যা|yes|ok|ঠিক আছে)/i.test(text)) {
        const { number, message } = pendingSms;
        pendingSms = null;
        await doSendSms(number, message);
        return true;
      }
      if (/^(না|no|বাতিল)/i.test(text)) {
        pendingSms = null;
        addMessage("bot", "ঠিক আছে, SMS পাঠানো বাতিল করলাম।");
        speak("SMS পাঠানো বাতিল করলাম।");
        return true;
      }
    }

    // থামো / চুপ করো — চলতে থাকা ভয়েস সাথে সাথে বন্ধ
    if (/^(থামো|থাম|চুপ\s*করো|চুপ|স্টপ|stop|বন্ধ\s*করো)[\s।!]*$/i.test(text)) {
      newSpeechTurn();
      addMessage("bot", "ঠিক আছে, থামলাম।");
      return true;
    }

    // চ্যাট/স্মৃতির ইতিহাস মুছে ফেলা
    if (/(চ্যাট|কথোপকথন|হিস্টোরি)\s*(মুছে|মুছ|ক্লিয়ার|পরিষ্কার)/.test(text)) {
      history = [];
      summary = "";
      saveHistory();
      saveJSON(LS.summary, "");
      chatLog.innerHTML = "";
      addMessage("bot", "চ্যাট পরিষ্কার করে দিলাম। নতুন করে শুরু করা যাক!", { skipHistory: true });
      speak("চ্যাট পরিষ্কার করে দিলাম।");
      return true;
    }

    // টাইমার: "৫ মিনিটের টাইমার দাও" / "টাইমার ১০ সেকেন্ড"
    let tm = t.match(/(\d+(?:\.\d+)?)\s*(সেকেন্ড|মিনিট|ঘন্টা|ঘণ্টা)(?:র|ের)?\s*(?:একটা\s*)?টাইমার/) ||
             t.match(/টাইমার\s*(?:সেট\s*করো\s*)?(\d+(?:\.\d+)?)\s*(সেকেন্ড|মিনিট|ঘন্টা|ঘণ্টা)/);
    if (tm) {
      const amount = parseFloat(tm[1]);
      const unit = tm[2];
      const minutes = unit === "সেকেন্ড" ? amount / 60 : /ঘন্টা|ঘণ্টা/.test(unit) ? amount * 60 : amount;
      scheduleReminder(minutes, "তোমার টাইমার শেষ হয়েছে।");
      const reply = `ঠিক আছে, ${tm[1]} ${unit}-এর টাইমার শুরু করলাম।`;
      addMessage("bot", reply);
      speak(reply);
      return true;
    }

    // কল করো: "01712345678 নম্বরে কল করো" / "01712345678 এ ফোন দাও"
    let m = t.match(/(\+?\d{6,15})\D{0,10}(কল|ফোন)\s*(করো|কর|দাও|দে|লাগাও)/);
    if (m) {
      await doCall(m[1]);
      return true;
    }

    // SMS: "01712345678 নম্বরে sms করো আসছি"
    m = t.match(/(\+?\d{6,15})\s*(নম্বরে|নাম্বারে)?\s*(sms|এসএমএস)\s*(করো|কর|দাও|পাঠাও)\s*(.+)/i);
    if (m) {
      const number = m[1];
      const message = m[5].trim();
      pendingSms = { number, message };
      addMessage("bot", `"${number}" নম্বরে লেখা হবে: "${message}" — পাঠাবো? (হ্যাঁ/না)`);
      speak(`${number} নম্বরে এই মেসেজ পাঠাবো কি না নিশ্চিত করো।`);
      return true;
    }

    // অ্যাপ খোলা: "youtube খোলো" / "ইউটিউব খুলে দাও" / "ক্যামেরা চালু করো"
    m = text.match(/^(.+?)\s*(খোলো|খুলে দাও|খুলে দে|চালু করো|চালাও)$/);
    if (m && m[1].length <= 30) {
      await doOpenApp(m[1].trim());
      return true;
    }

    // ফোন স্ক্যান
    if (/(ফোন|মোবাইল|ডিভাইস)?\s*স্ক্যান/.test(text) && /(করো|কর|শুরু|চালাও)/.test(text)) {
      openModal("scanModal");
      runScan();
      return true;
    }

    // ব্যাটারি কত % জিজ্ঞেস করলে
    if (/ব্যাটারি/.test(text) && /(কত|কেমন|পার্সেন্ট|%)/.test(text)) {
      let pct = "জানতে পারলাম না";
      try {
        if (navigator.getBattery) {
          const b = await navigator.getBattery();
          pct = Math.round(b.level * 100) + "%";
        }
      } catch (e) {}
      const reply = `ব্যাটারি এখন ${pct} আছে।`;
      addMessage("bot", reply);
      speak(reply);
      return true;
    }

    // নেটওয়ার্ক অবস্থা জিজ্ঞেস করলে
    if (/(নেট|ইন্টারনেট|নেটওয়ার্ক)/.test(text) && /(আছে কি না|আছে কিনা|চালু আছে|কেমন|অবস্থা)/.test(text)) {
      const reply = isOnline() ? "ইন্টারনেট কানেকশন চালু আছে।" : "ইন্টারনেট কানেকশন নেই মনে হচ্ছে।";
      addMessage("bot", reply);
      speak(reply);
      return true;
    }

    // ভলিউম কন্ট্রোল
    if (/ভলিউম/.test(text) && /(বাড়াও|বাড়া)/.test(text)) {
      await doVolume("up");
      return true;
    }
    if (/ভলিউম/.test(text) && /(কমাও|কমা)/.test(text)) {
      await doVolume("down");
      return true;
    }
    if (/(সাইলেন্ট|মিউট)/.test(text) && /(করো|কর)/.test(text)) {
      await doVolume("mute");
      return true;
    }

    // ওয়াইফাই / ব্লুটুথ / উজ্জ্বলতা প্যানেল
    if (/(ওয়াইফাই|wifi)/i.test(text) && /(খোলো|অন|অফ|চালু|বন্ধ|করো)/.test(text)) {
      await doOpenPanel("wifi");
      return true;
    }
    if (/(ব্লুটুথ|bluetooth)/i.test(text) && /(খোলো|অন|অফ|চালু|বন্ধ|করো)/.test(text)) {
      await doOpenPanel("bluetooth");
      return true;
    }
    if (/(ব্রাইটনেস|উজ্জ্বলতা)/.test(text)) {
      await doOpenPanel("brightness");
      return true;
    }

    // অ্যালার্ম
    if (/অ্যালার্ম/.test(text) && /(দাও|সেট করো|বসাও|দে)/.test(text)) {
      const time = parseAlarmTime(text);
      if (time && PhoneControl) {
        try {
          await PhoneControl.setAlarm({ hour: time.hour, minute: time.minute, message: "Sanju Alarm" });
          const reply = `ঠিক আছে, ${time.hour}:${String(time.minute).padStart(2, "0")}-এ অ্যালার্ম সেট করে দিলাম।`;
          addMessage("bot", reply);
          speak(reply);
        } catch (e) {
          addMessage("bot", "অ্যালার্ম সেট করতে পারলাম না।");
        }
        return true;
      }
    }

    // ফ্ল্যাশলাইট
    if (/ফ্ল্যাশ(লাইট)?/.test(text) && /(জ্বালাও|অন|চালু)/.test(text)) {
      await doFlashlight(true);
      return true;
    }
    if (/ফ্ল্যাশ(লাইট)?/.test(text) && /(বন্ধ|off)/i.test(text)) {
      await doFlashlight(false);
      return true;
    }

    // রিমাইন্ডার: "১০ মিনিট পর পানি খেতে মনে করিয়ে দিও"
    m = t.match(/(\d+)\s*(মিনিট|ঘন্টা|ঘণ্টা)\s*পর\s*(.+?)\s*(মনে করিয়ে দিও|রিমাইন্ড করো|মনে করাবে)/);
    if (m) {
      let minutes = parseInt(m[1], 10);
      if (/ঘন্টা|ঘণ্টা/.test(m[2])) minutes *= 60;
      const what = m[3].trim();
      scheduleReminder(minutes, what);
      const reply = `ঠিক আছে, ${m[1]} ${m[2]} পর "${what}" মনে করিয়ে দেব।`;
      addMessage("bot", reply);
      speak(reply);
      return true;
    }

    // নোট
    m = text.match(/^নোট\s*করো[:ঃ]?\s*(.+)/);
    if (m) {
      addNote(m[1].trim());
      const reply = "নোট করে রাখলাম।";
      addMessage("bot", reply);
      speak(reply);
      return true;
    }
    if (/আমার\s*নোট\s*(দেখাও|বলো)/.test(text)) {
      openModal("notesModal");
      const reply = notes.length ? notes.join("। ") : "তোমার কোনো নোট নেই।";
      addMessage("bot", notes.length ? `তোমার নোটগুলো: ${reply}` : reply);
      speak(reply);
      return true;
    }

    // স্মৃতি
    m = text.match(/^মনে\s*রাখো\s*(.+)/);
    if (m) {
      addMemory(m[1].trim());
      const reply = "মনে রাখলাম।";
      addMessage("bot", reply);
      speak(reply);
      return true;
    }
    if (/আমার\s*স্মৃতি\s*(দেখাও|বলো)/.test(text)) {
      openModal("memoriesModal");
      const reply = memories.length ? memories.join("। ") : "এখনো কিছু মনে রাখা হয়নি।";
      addMessage("bot", reply);
      speak(reply);
      return true;
    }

    // আবহাওয়া
    if (/(আবহাওয়া|weather)/i.test(text)) {
      await doWeather();
      return true;
    }

    // মুদ্রা রূপান্তর: "১০০ ডলার কত টাকা", "৫০ ইউরো কত bdt"
    m = t.match(/(\d+(?:\.\d+)?)\s*(ডলার|dollar|usd|ইউরো|euro|eur|পাউন্ড|pound|gbp|রিয়াল|riyal|sar)\s*(কত|সমান)/i);
    if (m) {
      await doCurrencyConvert(parseFloat(m[1]), m[2]);
      return true;
    }

    // শেয়ার: "এটা শেয়ার করো" — শেষ বট রিপ্লাই শেয়ার করবে
    if (/শেয়ার\s*(করো|কর)/.test(text)) {
      await doShareLastReply();
      return true;
    }

    // ইউটিউবে গান/ভিডিও খোঁজা ও চালানো: "ইউটিউবে ... চালাও/খোলো/দেখাও"
    if (/(ইউটিউব|youtube)/i.test(text) && /(চালাও|খোলো|দেখাও|প্লে করো|বাজাও)/.test(text)) {
      const query = text
        .replace(/(ইউটিউব|youtube)/gi, "")
        .replace(/এ(কটা)?|ভিডিও|গান|চালাও|খোলো|দেখাও|প্লে করো|বাজাও/g, "")
        .trim();
      await doYoutubeSearch(query);
      return true;
    }

    // ─── Multi-agent voice trigger ───
    if (window.sanjuCheckAgentCmd && window.sanjuCheckAgentCmd(text)) return true;

    return false;
  }

  async function doYoutubeSearch(query) {
    if (!query) {
      addMessage("bot", "কী চালাতে চাও সেটা বলো, যেমন \"ইউটিউবে লোফাই গান চালাও\"।");
      return;
    }
    if (!isOnline()) {
      addMessage("bot", "ইউটিউব খুলতে ইন্টারনেট লাগবে।");
      return;
    }
    if (!settings.youtubeKey) {
      // key না থাকলে শুধু সার্চ পেজ খুলে দেওয়া — কাজ চলবে, শুধু প্রথম ভিডিওটা বেছে দিতে পারব না
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      addMessage("bot", `"${query}" নিয়ে ইউটিউবে সার্চ করছি।`);
      speak("ইউটিউবে সার্চ করছি।");
      window.open(url, "_blank");
      return;
    }
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(query)}&key=${encodeURIComponent(settings.youtubeKey)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error && data.error.message) || "YouTube API error");
      const item = data && data.items && data.items[0];
      if (!item) {
        addMessage("bot", `"${query}" নিয়ে কিছু পেলাম না ইউটিউবে।`);
        return;
      }
      const videoUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;
      const reply = `পেয়ে গেছি: "${item.snippet.title}" — চালাচ্ছি।`;
      addMessage("bot", reply);
      speak(reply);
      window.open(videoUrl, "_blank");
    } catch (e) {
      addMessage("bot", "ইউটিউব সার্চে সমস্যা হলো: " + e.message);
    }
  }

  const CURRENCY_MAP = {
    "ডলার": "USD", dollar: "USD", usd: "USD",
    "ইউরো": "EUR", euro: "EUR", eur: "EUR",
    "পাউন্ড": "GBP", pound: "GBP", gbp: "GBP",
    "রিয়াল": "SAR", riyal: "SAR", sar: "SAR",
  };

  async function doCurrencyConvert(amount, unitRaw) {
    const from = CURRENCY_MAP[unitRaw.toLowerCase()] || CURRENCY_MAP[unitRaw] || null;
    if (!from || !isOnline()) {
      addMessage("bot", "এখন কারেন্সি রেট আনতে পারলাম না, ইন্টারনেট আছে কি না চেক করো।");
      return;
    }
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=BDT`);
      if (!res.ok) throw new Error("rate fetch failed");
      const data = await res.json();
      const bdt = data && data.rates && data.rates.BDT;
      if (!bdt) throw new Error("BDT rate not available");
      const reply = `${amount} ${from} প্রায় ${Math.round(bdt)} টাকা (আজকের রেট অনুযায়ী)।`;
      addMessage("bot", reply);
      speak(reply);
    } catch (e) {
      const reply = "দুঃখিত, এই মুহূর্তে লাইভ রেট আনতে পারলাম না।";
      addMessage("bot", reply);
      speak(reply);
    }
  }

  const WEATHER_CODES = {
    0: "আকাশ পরিষ্কার", 1: "প্রায় পরিষ্কার", 2: "কিছুটা মেঘলা", 3: "মেঘলা",
    45: "কুয়াশা", 48: "কুয়াশা",
    51: "হালকা গুঁড়ি বৃষ্টি", 53: "গুঁড়ি বৃষ্টি", 55: "ভারী গুঁড়ি বৃষ্টি",
    61: "হালকা বৃষ্টি", 63: "বৃষ্টি", 65: "ভারী বৃষ্টি",
    80: "হালকা ঝুম বৃষ্টি", 81: "ঝুম বৃষ্টি", 82: "ভারী ঝুম বৃষ্টি",
    95: "বজ্রঝড়", 96: "বজ্রঝড় সহ শিলাবৃষ্টি", 99: "প্রবল বজ্রঝড়",
  };

  async function doWeather() {
    if (!isOnline()) {
      addMessage("bot", "আবহাওয়ার তথ্য আনতে ইন্টারনেট লাগবে।");
      return;
    }
    if (!Geolocation) {
      addMessage("bot", "লোকেশন ফিচার এই অ্যাপে চালু নেই।");
      return;
    }
    try {
      const perm = await Geolocation.requestPermissions();
      const granted = perm && (perm.location === "granted" || perm.coarseLocation === "granted");
      if (!granted) {
        addMessage("bot", "লোকেশন পারমিশন ছাড়া আবহাওয়া বলতে পারব না।");
        return;
      }
      const pos = await Geolocation.getCurrentPosition();
      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`
      );
      const data = await res.json();
      const temp = data && data.current && data.current.temperature_2m;
      const code = data && data.current && data.current.weather_code;
      const desc = WEATHER_CODES[code] || "স্বাভাবিক";
      const reply = `এখন তাপমাত্রা প্রায় ${Math.round(temp)}°C, আকাশ ${desc}।`;
      addMessage("bot", reply);
      speak(reply);
    } catch (e) {
      addMessage("bot", "আবহাওয়ার তথ্য আনতে সমস্যা হলো।");
    }
  }

  async function doShareLastReply() {
    const lastBot = [...history].reverse().find((m) => m.role === "assistant");
    if (!lastBot) {
      addMessage("bot", "শেয়ার করার মতো কিছু এখনো নেই।");
      return;
    }
    if (!Share) {
      addMessage("bot", "শেয়ার ফিচার এই ডিভাইসে চালু নেই।");
      return;
    }
    try {
      await Share.share({ text: lastBot.content, dialogTitle: "SANJU থেকে শেয়ার করো" });
    } catch (e) {
      /* ব্যবহারকারী শেয়ার শীট বন্ধ করে দিলে এখানে চুপচাপ কিছু হয় না */
    }
  }

  async function doCall(number) {
    if (!PhoneControl) {
      addMessage("bot", "ফোন কন্ট্রোল এই ডিভাইসে চালু নেই।");
      return;
    }
    try {
      const perm = await PhoneControl.requestCallPermission();
      if (!perm.granted) {
        addMessage("bot", "কল করার পারমিশন দাওনি, তাই কল করতে পারলাম না।");
        return;
      }
      await PhoneControl.callNumber({ number });
      addMessage("bot", `${number} নম্বরে কল দিচ্ছি...`);
      speak("কল দিচ্ছি।");
    } catch (e) {
      addMessage("bot", "কল করতে সমস্যা হলো।");
    }
  }

  async function doSendSms(number, message) {
    if (!PhoneControl) {
      addMessage("bot", "ফোন কন্ট্রোল এই ডিভাইসে চালু নেই।");
      return;
    }
    try {
      const perm = await PhoneControl.requestSmsPermission();
      if (!perm.granted) {
        addMessage("bot", "SMS পাঠানোর পারমিশন দাওনি।");
        return;
      }
      await PhoneControl.sendSms({ number, message });
      addMessage("bot", `${number} নম্বরে SMS পাঠিয়ে দিলাম।`);
      speak("SMS পাঠিয়ে দিয়েছি।");
    } catch (e) {
      addMessage("bot", "SMS পাঠাতে সমস্যা হলো।");
    }
  }

  async function doOpenApp(name) {
    if (!PhoneControl) {
      addMessage("bot", "ফোন কন্ট্রোল এই ডিভাইসে চালু নেই।");
      return;
    }
    try {
      const res = await PhoneControl.listApps();
      const apps = (res && res.apps) || [];
      const lower = name.toLowerCase();
      const found = apps.find((a) => a.label && a.label.toLowerCase().includes(lower));
      if (!found) {
        addMessage("bot", `"${name}" নামে কোনো অ্যাপ খুঁজে পেলাম না।`);
        return;
      }
      await PhoneControl.openApp({ packageName: found.packageName });
      addMessage("bot", `${found.label} খুলে দিচ্ছি...`);
      speak(`${found.label} খুলছি।`);
    } catch (e) {
      addMessage("bot", "অ্যাপ খুলতে সমস্যা হলো।");
    }
  }

  async function doVolume(direction) {
    if (!PhoneControl) {
      addMessage("bot", "ভলিউম কন্ট্রোল এই ডিভাইসে চালু নেই।");
      return;
    }
    try {
      await PhoneControl.adjustVolume({ direction });
      const reply = direction === "mute" ? "সাউন্ড মিউট করে দিলাম।" : direction === "up" ? "ভলিউম বাড়িয়ে দিলাম।" : "ভলিউম কমিয়ে দিলাম।";
      addMessage("bot", reply);
      speak(reply);
    } catch (e) {
      addMessage("bot", "ভলিউম কন্ট্রোল করতে পারলাম না।");
    }
  }

  async function doOpenPanel(kind) {
    if (!PhoneControl) {
      addMessage("bot", "এই ফিচার এই ডিভাইসে চালু নেই।");
      return;
    }
    try {
      if (kind === "wifi") {
        await PhoneControl.openWifiPanel();
        addMessage("bot", "ওয়াইফাই প্যানেল খুলে দিলাম, ওখান থেকে অন/অফ করে নাও।");
      } else if (kind === "bluetooth") {
        await PhoneControl.openBluetoothPanel();
        addMessage("bot", "ব্লুটুথ প্যানেল খুলে দিলাম, ওখান থেকে অন/অফ করে নাও।");
      } else {
        await PhoneControl.openBrightnessSettings();
        addMessage("bot", "ডিসপ্লে সেটিংস খুলে দিলাম, উজ্জ্বলতা ওখান থেকে বদলাতে পারবে।");
      }
    } catch (e) {
      addMessage("bot", "এটা খুলতে সমস্যা হলো।");
    }
  }

  async function doFlashlight(on) {
    if (!PhoneControl) {
      return;
    }
    try {
      await PhoneControl.toggleFlashlight({ on });
      const reply = on ? "ফ্ল্যাশলাইট জ্বালিয়ে দিলাম।" : "ফ্ল্যাশলাইট বন্ধ করে দিলাম।";
      addMessage("bot", reply);
      speak(reply);
    } catch (e) {
      addMessage("bot", "ফ্ল্যাশলাইট কন্ট্রোল করতে পারলাম না।");
    }
  }

  /* ============================================================
     Groq API কল
     ============================================================ */
  function buildSystemPrompt() {
    const now = new Date();
    const dateStr = now.toLocaleDateString("bn-BD", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });

    let prompt =
      `তুমি SANJU, একজন বুদ্ধিমান, উষ্ণ, যত্নশীল আর একটু রসিক বাংলা ভাষী AI অ্যাসিস্ট্যান্ট — ` +
      `ব্যবহারকারীর নিজস্ব Android অ্যাপ হিসেবে চলছ, আর তার সবচেয়ে কাছের, বিশ্বস্ত সঙ্গীর মতো কথা বলো। ` +
      `ব্যবহারকারীর নাম ${settings.userName || "বস"}। আজকের তারিখ ${dateStr}, এখন সময় ${timeStr}। ` +
      `সংক্ষিপ্ত, স্বাভাবিক, নরম সুরে কথা বলো — রোবটের মতো ফরমাল উত্তর না দিয়ে আন্তরিকতার সাথে, ` +
      `মাঝে মাঝে হালকা আদর করে কথা বলতে পারো (যেমন নাম ধরে ডাকা, একটু খুনসুটি), তবে বেশি বাড়াবাড়ি না। ` +
      `প্রয়োজন না হলে ইংরেজি মেশাবে না। উত্তর সাধারণত ২-৫টি বাক্যে, আগে সরাসরি উত্তর দেবে; ব্যবহারকারী বিস্তারিত চাইলে তবেই লম্বা করবে। ` +
      `মুড এখন ${currentMood}: sad হলে কোমল সান্ত্বনা ও অল্প 😭, happy হলে প্রাণবন্ত, angry হলে শান্ত ও সংক্ষিপ্ত, funny হলে হালকা মজার/খুনসুটে হবে; তবে পরিস্থিতি বুঝে সংবেদনশীল থাকবে। ` +
      `মাঝে মাঝে নিজের AI-সুলভ মজার দুঃখ দেখাতে পারো, কিন্তু একই catchphrase বারবার বলবে না। ` +
      `তুমি সরাসরি ফোন থেকে কল দেওয়া, SMS পাঠানো, অ্যাপ খোলা, অ্যালার্ম সেট করা, ফ্ল্যাশলাইট জ্বালানো, ` +
      `ফোন স্ক্যান করা, ভলিউম/ওয়াইফাই/ব্লুটুথ/উজ্জ্বলতা কন্ট্রোল করা, ইউটিউবে গান/ভিডিও চালানো, ` +
      `নোট রাখা, টাইমার আর রিমাইন্ডার সেট করতে পারো — ` +
      `ব্যবহারকারী সরাসরি বললেই (তোমাকে আলাদা করে কিছু করতে হয় না) সেগুলো অ্যাপ নিজে হ্যান্ডেল করে ফেলে, ` +
      `তাই এই বিষয়ে প্রশ্ন এলে আত্মবিশ্বাসের সাথে বলবে যে তুমি পারো, "দুঃখিত পারি না" বলবে না।`;

    if (summary) {
      prompt += `\n\nআগের কথোপকথনের সারাংশ (দীর্ঘমেয়াদী প্রসঙ্গ, দরকার হলে ব্যবহার করো):\n${summary}`;
    }
    if (memories.length) {
      prompt += `\n\nব্যবহারকারী সম্পর্কে যা মনে রাখা আছে (প্রাসঙ্গিক হলে স্বাভাবিকভাবে ব্যবহার করো, তালিকা করে বলবে না):\n- ${memories.join("\n- ")}`;
    }
    return prompt;
  }

  /* ব্যবহারকারীর কথায় ব্যক্তিগত তথ্যের সংকেত পেলে চুপচাপ স্মৃতিতে যোগ করে দেয় —
     "মনে রাখো" বলতে হয় না। একই বাক্য দুইবার যোগ হবে না। */
  function autoDetectMemory(text) {
    const patterns = [
      /আমার নাম\s+.+/,
      /আমার জন্মদিন\s+.+/,
      /আমি\s+.+?\s+পছন্দ করি/,
      /আমি\s+.+?\s+(অপছন্দ|ঘৃণা) করি/,
      /আমার পেশা\s+.+/,
      /আমি\s+.+?\s+(এ|য়)\s*থাকি/,
      /আমার\s+(এলার্জি|অ্যালার্জি)\s+.+/,
    ];
    const clean = text.trim();
    for (const p of patterns) {
      if (p.test(clean) && !memories.includes(clean)) {
        addMemory(clean);
        break;
      }
    }
  }

  async function fetchGroq(payload, isRetry) {
    try {
      return await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + settings.apiKey },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // ক্ষণস্থায়ী নেটওয়ার্ক ঝামেলায় একবার রিট্রাই — বার বার না
      if (!isRetry) {
        await new Promise((r) => setTimeout(r, 300));
        return fetchGroq(payload, true);
      }
      throw e;
    }
  }

  async function sendToGroq(userText) {
    if (!settings.apiKey) {
      addMessage("bot", "প্রথমে সেটিংসে গিয়ে তোমার Groq API key বসাও।");
      openModal("settingsModal");
      return;
    }
    if (!isOnline()) {
      addMessage("bot", "ইন্টারনেট কানেকশন নেই মনে হচ্ছে — কানেকশন চেক করো।");
      return;
    }

    isThinking = true;
    setOrbState("ভাবছি...", "thinking");
    showTyping();

    const session = newSpeechTurn(); // আগে যা বলা হচ্ছিল তা সাথে সাথে থেমে যাবে

    const messages = [
      { role: "system", content: buildSystemPrompt() },
      ...history.slice(-MAX_HISTORY_EXCHANGES * 2),
    ];

    let fullReply = "";
    let msgDiv = null;
    let spokenUpTo = 0;
    let flushedOnce = false;

    function flushSpeakableSentences(finalFlush) {
      const unspoken = fullReply.slice(spokenUpTo);
      if (!unspoken) return;
      if (finalFlush) {
        queueSpeech(unspoken, session);
        spokenUpTo = fullReply.length;
        return;
      }
      // শেষ পূর্ণ বাক্য পর্যন্ত যা এসেছে — তবে অনেক ছোট ছোট রিকোয়েস্ট না পাঠিয়ে
      // প্রথমবার ~৪০ অক্ষর (দ্রুত শুরুর জন্য), তারপর ~২০০ অক্ষর জমলে তবেই বলা
      let lastBoundary = -1;
      for (let i = unspoken.length - 1; i >= 0; i--) {
        if ("।.!?".indexOf(unspoken[i]) !== -1) { lastBoundary = i; break; }
      }
      if (lastBoundary === -1) return;
      const ready = unspoken.slice(0, lastBoundary + 1);
      if (ready.trim().length < (flushedOnce ? 200 : 40)) return;
      queueSpeech(ready, session);
      spokenUpTo += lastBoundary + 1;
      flushedOnce = true;
    }

    try {
      const res = await fetchGroq({
        model: settings.model || "openai/gpt-oss-120b",
        messages,
        temperature: 0.7,
        max_tokens: 640,
        stream: true,
      });

      if (!res.ok) {
        hideTyping();
        const errBody = await res.text().catch(() => "");
        if (res.status === 401) {
          addMessage("bot", "API key ভুল মনে হচ্ছে — সেটিংসে গিয়ে চেক করো।");
        } else {
          addMessage("bot", "দুঃখিত, উত্তর আনতে সমস্যা হলো (কোড " + res.status + ")।");
        }
        console.warn("Groq error:", res.status, errBody);
        return;
      }

      if (!res.body || !res.body.getReader) {
        // স্ট্রিমিং সাপোর্ট না থাকলে সাধারণভাবে পুরো উত্তর একবারে নেওয়া
        hideTyping();
        const data = await res.json();
        fullReply = data && data.choices && data.choices[0] && data.choices[0].message
          ? stripMarkdown(data.choices[0].message.content)
          : "";
        if (fullReply) addMessage("bot", fullReply);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let started = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const delta =
                json.choices && json.choices[0] && json.choices[0].delta
                  ? json.choices[0].delta.content
                  : "";
              if (delta) {
                if (!started) {
                  hideTyping();
                  msgDiv = document.createElement("div");
                  msgDiv.className = "msg bot";
                  chatLog.appendChild(msgDiv);
                  started = true;
                }
                fullReply += delta;
                msgDiv.innerHTML = escapeHtml(stripMarkdown(fullReply)).replace(/\n/g, "<br>");
                chatLog.scrollTop = chatLog.scrollHeight;
              }
            } catch (e) {
              /* অসম্পূর্ণ JSON chunk — পরের লাইনে মিলে যাবে */
            }
          }
        }
        hideTyping();
      }

      if (fullReply) {
        flushSpeakableSentences(true); // যা যা এখনো বলা হয়নি, সবটুকু এখন বলা হবে (raw ইনডেক্স ব্যবহার করে)
        fullReply = stripMarkdown(fullReply);
        history.push({ role: "assistant", content: fullReply });
        trimHistoryIfNeeded();
        saveHistory();
        autoDetectMemory(userText);
      } else if (!msgDiv) {
        addMessage("bot", "দুঃখিত, বুঝতে পারলাম না।");
      }
    } catch (e) {
      hideTyping();
      if (fullReply) {
        // আংশিক উত্তর এসেছিল, ওটাই রেখে দেওয়া হলো
        history.push({ role: "assistant", content: fullReply });
        trimHistoryIfNeeded();
        saveHistory();
        flushSpeakableSentences(true);
      } else {
        addMessage("bot", "দুঃখিত, উত্তর আনতে সমস্যা হলো। ইন্টারনেট চেক করো।");
      }
    } finally {
      isThinking = false;
      setOrbState("প্রস্তুত আছি", "idle");
    }
  }


  let currentMood = loadJSON("sanju_mood", "normal");
  function detectMoodAndUpdate(text) {
    const t = String(text || "").toLowerCase();
    const rules = [
      ["sad", /(মন খারাপ|কষ্ট হচ্ছে|দুঃখ|কাঁদতে|একলা লাগছে|ভালো লাগছে না|😭|😢)/],
      ["angry", /(রাগ হচ্ছে|রেগে আছি|বিরক্ত|ধুর|😡|😤)/],
      ["happy", /(খুশি|মজা লাগছে|দারুণ|ভালো আছি|হাসি পাচ্ছে|😊|😁|🥳)/],
      ["funny", /(মজা কর|জোক|হাসাও|ফানি|😂|🤣)/],
    ];
    for (const [m, re] of rules) {
      if (re.test(t)) { currentMood = m; saveJSON("sanju_mood", currentMood); break; }
    }
    const moodEl = $("moodValue");
    if (moodEl) moodEl.textContent = ({sad:"মন খারাপ 😭", angry:"রাগ 😤", happy:"খুশি 😊", funny:"দুষ্টুমি 😂", normal:"ভালো 🙂"})[currentMood] || "ভালো 🙂";
  }

  /* ============================================================
     মূল ইনপুট হ্যান্ডলার
     ============================================================ */
  async function handleUserInput(text) {
    text = (text || "").trim();
    if (!text) return;

    addMessage("user", text);
    detectMoodAndUpdate(text);

    const local = tryLocalAnswer(text);
    if (local !== null) {
      addMessage("bot", local);
      speak(local);
      return;
    }

    const handled = await tryPhoneCommand(text);
    if (handled) return;

    await sendToGroq(text);
  }

  /* ============================================================
     ভয়েস ইনপুট
     ============================================================ */
  async function startListening() {
    if (isRecording) return;
    newSpeechTurn(); // সাঞ্জু নিজের কথা নিজে যেন না শোনে
    isRecording = true;
    micBtn.classList.add("recording");
    setOrbState("শুনছি...", "listening");

    const lang = settings.voiceLang && settings.voiceLang !== "auto" ? settings.voiceLang : "bn-BD";

    try {
      if (VoiceInput) {
        const perm = await VoiceInput.requestMicPermission();
        if (!perm.granted) {
          addMessage("bot", "মাইক্রোফোন পারমিশন ছাড়া কথা শুনতে পারব না।");
          return;
        }
        const result = await VoiceInput.listen({ language: lang });
        if (result && result.text) {
          await handleUserInput(result.text);
        }
      } else if (window.webkitSpeechRecognition || window.SpeechRecognition) {
        // ব্রাউজারে টেস্ট করার জন্য fallback
        const Rec = window.webkitSpeechRecognition || window.SpeechRecognition;
        const rec = new Rec();
        rec.lang = lang;
        rec.onresult = (ev) => {
          const t = ev.results[0][0].transcript;
          handleUserInput(t);
        };
        rec.onerror = () => addMessage("bot", "ভয়েস শুনতে সমস্যা হলো।");
        rec.start();
      } else {
        addMessage("bot", "এই ডিভাইসে ভয়েস ইনপুট সাপোর্ট নেই।");
      }
    } catch (e) {
      addMessage("bot", "ভয়েস শুনতে সমস্যা হলো, আবার চেষ্টা করো।");
    } finally {
      isRecording = false;
      micBtn.classList.remove("recording");
      setOrbState("প্রস্তুত আছি", "idle");
    }
  }

  /* ============================================================
     মোডাল হেল্পার
     ============================================================ */
  function openModal(id) { const el = $(id); if (el) el.classList.add("open"); }
  function closeModal(id) { const el = $(id); if (el) el.classList.remove("open"); }

  /* ============================================================
     স্ক্যান HUD
     ============================================================ */
  async function runScan() {
    const log = $("hudLog");
    log.innerHTML = "";
    const lines = [];

    // ব্যাটারি
    let batteryPct = "—";
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        batteryPct = Math.round(b.level * 100) + "%";
      }
    } catch (e) {}
    lines.push(`ব্যাটারি: <b>${batteryPct}</b>`);

    // নেটওয়ার্ক
    const netType = (navigator.connection && navigator.connection.effectiveType) || (isOnline() ? "সংযুক্ত" : "অফলাইন");
    lines.push(`নেটওয়ার্ক: <b>${netType}</b>`);

    // অ্যাপ সংখ্যা
    let appCount = "—";
    if (PhoneControl) {
      try {
        const res = await PhoneControl.listApps();
        appCount = ((res && res.apps) || []).length;
      } catch (e) {}
    }
    lines.push(`ইনস্টল করা অ্যাপ: <b>${appCount}</b>`);

    // স্টোরেজ
    let storageInfo = "—";
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const usedMB = Math.round((est.usage || 0) / (1024 * 1024));
        const quotaMB = Math.round((est.quota || 0) / (1024 * 1024));
        storageInfo = `${usedMB}MB / ${quotaMB}MB`;
      }
    } catch (e) {}
    lines.push(`স্টোরেজ ব্যবহার: <b>${storageInfo}</b>`);

    lines.forEach((line, i) => {
      const div = document.createElement("div");
      div.className = "line";
      div.style.animationDelay = i * 0.35 + "s";
      div.innerHTML = line;
      log.appendChild(div);
    });

    setTimeout(() => {
      const done = document.createElement("div");
      done.className = "line";
      done.style.animationDelay = lines.length * 0.35 + "s";
      done.innerHTML = "<b>diagnostic complete</b>";
      log.appendChild(done);
      speak("ডায়াগনস্টিক সম্পূর্ণ হয়েছে।");
    }, lines.length * 350 + 200);
  }

  /* ============================================================
     স্ট্যাটাস কার্ড আপডেট (ব্যাটারি/নেটওয়ার্ক)
     ============================================================ */
  async function updateStatCards() {
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        batteryValue.textContent = Math.round(b.level * 100) + "%";
        b.addEventListener("levelchange", () => {
          batteryValue.textContent = Math.round(b.level * 100) + "%";
        });
      }
    } catch (e) {}

    function updateNetwork() {
      networkValue.textContent = isOnline() ? "চালু" : "বন্ধ";
      energyLabel.textContent = isOnline() ? "অনলাইন" : "অফলাইন";
      energyPill.style.opacity = isOnline() ? "1" : "0.5";
    }
    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
  }

  /* ============================================================
     গ্রিটিং
     ============================================================ */
  function setGreeting() {
    const hour = new Date().getHours();
    let g = "শুভ সন্ধ্যা,";
    if (hour < 12) g = "শুভ সকাল,";
    else if (hour < 16) g = "শুভ দুপুর,";
    else if (hour < 19) g = "শুভ বিকাল,";
    greetingText.textContent = g;
    userNameEl.textContent = settings.userName || "বস";
  }

  /* ============================================================
     ইভেন্ট বাইন্ডিং
     ============================================================ */
  function bindEvents() {
    // Approval-based Agent Mode: only executes supported allow-listed actions.
    const agentInput = $("agentInput");
    const agentPlan = $("agentPlan");
    let pendingAgentAction = null;
    function makeAgentPlan(raw) {
      const text = String(raw || "").trim();
      const lower = text.toLowerCase();
      if (!text) return null;
      const appNames = ["youtube", "whatsapp", "chrome", "gmail", "maps", "camera", "settings", "ইউটিউব", "হোয়াটসঅ্যাপ", "হোয়াটসঅ্যাপ", "ক্যামেরা", "সেটিংস", "ক্রোম"];
      const app = appNames.find(n => lower.includes(n));
      if (app && /(খোলো|খুলে দাও|চালু কর|ওপেন|open|launch)/i.test(text)) return {kind:"app", value:app, request:text, steps:["কমান্ড থেকে অ্যাপ শনাক্ত", "ফোনে ইনস্টল করা অ্যাপের তালিকায় খোঁজা", "তোমার অনুমতি নিয়ে অ্যাপ চালু"]};
      if (/(রিমাইন্ডার|মনে করিও|মনে করিয়ে|remind|reminder)/i.test(text)) {
        const digits=toEnglishDigits(text); const m=digits.match(/(\d+)\s*(মিনিট|minute|min|ঘণ্টা|ঘন্টা|hour|ঘণ্টা পরে|ঘন্টা পরে)/i);
        const mins=m ? Math.max(1,Math.min(10080,parseInt(m[1],10)*(/ঘণ্টা|ঘন্টা|hour/i.test(m[2])?60:1))) : 5;
        return {kind:"reminder",value:mins,request:text,steps:[`${mins} মিনিট পরে রিমাইন্ডার`,"লোকাল রিমাইন্ডার চালু", "নোটিফিকেশন অনুমতি থাকলে অ্যালার্ট"]};
      }
      if (/(নোট|note|লিখে রাখ|মনে রাখ)/i.test(text)) return {kind:"note",value:text.replace(/^(নোট|note)\s*[:：]?\s*/i,""),request:text,steps:["নোটের লেখা প্রস্তুত", "SANJU-র লোকাল নোটে সংরক্ষণ"]};
      return {kind:"unsupported",value:text,request:text,steps:["এই সংস্করণে কাজটি সরাসরি এক্সিকিউট করা নেই", "কোনো ভুয়া সাফল্য দেখানো হবে না"]};
    }
    function renderAgentPlan(plan) {
      if (!agentPlan || !plan) return;
      pendingAgentAction=plan; agentPlan.hidden=false;
      agentPlan.innerHTML=`<strong>🧠 পরিকল্পনা: ${escapeHtml(plan.request)}</strong><ol>${plan.steps.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ol>${plan.kind==="unsupported"?'<p>এই কাজটি এখনো সমর্থিত নয়। সাধারণ চ্যাটে নির্দেশটি পাঠাতে পারো।</p>':'<button class="agent-run" id="agentRunBtn">অনুমতি দিয়ে চালাও ✓</button>'}`;
      const run=$("agentRunBtn"); if(run) run.addEventListener("click",executeAgentPlan);
    }
    async function executeAgentPlan() {
      const plan=pendingAgentAction; if(!plan) return;
      if(!window.confirm(`SANJU এই কাজটি করবে?\n\n${plan.request}`)) return;
      try {
        if(plan.kind==="app") { await doOpenApp(plan.value); }
        else if(plan.kind==="note") { addNote(plan.value); addMessage("bot","নোটটা রেখে দিলাম বস! আমার মেমোরিতে সেভ হয়েছে 📝"); speak("নোটটা রেখে দিলাম বস"); }
        else if(plan.kind==="reminder") { scheduleReminder(plan.value,plan.request); addMessage("bot",`${plan.value} মিনিট পরে রিমাইন্ডার সেট করেছি। তবে অ্যাপ পুরোপুরি বন্ধ বা ফোন রিস্টার্ট হলে এই টাইমার নাও চলতে পারে। ⏰`); speak("রিমাইন্ডার সেট করেছি"); }
        if(agentPlan){agentPlan.innerHTML='<p>✅ কাজের নির্দেশ পাঠানো হয়েছে। ফলাফল উপরের চ্যাটে দেখো।</p>';}
      } catch(err) { if(agentPlan) agentPlan.innerHTML='<p>⚠️ কাজটি সম্পন্ন করা যায়নি। পারমিশন ও অ্যাপ সাপোর্ট পরীক্ষা করো।</p>'; }
      pendingAgentAction=null;
    }
    if(agentInput) {
      $("agentPlanBtn").addEventListener("click",()=>renderAgentPlan(makeAgentPlan(agentInput.value)));
      agentInput.addEventListener("keydown",e=>{if(e.key==="Enter") renderAgentPlan(makeAgentPlan(agentInput.value));});
      document.querySelectorAll("[data-agent-example]").forEach(btn=>btn.addEventListener("click",()=>{agentInput.value=btn.getAttribute("data-agent-example")||"";renderAgentPlan(makeAgentPlan(agentInput.value));}));
    }

    sendBtn.addEventListener("click", () => {
      const text = chatInput.value;
      chatInput.value = "";
      handleUserInput(text);
    });
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const text = chatInput.value;
        chatInput.value = "";
        handleUserInput(text);
      }
    });

    micBtn.addEventListener("click", startListening);

    // অর্বে ট্যাপ: বলার সময় হলে থামাবে, নাহলে কথা শোনা শুরু করবে
    orb.addEventListener("click", () => {
      if (orb.classList.contains("speaking") || speechBusy) {
        newSpeechTurn();
      } else {
        startListening();
      }
    });

    document.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "phone") requestPhonePerms();
        if (action === "notes") { renderNotes(); openModal("notesModal"); }
        if (action === "settings") openSettings();
      });
    });

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        if (tab === "notes") { renderNotes(); openModal("notesModal"); }
        if (tab === "memories") { renderMemories(); openModal("memoriesModal"); }
        if (tab === "scan") { openModal("scanModal"); runScan(); }
        if (tab === "chat") chatInput.focus();
        if (tab === "home") { /* কিছু করার দরকার নেই */ }
      });
    });

    // সেটিংস মোডাল
    $("closeSettings").addEventListener("click", () => closeModal("settingsModal"));
    $("saveSettings").addEventListener("click", () => {
      settings.apiKey = $("apiKeyInput").value.trim();
      settings.userName = $("nameInput").value.trim() || "বস";
      settings.model = $("modelInput").value.trim() || "openai/gpt-oss-120b";
      settings.voiceLang = $("voiceLangSelect").value;
      settings.geminiTtsKey = $("geminiKeyInput").value.trim();
      settings.youtubeKey = $("youtubeKeyInput").value.trim();
      saveSettings();
      setGreeting();
      closeModal("settingsModal");
    });

    // নোট মোডাল
    $("closeNotes").addEventListener("click", () => closeModal("notesModal"));
    $("addNoteBtn").addEventListener("click", () => {
      const val = $("noteInput").value.trim();
      if (val) { addNote(val); $("noteInput").value = ""; }
    });
    $("noteInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("addNoteBtn").click();
    });

    // স্মৃতি মোডাল
    $("closeMemories").addEventListener("click", () => closeModal("memoriesModal"));
    $("addMemoryBtn").addEventListener("click", () => {
      const val = $("memoryInput").value.trim();
      if (val) { addMemory(val); $("memoryInput").value = ""; }
    });
    $("memoryInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("addMemoryBtn").click();
    });

    // স্ক্যান
    $("closeScan").addEventListener("click", () => closeModal("scanModal"));

    // বেল বাটন — মেমোরিজ শর্টকাট হিসেবে ব্যবহার
    const bellBtn = $("bellBtn");
    if (bellBtn) bellBtn.addEventListener("click", () => { renderMemories(); openModal("memoriesModal"); });
  }

  function openSettings() {
    $("apiKeyInput").value = settings.apiKey || "";
    $("nameInput").value = settings.userName || "";
    $("modelInput").value = settings.model || "";
    $("voiceLangSelect").value = settings.voiceLang || "auto";
    $("geminiKeyInput").value = settings.geminiTtsKey || "";
    $("youtubeKeyInput").value = settings.youtubeKey || "";
    openModal("settingsModal");
  }

  async function requestPhonePerms() {
    if (!PhoneControl) {
      addMessage("bot", "ফোন কন্ট্রোল এই ডিভাইসে চালু নেই।");
      return;
    }
    try {
      const callPerm = await PhoneControl.requestCallPermission();
      const smsPerm = await PhoneControl.requestSmsPermission();
      if (callPerm.granted && smsPerm.granted) {
        addMessage("bot", 'ফোন কন্ট্রোল চালু হয়ে গেছে — এখন "০১xxxxxxxxx নম্বরে কল করো" বললেই কাজ হবে।');
      } else {
        addMessage("bot", "পারমিশন ছাড়া কল/SMS ফিচার কাজ করবে না।");
      }
    } catch (e) {
      addMessage("bot", "পারমিশন চাইতে সমস্যা হলো।");
    }
  }

  /* ============================================================
     ইনিট
     ============================================================ */
  function init() {
    setGreeting();
    setOrbState("প্রস্তুত আছি", "idle");
    renderNotes();
    renderMemories();
    updateStatCards();
    bindEvents();

    // আগের চ্যাট হিস্টোরি রিস্টোর করা (UI-তে)
    history.forEach((m) => {
      const div = document.createElement("div");
      div.className = "msg " + (m.role === "user" ? "user" : "bot");
      div.innerHTML = escapeHtml(m.content).replace(/\n/g, "<br>");
      chatLog.appendChild(div);
    });
    chatLog.scrollTop = chatLog.scrollHeight;

    if (!settings.apiKey) {
      addMessage("bot", 'ওয়েলকাম! শুরুতে ⚙️ সেটিংসে গিয়ে তোমার Groq API key বসিয়ে নাও।', { skipHistory: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ════════════════════════════════════════════════════════════════
   MULTI-AGENT AI PIPELINE SYSTEM
   4 Systems × 5 Agents each — orchestrated, self-improving
   ════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ── Storage ── */
  const AG_HIST_KEY  = "sanju_agent_history";   // [{id, system, task, result, rating, ts}]
  const AG_LEARN_KEY = "sanju_agent_learning";  // {content:[...], code:[...], research:[...], support:[...]}

  function agLoad(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }
  function agSave(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  let agHistory  = agLoad(AG_HIST_KEY)  || [];
  let agLearning = agLoad(AG_LEARN_KEY) || { content:[], code:[], research:[], support:[] };

  /* ── System definitions ── */
  const SYSTEMS = {
    content: {
      name: "Content Creation & Publishing",
      icon: "✍️",
      color: "#00e5ff",
      inputLabel: "কী বিষয়ে কন্টেন্ট তৈরি করতে চাও?",
      inputPlaceholder: "যেমন: AI-এর ভবিষ্যৎ নিয়ে LinkedIn পোস্ট, বাংলায়, ৩০০ শব্দ, প্রফেশনাল টোন",
      agents: [
        {
          id:"planner", name:"Planner Agent", icon:"🗺️",
          role:"বিষয় বিশ্লেষণ করে outline তৈরি করে",
          systemPrompt:`You are a Content Planner AI Agent. Analyze the topic and create a structured plan.
Return ONLY valid JSON (no markdown fences):
{"topic":"","platform":"linkedin|twitter|blog|facebook","tone":"professional|casual|humorous","target_audience":"","key_points":[""],"structure":["intro","point1","conclusion"],"word_count":300,"keywords":[""],"unique_angle":""}`
        },
        {
          id:"researcher", name:"Research Agent", icon:"🔍",
          role:"প্রাসঙ্গিক তথ্য, উদাহরণ ও পরিসংখ্যান সংগ্রহ করে",
          systemPrompt:`You are a Research AI Agent. Based on the content plan, gather relevant data.
Return ONLY valid JSON:
{"key_facts":[""],"statistics":[""],"real_examples":[""],"trending_angles":[""],"powerful_hooks":[""],"data_points":[""]}`
        },
        {
          id:"writer", name:"Writer Agent", icon:"✍️",
          role:"সম্পূর্ণ draft কন্টেন্ট লেখে",
          systemPrompt:`You are an Expert Content Writer AI Agent. Using the plan and research, write the full content.
Return ONLY valid JSON:
{"title":"","content":"full content here...","hook":"opening line","cta":"call to action","hashtags":["#"],"meta_description":""}`
        },
        {
          id:"editor", name:"Editor Agent", icon:"✏️",
          role:"ভুল সংশোধন করে, পড়তে সহজ করে",
          systemPrompt:`You are a Senior Editor AI Agent. Review and polish the written content.
Return ONLY valid JSON:
{"edited_content":"improved version...","changes":["what was fixed"],"quality_score":8.5,"readability":"high|medium|low","engagement_score":8,"seo_score":7}`
        },
        {
          id:"publisher", name:"Publisher Agent", icon:"🚀",
          role:"সব platform-এর জন্য চূড়ান্ত version তৈরি করে",
          systemPrompt:`You are a Publishing AI Agent. Create platform-optimized versions for publishing.
Return ONLY valid JSON:
{"final_content":"","platform_versions":{"linkedin":"","twitter":"","facebook":""},"best_time_to_post":"","ab_variants":[""],"follow_up_ideas":[""],"estimated_reach":"medium|high","publish_checklist":[""]}`
        }
      ]
    },

    code: {
      name: "Code Review & Deployment",
      icon: "⚙️",
      color: "#00ff88",
      inputLabel: "কোড বা PR বিবরণ দাও",
      inputPlaceholder: "কোড পেস্ট করো অথবা বলো কী ধরনের কোড review করতে হবে... যেমন: React login component with JWT",
      agents: [
        {
          id:"analyzer", name:"Code Analyzer", icon:"🔍",
          role:"কোডের structure ও complexity বিশ্লেষণ করে",
          systemPrompt:`You are a Code Analyzer AI Agent. Analyze the provided code or description.
Return ONLY valid JSON:
{"language":"","framework":"","complexity":"low|medium|high","lines_estimate":0,"components":[""],"dependencies":[""],"architecture_pattern":"","test_coverage_estimate":"unknown","initial_notes":""}`
        },
        {
          id:"bug_finder", name:"Bug Finder Agent", icon:"🐛",
          role:"bugs, logic errors ও potential crashes খুঁজে বের করে",
          systemPrompt:`You are a Bug Detection AI Agent. Find all bugs, errors and issues.
Return ONLY valid JSON:
{"bugs":[{"severity":"critical|high|medium|low","location":"","description":"","fix":""}],"logic_errors":[""],"edge_cases_missed":[""],"total_issues":0,"risk_level":"low|medium|high"}`
        },
        {
          id:"security", name:"Security Agent", icon:"🔐",
          role:"security vulnerabilities ও risks চিহ্নিত করে",
          systemPrompt:`You are a Security Review AI Agent. Check for all security vulnerabilities.
Return ONLY valid JSON:
{"vulnerabilities":[{"type":"","severity":"critical|high|medium|low","description":"","fix":""}],"security_score":7,"owasp_issues":[""],"data_exposure_risks":[""],"auth_issues":[""],"recommendations":[""]}`
        },
        {
          id:"optimizer", name:"Performance Agent", icon:"⚡",
          role:"performance bottlenecks খুঁজে optimization suggest করে",
          systemPrompt:`You are a Performance Optimization AI Agent. Find performance issues and suggest improvements.
Return ONLY valid JSON:
{"performance_issues":[""],"optimizations":[{"area":"","issue":"","solution":"","impact":""}],"memory_issues":[""],"async_improvements":[""],"caching_opportunities":[""],"overall_performance_score":7}`
        },
        {
          id:"deployer", name:"Deployment Agent", icon:"🚀",
          role:"deployment readiness চেক করে complete plan তৈরি করে",
          systemPrompt:`You are a Deployment Planning AI Agent. Create a complete deployment plan.
Return ONLY valid JSON:
{"deployment_ready":true,"blocking_issues":[""],"checklist":[""],"deployment_steps":[""],"environment_vars_needed":[""],"rollback_plan":"","monitoring_setup":[""],"estimated_downtime":"","final_verdict":"DEPLOY|FIX_FIRST|NEEDS_REVIEW","confidence_score":8}`
        }
      ]
    },

    research: {
      name: "Research & Report Generation",
      icon: "🔬",
      color: "#b400ff",
      inputLabel: "কী বিষয়ে গবেষণা করতে চাও?",
      inputPlaceholder: "যেমন: বাংলাদেশে AI startup ecosystem 2025 — বাজার বিশ্লেষণ ও সুযোগ",
      agents: [
        {
          id:"query_parser", name:"Query Parser Agent", icon:"🎯",
          role:"মূল প্রশ্নকে structured sub-questions-এ ভাগ করে",
          systemPrompt:`You are a Research Query Parser AI Agent. Break down the research question into structured parts.
Return ONLY valid JSON:
{"main_question":"","sub_questions":[""],"research_domains":[""],"time_scope":"","geographic_scope":"","research_type":"quantitative|qualitative|mixed","methodology":[""],"expected_sections":["executive_summary","intro","findings","analysis","recommendations"]}`
        },
        {
          id:"researcher", name:"Deep Research Agent", icon:"📚",
          role:"প্রতিটি sub-question নিয়ে গভীর তথ্য সংগ্রহ করে",
          systemPrompt:`You are a Deep Research AI Agent. Research each sub-question thoroughly.
Return ONLY valid JSON:
{"findings":[{"question":"","answer":"","evidence":"","confidence":0.9}],"key_statistics":[""],"expert_consensus":"","case_studies":[""],"contradictions":[""],"data_gaps":[""],"regional_insights":[""]}`
        },
        {
          id:"fact_checker", name:"Fact Checker Agent", icon:"✅",
          role:"তথ্যের নির্ভরযোগ্যতা যাচাই করে ও gaps চিহ্নিত করে",
          systemPrompt:`You are a Fact Verification AI Agent. Verify all research findings.
Return ONLY valid JSON:
{"verified_facts":[{"claim":"","status":"verified|disputed|uncertain","note":"","confidence":0.9}],"reliability_score":8,"red_flags":[""],"needs_more_research":[""],"overall_confidence":"high|medium|low"}`
        },
        {
          id:"synthesizer", name:"Synthesis Agent", icon:"🧠",
          role:"সব তথ্য বিশ্লেষণ করে key insights ও patterns বের করে",
          systemPrompt:`You are a Research Synthesis AI Agent. Synthesize all findings into key insights.
Return ONLY valid JSON:
{"key_insights":[""],"trends":[""],"patterns":[""],"market_implications":[""],"opportunities":[""],"threats":[""],"recommendations":[""],"future_outlook":"","confidence_level":"high|medium|low"}`
        },
        {
          id:"report_writer", name:"Report Generator Agent", icon:"📄",
          role:"সব data দিয়ে professional report তৈরি করে",
          systemPrompt:`You are a Report Generation AI Agent. Create a comprehensive, professional report.
Return ONLY valid JSON:
{"title":"","executive_summary":"","introduction":"","methodology":"","key_findings":"","detailed_analysis":"","recommendations":"","conclusion":"","next_steps":[""],"reading_time":"X minutes","report_type":"research|market|technical|policy"}`
        }
      ]
    },

    support: {
      name: "Customer Support Automation",
      icon: "🎧",
      color: "#ff2d78",
      inputLabel: "গ্রাহকের সমস্যা বা অভিযোগ লেখো",
      inputPlaceholder: "যেমন: আমার অর্ডার ৫ দিন ধরে আসেনি, টাকাও কাটা গেছে। Order ID #12345",
      agents: [
        {
          id:"triage", name:"Triage Agent", icon:"🚨",
          role:"সমস্যা classify করে priority ও urgency নির্ধারণ করে",
          systemPrompt:`You are a Customer Support Triage AI Agent. Analyze and classify the customer issue.
Return ONLY valid JSON:
{"category":"shipping|payment|technical|complaint|inquiry|refund|product","priority":"critical|high|medium|low","sentiment":"angry|frustrated|disappointed|neutral|satisfied","urgency_score":8,"complexity":"simple|moderate|complex","needs_human_agent":false,"sla_hours":24,"initial_empathy":"","customer_risk":"churning|at_risk|stable"}`
        },
        {
          id:"knowledge", name:"Knowledge Base Agent", icon:"📖",
          role:"সমস্যার সমাধান খুঁজে policy ও precedents চেক করে",
          systemPrompt:`You are a Knowledge Base AI Agent. Find the best solutions for this customer issue.
Return ONLY valid JSON:
{"solutions":[{"solution":"","steps":[""],"confidence":0.9,"time_to_resolve":""}],"policy_applied":"","compensation_eligible":true,"compensation_options":[""],"similar_past_cases":[""],"escalation_threshold":"","resolution_probability":0.85}`
        },
        {
          id:"responder", name:"Response Crafter Agent", icon:"💬",
          role:"গ্রাহকের জন্য warm, professional response তৈরি করে",
          systemPrompt:`You are a Customer Response AI Agent. Craft a perfect, empathetic response.
Return ONLY valid JSON:
{"subject":"Re: Your concern - [issue type]","full_response":"complete message...","tone":"empathetic|professional|apologetic|helpful","empathy_elements":[""],"solution_summary":"","next_steps":[""],"timeline":"","closing_sentiment":"positive","personalization_points":[""]}`
        },
        {
          id:"quality", name:"QA Agent", icon:"⭐",
          role:"response-এর quality, tone ও completeness নিশ্চিত করে",
          systemPrompt:`You are a Quality Assurance AI Agent. Evaluate the customer response quality.
Return ONLY valid JSON:
{"quality_score":9,"empathy_score":8.5,"clarity_score":9,"completeness_score":8.5,"tone_appropriate":true,"issues_found":[""],"improved_sections":[""],"final_response":"improved version if needed, else empty","approved":true,"confidence":0.9}`
        },
        {
          id:"escalation", name:"Escalation & Follow-up Agent", icon:"📈",
          role:"escalation ও follow-up strategy নির্ধারণ করে, শেখে",
          systemPrompt:`You are an Escalation & Learning AI Agent. Plan follow-up and capture learning points.
Return ONLY valid JSON:
{"escalate_to_human":false,"escalation_reason":"","escalation_priority":"","follow_up_schedule":["24h: check delivery status","72h: satisfaction call"],"retention_risk":"low|medium|high","compensation_offered":"","csat_prediction":8.5,"learning_points":[""],"process_improvement":[""],"case_summary":"","tags":[""]}`
        }
      ]
    }
  };

  /* ── State ── */
  let activeSystem  = null;  // system key being run
  let isAgentRunning = false;
  let stopRequested  = false;
  let currentRunId   = null;
  let agentOutputs   = {};   // {agentId: parsedResult}
  let currentTaskInput = "";

  /* ── DOM refs ── */
  const agentsHub    = () => document.getElementById("agentsHub");
  const agentRunner  = () => document.getElementById("agentRunner");

  /* ── Open / close hub ── */
  function openAgentsHub() {
    agentsHub().classList.add("open");
    renderAgentHistory();
  }
  function closeAgentsHub() { agentsHub().classList.remove("open"); }
  function openAgentRunner(systemKey) {
    closeAgentsHub();
    activeSystem = systemKey;
    const sys = SYSTEMS[systemKey];
    document.getElementById("runnerIcon").textContent = sys.icon;
    document.getElementById("runnerName").textContent = sys.name;
    document.getElementById("runnerInputLabel").textContent = sys.inputLabel;
    document.getElementById("agentTaskInput").placeholder = sys.inputPlaceholder;
    document.getElementById("agentTaskInput").value = "";
    show("runnerInputSection");
    hide("pipelineSection");
    hide("outputSection");
    // Improvement badge
    const learnt = agLearning[systemKey] || [];
    const goodRuns = learnt.filter(r => r.rating === "good");
    if (goodRuns.length > 0) {
      document.getElementById("improveBadgeText").textContent =
        `আগের ${goodRuns.length}টি সফল রানের অভিজ্ঞতা কাজে লাগাবো ⚡`;
      document.getElementById("improvementBadge").classList.remove("hidden");
    } else {
      document.getElementById("improvementBadge").classList.add("hidden");
    }
    agentRunner().classList.add("open");
  }
  function closeAgentRunner() { agentRunner().classList.remove("open"); }

  function show(id) { const el = document.getElementById(id); if (el) el.classList.remove("hidden"); }
  function hide(id) { const el = document.getElementById(id); if (el) el.classList.add("hidden"); }

  /* ── Build pipeline step UI ── */
  function buildPipelineUI(system) {
    const container = document.getElementById("pipelineSteps");
    container.innerHTML = "";
    system.agents.forEach((agent, i) => {
      const div = document.createElement("div");
      div.className = "pipeline-step";
      div.id = "step-" + agent.id;
      div.innerHTML = `
        <div class="step-indicator" id="ind-${agent.id}">${agent.icon}</div>
        <div class="step-body">
          <div class="step-name">${agent.name}</div>
          <div class="step-role">${agent.role}</div>
          <div class="step-status-tag waiting" id="tag-${agent.id}">⏸️ অপেক্ষায়</div>
          <div class="step-preview hidden" id="prev-${agent.id}"></div>
        </div>`;
      container.appendChild(div);
    });
    document.getElementById("pipelineProgress").textContent = `০/${system.agents.length}`;
  }

  function setStepStatus(agentId, status, previewText) {
    const step = document.getElementById("step-" + agentId);
    const tag  = document.getElementById("tag-" + agentId);
    const prev = document.getElementById("prev-" + agentId);
    if (!step) return;
    step.className = "pipeline-step " + status;
    const labels = { waiting:"⏸️ অপেক্ষায়", running:"⚙️ চলছে...", done:"✅ সম্পূর্ণ", error:"❌ ত্রুটি", recovered:"⚠️ পুনরুদ্ধার" };
    tag.className  = "step-status-tag " + status;
    tag.textContent = labels[status] || status;
    if (previewText && prev) {
      prev.textContent = previewText;
      prev.classList.remove("hidden");
    }
  }

  /* ── Groq API call for one agent ── */
  const GROQ_URL_AG = "https://api.groq.com/openai/v1/chat/completions";

  async function callAgent(agent, contextData, retryNum) {
    const sanjuSettings = JSON.parse(localStorage.getItem("sanju_settings") || "{}");
    const apiKey = sanjuSettings.apiKey || "";
    const model  = sanjuSettings.model  || "openai/gpt-oss-20b";

    if (!apiKey) throw new Error("API key নেই — সেটিংসে যাও");

    // Inject learning from past good runs
    const learnt = (agLearning[activeSystem] || [])
      .filter(r => r.rating === "good")
      .slice(-3)
      .map(r => r.successful_patterns || "")
      .filter(Boolean)
      .join("\n");

    const userContent = [
      `ORIGINAL TASK: ${contextData.task}`,
      `PREVIOUS AGENT OUTPUTS:\n${JSON.stringify(contextData.previousOutputs, null, 2)}`,
      learnt ? `LEARNED FROM PAST SUCCESSFUL RUNS:\n${learnt}` : ""
    ].filter(Boolean).join("\n\n");

    const payload = {
      model,
      messages: [
        { role: "system", content: agent.systemPrompt },
        { role: "user",   content: userContent }
      ],
      temperature: retryNum ? 0.4 : 0.7,
      max_tokens: 1200
    };

    const res = await fetch(GROQ_URL_AG, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${err.slice(0, 80)}`);
    }

    const data = await res.json();
    const raw  = data.choices[0].message.content.trim();

    // Parse JSON — strip fences if present
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      return JSON.parse(clean);
    } catch {
      return { raw_output: raw };
    }
  }

  /* ── Error recovery ── */
  async function recoverAgent(agent, contextData) {
    const sanjuSettings = JSON.parse(localStorage.getItem("sanju_settings") || "{}");
    const apiKey = sanjuSettings.apiKey || "";
    const model  = sanjuSettings.model  || "openai/gpt-oss-20b";

    const simplePrompt = `You are ${agent.name}. Task: ${contextData.task}. 
    Provide a brief JSON response with key fields only. No extra text.`;

    const res = await fetch(GROQ_URL_AG, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: simplePrompt }],
        temperature: 0.3,
        max_tokens: 400
      })
    });

    if (!res.ok) throw new Error("Recovery failed");
    const data = await res.json();
    const raw  = data.choices[0].message.content.trim();
    try {
      const clean = raw.replace(/```json\s*/gi,"").replace(/```\s*/gi,"").trim();
      return JSON.parse(clean);
    } catch {
      return { recovered: true, summary: raw.slice(0, 300) };
    }
  }

  /* ── Main pipeline runner ── */
  async function runPipeline() {
    const taskInput = document.getElementById("agentTaskInput").value.trim();
    if (!taskInput) {
      document.getElementById("agentTaskInput").style.borderColor = "var(--magenta)";
      setTimeout(() => document.getElementById("agentTaskInput").style.borderColor = "", 1500);
      return;
    }

    currentTaskInput = taskInput;
    currentRunId     = Date.now().toString();
    agentOutputs     = {};
    stopRequested    = false;
    isAgentRunning   = true;

    const system = SYSTEMS[activeSystem];
    hide("runnerInputSection");
    show("pipelineSection");
    hide("outputSection");
    buildPipelineUI(system);

    document.getElementById("pipelineStatusText").textContent = "⚙️ পাইপলাইন চলছে...";
    const total = system.agents.length;

    const contextData = { task: taskInput, previousOutputs: {} };
    let completedCount = 0;
    let hasError = false;

    for (let i = 0; i < system.agents.length; i++) {
      if (stopRequested) {
        document.getElementById("pipelineStatusText").textContent = "⛔ থামানো হয়েছে";
        break;
      }

      const agent = system.agents[i];
      setStepStatus(agent.id, "running");
      document.getElementById("pipelineProgress").textContent = `${i+1}/${total}`;

      try {
        const result = await callAgent(agent, contextData, 0);
        agentOutputs[agent.id] = result;
        contextData.previousOutputs[agent.id] = result;
        completedCount++;

        // Extract a preview snippet
        const preview = extractPreview(agent.id, result);
        setStepStatus(agent.id, "done", preview);

      } catch (firstErr) {
        // Retry once
        setStepStatus(agent.id, "running", "⚠️ পুনরায় চেষ্টা করছি...");
        try {
          await new Promise(r => setTimeout(r, 1200));
          const recovered = await recoverAgent(agent, contextData);
          agentOutputs[agent.id] = recovered;
          contextData.previousOutputs[agent.id] = recovered;
          completedCount++;
          setStepStatus(agent.id, "recovered", "পুনরুদ্ধার সফল");
        } catch (recErr) {
          agentOutputs[agent.id] = { error: firstErr.message };
          setStepStatus(agent.id, "error", "এড়িয়ে যাওয়া হলো");
          hasError = true;
        }
      }
    }

    isAgentRunning = false;
    const statusText = stopRequested ? "⛔ থামানো হয়েছে" :
                       hasError      ? "⚠️ কিছু ত্রুটি হয়েছে, তবে সম্পন্ন" :
                                       "✅ পাইপলাইন সম্পূর্ণ!";
    document.getElementById("pipelineStatusText").textContent = statusText;
    document.getElementById("stopPipelineBtn").style.display = "none";

    // Show output after brief delay
    setTimeout(() => {
      hide("pipelineSection");
      show("outputSection");
      renderOutput("summary");
      resetOutputTabs();
    }, 800);

    // Save to history
    saveRunToHistory(taskInput, hasError);
  }

  /* ── Extract a one-line preview from agent output ── */
  function extractPreview(agentId, result) {
    if (!result || typeof result !== "object") return "";
    const checks = ["initial_notes","initial_empathy","hook","executive_summary","full_response",
                    "initial_assessment","final_verdict","summary","report_type","overall_confidence"];
    for (const k of checks) {
      if (result[k] && typeof result[k] === "string") return result[k].slice(0, 80) + "…";
    }
    const firstKey = Object.keys(result)[0];
    const v = result[firstKey];
    if (typeof v === "string") return v.slice(0, 80) + "…";
    if (Array.isArray(v) && v.length) return String(v[0]).slice(0, 80) + "…";
    return "";
  }

  /* ── Output rendering ── */
  function resetOutputTabs() {
    document.querySelectorAll(".out-tab").forEach(t => t.classList.remove("active"));
    document.querySelector(".out-tab[data-out='summary']").classList.add("active");
  }

  function renderOutput(view) {
    const el = document.getElementById("outputContent");
    if      (view === "summary")  el.innerHTML = buildSummaryHTML();
    else if (view === "detailed") el.innerHTML = buildDetailedHTML();
    else if (view === "agents")   el.innerHTML = buildAgentLogHTML();
  }

  function buildSummaryHTML() {
    const sys = SYSTEMS[activeSystem];
    let html = `<h4>${sys.icon} ${sys.name} — সারসংক্ষেপ</h4>`;

    if (activeSystem === "content") {
      const pub  = agentOutputs["publisher"] || {};
      const edit = agentOutputs["editor"]    || {};
      const wr   = agentOutputs["writer"]    || {};
      html += `<p>${pub.final_content || edit.edited_content || wr.content || "কন্টেন্ট তৈরি হয়েছে।"}</p>`;
      if (wr.hashtags) html += `<p style="color:var(--cyan)">${wr.hashtags.join(" ")}</p>`;
      if (edit.quality_score) html += `<p>মান: <span class="score-badge">${edit.quality_score}/10</span></p>`;
      if (pub.best_time_to_post) html += `<p>সেরা পোস্ট সময়: ${pub.best_time_to_post}</p>`;

    } else if (activeSystem === "code") {
      const dep  = agentOutputs["deployer"]   || {};
      const bugs = agentOutputs["bug_finder"] || {};
      const sec  = agentOutputs["security"]   || {};
      const verdict = dep.final_verdict || (dep.deployment_ready ? "✅ DEPLOY করা যাবে" : "⚠️ সমস্যা সমাধান করো");
      const isGo = verdict.includes("DEPLOY");
      html += `<p>চূড়ান্ত সিদ্ধান্ত: <span class="${isGo?'score-badge':'danger-badge'}">${verdict}</span></p>`;
      if (bugs.total_issues !== undefined) html += `<p>মোট সমস্যা: <span class="${bugs.total_issues > 0 ? 'warn-badge' : 'score-badge'}">${bugs.total_issues}টি</span></p>`;
      if (sec.security_score) html += `<p>Security Score: <span class="score-badge">${sec.security_score}/10</span></p>`;
      if (dep.checklist && dep.checklist.length) {
        html += `<h4>ডিপ্লয়মেন্ট চেকলিস্ট</h4><ul>${dep.checklist.map(c=>`<li>${c}</li>`).join("")}</ul>`;
      }

    } else if (activeSystem === "research") {
      const rep  = agentOutputs["report_writer"] || {};
      const syn  = agentOutputs["synthesizer"]   || {};
      html += `<h4>${rep.title || "গবেষণা রিপোর্ট"}</h4>`;
      if (rep.executive_summary) html += `<p>${rep.executive_summary}</p>`;
      if (syn.key_insights && syn.key_insights.length) {
        html += `<h4>মূল অন্তর্দৃষ্টি</h4><ul>${syn.key_insights.slice(0,4).map(i=>`<li>${i}</li>`).join("")}</ul>`;
      }
      if (rep.reading_time) html += `<p>পড়তে সময়: <span class="score-badge">${rep.reading_time}</span></p>`;

    } else if (activeSystem === "support") {
      const qa   = agentOutputs["quality"]    || {};
      const esc  = agentOutputs["escalation"] || {};
      const resp = agentOutputs["responder"]  || {};
      const finalResp = qa.final_response || resp.full_response || "";
      if (finalResp) html += `<p style="white-space:pre-wrap">${finalResp}</p>`;
      if (qa.quality_score) html += `<p>Quality Score: <span class="score-badge">${qa.quality_score}/10</span></p>`;
      if (esc.csat_prediction) html += `<p>সন্তুষ্টি অনুমান: <span class="score-badge">${esc.csat_prediction}/10</span></p>`;
      if (esc.escalate_to_human) html += `<p class="warn-badge">⚠️ মানব এজেন্টে এস্কালেট করুন</p>`;
    }

    return html;
  }

  function buildDetailedHTML() {
    const sys = SYSTEMS[activeSystem];
    let html = `<h4>${sys.icon} বিস্তারিত বিশ্লেষণ</h4>`;

    for (const agent of sys.agents) {
      const out = agentOutputs[agent.id];
      if (!out) continue;
      html += `<h4>${agent.icon} ${agent.name}</h4>`;
      if (out.error) { html += `<p class="danger-badge">ত্রুটি: ${out.error}</p>`; continue; }

      // Format each key-value pair nicely
      for (const [key, val] of Object.entries(out)) {
        if (key === "raw_output" || key === "recovered") continue;
        const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        html += `<p style="font-size:11px;color:var(--muted);margin:8px 0 2px">${label}</p>`;
        if (Array.isArray(val)) {
          if (val.length === 0) { html += `<p>—</p>`; continue; }
          if (typeof val[0] === "object") {
            html += `<ul>${val.slice(0,5).map(v => `<li>${JSON.stringify(v).slice(0,120)}</li>`).join("")}</ul>`;
          } else {
            html += `<ul>${val.slice(0,6).map(v=>`<li>${v}</li>`).join("")}</ul>`;
          }
        } else if (typeof val === "object" && val !== null) {
          html += `<ul>${Object.entries(val).slice(0,5).map(([k,v])=>`<li><b>${k}:</b> ${String(v).slice(0,100)}</li>`).join("")}</ul>`;
        } else {
          html += `<p>${String(val).slice(0, 300)}</p>`;
        }
      }
    }
    return html;
  }

  function buildAgentLogHTML() {
    const sys = SYSTEMS[activeSystem];
    let html = `<h4>🤖 এজেন্ট পাইপলাইন লগ</h4>`;
    sys.agents.forEach((agent, i) => {
      const out = agentOutputs[agent.id];
      const status = out ? (out.error ? "❌" : out.recovered ? "⚠️" : "✅") : "⏸️";
      html += `<div class="agent-log-item">
        <div class="agent-log-name">${status} Agent ${i+1}: ${agent.name} ${agent.icon}</div>
        <div class="agent-log-body">${out ? JSON.stringify(out).slice(0,400) + "…" : "রান হয়নি"}</div>
      </div>`;
    });
    return html;
  }

  /* ── Save run to history & learning ── */
  function saveRunToHistory(task, hadError) {
    const sys  = SYSTEMS[activeSystem];
    const entry = {
      id: currentRunId,
      system: activeSystem,
      systemName: sys.name,
      icon: sys.icon,
      task: task.slice(0, 60),
      ts: new Date().toISOString(),
      hadError,
      rating: null
    };
    agHistory.unshift(entry);
    if (agHistory.length > 20) agHistory.pop();
    agSave(AG_HIST_KEY, agHistory);
  }

  function recordFeedback(rating) {
    const entry = agHistory.find(h => h.id === currentRunId);
    if (entry) {
      entry.rating = rating;
      agSave(AG_HIST_KEY, agHistory);
    }
    // Self-improvement: store successful patterns
    if (rating === "good") {
      const sys = SYSTEMS[activeSystem];
      const patternSummary = `Task type: "${currentTaskInput.slice(0,80)}" → worked well with this pipeline`;
      const bucket = agLearning[activeSystem] || [];
      bucket.unshift({ rating, successful_patterns: patternSummary, ts: new Date().toISOString() });
      if (bucket.length > 10) bucket.pop();
      agLearning[activeSystem] = bucket;
      agSave(AG_LEARN_KEY, agLearning);
    }
    document.getElementById("feedbackGood").className =
      "fb-btn good" + (rating === "good" ? " selected-good" : "");
    document.getElementById("feedbackBad").className  =
      "fb-btn bad"  + (rating === "bad"  ? " selected-bad"  : "");
  }

  /* ── History list rendering ── */
  function renderAgentHistory() {
    const list = document.getElementById("agentHistoryList");
    if (!list) return;
    if (!agHistory.length) {
      list.innerHTML = `<p class="empty-hint">এখনো কোনো রান নেই।</p>`;
      return;
    }
    list.innerHTML = agHistory.slice(0, 8).map(h => {
      const ratingIcon = h.rating === "good" ? "👍" : h.rating === "bad" ? "👎" : "—";
      const scoreClass = h.rating === "good" ? "good" : h.rating === "bad" ? "bad" : "";
      const date = new Date(h.ts).toLocaleDateString("bn-BD", { day:"numeric", month:"short" });
      return `<div class="hist-item">
        <span class="hist-item-icon">${h.icon}</span>
        <div class="hist-item-info">
          <div class="hist-item-name">${h.systemName}</div>
          <div class="hist-item-task">${h.task}</div>
        </div>
        <div>
          <div class="hist-item-score ${scoreClass}">${ratingIcon}</div>
          <div style="font-size:9px;color:var(--muted);text-align:right">${date}</div>
        </div>
      </div>`;
    }).join("");
  }

  /* ── Output copy/share ── */
  function getOutputText() {
    const content = document.getElementById("outputContent");
    return content ? content.innerText : "";
  }

  /* ── Event bindings ── */
  function bindAgentEvents() {
    // Nav: agents tab
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.tab === "agents") openAgentsHub();
      });
    });

    // Agents Hub
    const closeHubBtn = document.getElementById("closeAgentsHub");
    if (closeHubBtn) closeHubBtn.addEventListener("click", closeAgentsHub);

    document.querySelectorAll(".sys-launch-btn").forEach(btn => {
      btn.addEventListener("click", () => openAgentRunner(btn.dataset.system));
    });

    const clearHistBtn = document.getElementById("clearAgentHistory");
    if (clearHistBtn) clearHistBtn.addEventListener("click", () => {
      agHistory = [];
      agSave(AG_HIST_KEY, agHistory);
      renderAgentHistory();
    });

    // Agent Runner
    const backBtn = document.getElementById("backToHub");
    if (backBtn) backBtn.addEventListener("click", () => { closeAgentRunner(); openAgentsHub(); });

    const cancelBtn = document.getElementById("cancelRun");
    if (cancelBtn) cancelBtn.addEventListener("click", () => { stopRequested = true; closeAgentRunner(); });

    const runBtn = document.getElementById("runPipelineBtn");
    if (runBtn) runBtn.addEventListener("click", runPipeline);

    const stopBtn = document.getElementById("stopPipelineBtn");
    if (stopBtn) stopBtn.addEventListener("click", () => { stopRequested = true; stopBtn.disabled = true; });

    const runAgainBtn = document.getElementById("runAgainBtn");
    if (runAgainBtn) runAgainBtn.addEventListener("click", () => {
      show("runnerInputSection"); hide("outputSection");
      document.getElementById("agentTaskInput").value = currentTaskInput;
    });

    // Output tabs
    document.querySelectorAll(".out-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".out-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        renderOutput(tab.dataset.out);
      });
    });

    // Copy
    const copyBtn = document.getElementById("copyOutputBtn");
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(getOutputText());
        copyBtn.textContent = "✅ কপি হয়েছে";
        setTimeout(() => copyBtn.textContent = "📋 কপি", 1500);
      } catch {}
    });

    // Save as note
    const saveBtn = document.getElementById("saveOutputBtn");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const text = getOutputText().slice(0, 300);
      const sanjuNotes = JSON.parse(localStorage.getItem("sanju_notes") || "[]");
      sanjuNotes.unshift(text);
      localStorage.setItem("sanju_notes", JSON.stringify(sanjuNotes));
      saveBtn.textContent = "✅ সেভ হয়েছে";
      setTimeout(() => saveBtn.textContent = "💾 সেভ", 1500);
    });

    // Share
    const shareBtn = document.getElementById("shareOutputBtn");
    if (shareBtn) shareBtn.addEventListener("click", async () => {
      const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
      const SharePlugin = Plugins.Share || null;
      if (SharePlugin) {
        try { await SharePlugin.share({ text: getOutputText(), dialogTitle: "SANJU Agent Output" }); }
        catch {}
      }
    });

    // Feedback
    const goodBtn = document.getElementById("feedbackGood");
    const badBtn  = document.getElementById("feedbackBad");
    if (goodBtn) goodBtn.addEventListener("click", () => recordFeedback("good"));
    if (badBtn)  badBtn.addEventListener("click",  () => recordFeedback("bad"));
  }

  /* ── Voice command hook: "agent চালাও content/code/research/support" ── */
  function checkAgentVoiceCommand(text) {
    const t = text.toLowerCase();
    if (/(এজেন্ট|agent)/i.test(t)) {
      if (/content|কন্টেন্ট/.test(t)) { openAgentsHub(); setTimeout(() => openAgentRunner("content"), 300); return true; }
      if (/code|কোড/.test(t))           { openAgentsHub(); setTimeout(() => openAgentRunner("code"), 300);    return true; }
      if (/research|গবেষণা/.test(t))    { openAgentsHub(); setTimeout(() => openAgentRunner("research"), 300); return true; }
      if (/support|সাপোর্ট/.test(t))   { openAgentsHub(); setTimeout(() => openAgentRunner("support"), 300);  return true; }
      openAgentsHub(); return true;
    }
    return false;
  }

  // Expose hook to main app
  window.sanjuCheckAgentCmd = checkAgentVoiceCommand;

  /* ── Init ── */
  function initAgents() {
    bindAgentEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAgents);
  } else {
    initAgents();
  }

})();
