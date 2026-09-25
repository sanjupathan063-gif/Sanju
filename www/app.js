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
const Tts = Plugins.Tts || null; // ✅ ADD THIS LINE
  /* ---------- Storage keys ---------- */
  const LS = {
    settings: "sanju_settings",
    history: "sanju_history",
    notes: "sanju_notes",
    memories: "sanju_memories",
    summary: "sanju_summary",
  };

  const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

  const MAX_HISTORY_EXCHANGES = 24; // ২৪টা এক্সচেঞ্জ (user+bot জোড়া) মনে রাখা

  /* ---------- State ---------- */
  let settings = loadJSON(LS.settings, {
    apiKey: "",
    userName: "বস",
    model: "openai/gpt-oss-120b",
    voiceLang: "auto",
  });
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

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const pref = settings.voiceLang || "auto";
      const voice = pickVoice(pref);
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      } else {
        utter.lang = "bn-BD";
      }
      utter.rate = 1;
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
    } catch (e) {
      /* TTS ব্যর্থ হলেও চ্যাট চলতে থাকবে */
    }
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

    // কল করো: "01712345678 নম্বরে কল করো"
    let m = t.match(/(\+?\d{6,15})\s*(নম্বরে|নাম্বারে)?\s*কল\s*(করো|কর|দাও)/);
    if (m) {
      await doCall(m[1]);
      return true;
    }

    // SMS: "01712345678 নম্বরে sms করো আসছি"
    m = t.match(/(\+?\d{6,15})\s*(নম্বরে|নাম্বারে)?\s*sms\s*(করো|কর|দাও)\s*(.+)/i);
    if (m) {
      const number = m[1];
      const message = m[4].trim();
      pendingSms = { number, message };
      addMessage("bot", `"${number}" নম্বরে লেখা হবে: "${message}" — পাঠাবো? (হ্যাঁ/না)`);
      speak(`${number} নম্বরে এই মেসেজ পাঠাবো কি না নিশ্চিত করো।`);
      return true;
    }

    // অ্যাপ খোলা: "youtube খোলো"
    m = text.match(/^(.+?)\s*খোলো$/);
    if (m && m[1].length <= 30) {
      await doOpenApp(m[1].trim());
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

    return false;
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

  async function doFlashlight(on) {
    if (!PhoneControl) {
      addMessage("bot", "ফ্ল্যাশলাইট কন্ট্রোল এই ডিভাইসে চালু নেই।");
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
      `তুমি SANJU, একজন বুদ্ধিমান, বন্ধুত্বপূর্ণ, একটু রসিক বাংলা ভাষী AI অ্যাসিস্ট্যান্ট — ` +
      `ব্যবহারকারীর নিজস্ব Android অ্যাপ হিসেবে চলছ। ব্যবহারকারীর নাম ${settings.userName || "বস"}। ` +
      `আজকের তারিখ ${dateStr}, এখন সময় ${timeStr}। ` +
      `সংক্ষিপ্ত, স্বাভাবিক, সহজ ভাষায় উত্তর দাও — রোবটের মতো লম্বা-চওড়া ফরমাল উত্তর না দিয়ে ` +
      `একজন বিশ্বস্ত, কাছের মানুষের মতো কথা বলো। প্রয়োজন না হলে ইংরেজি মেশাবে না। ` +
      `তুমি সরাসরি ফোন থেকে কল দেওয়া, SMS পাঠানো, অ্যাপ খোলা, অ্যালার্ম সেট করা, ফ্ল্যাশলাইট জ্বালানো, ` +
      `নোট রাখা আর রিমাইন্ডার সেট করতে পারো — ব্যবহারকারী সরাসরি বললেই (তোমাকে না জানিয়েই) ` +
      `সেগুলো অ্যাপ নিজে হ্যান্ডেল করে ফেলে, তাই এই বিষয়ে প্রশ্ন এলে আত্মবিশ্বাসের সাথে বলবে যে তুমি পারো।`;

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
        await new Promise((r) => setTimeout(r, 900));
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

    const messages = [
      { role: "system", content: buildSystemPrompt() },
      ...history.slice(-MAX_HISTORY_EXCHANGES * 2),
    ];

    let fullReply = "";
    let msgDiv = null;

    try {
      const res = await fetchGroq({
        model: settings.model || "openai/gpt-oss-120b",
        messages,
        temperature: 0.7,
        max_tokens: 1024,
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
          ? data.choices[0].message.content
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
                msgDiv.innerHTML = escapeHtml(fullReply).replace(/\n/g, "<br>");
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
        history.push({ role: "assistant", content: fullReply });
        trimHistoryIfNeeded();
        saveHistory();
        speak(fullReply);
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
      } else {
        addMessage("bot", "দুঃখিত, উত্তর আনতে সমস্যা হলো। ইন্টারনেট চেক করো।");
      }
    } finally {
      isThinking = false;
      setOrbState("প্রস্তুত আছি", "idle");
    }
  }

  /* ============================================================
     মূল ইনপুট হ্যান্ডলার
     ============================================================ */
  async function handleUserInput(text) {
    text = (text || "").trim();
    if (!text) return;

    addMessage("user", text);

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
