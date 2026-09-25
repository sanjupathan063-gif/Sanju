// ---------- State ----------
const store = {
  get apiKey() { return localStorage.getItem('sanju_api_key') || ''; },
  set apiKey(v) { localStorage.setItem('sanju_api_key', v); },
  get userName() { return localStorage.getItem('sanju_user_name') || 'বস'; },
  set userName(v) { localStorage.setItem('sanju_user_name', v); },
};

const el = (id) => document.getElementById(id);
const chatLog = el('chatLog');
const orb = el('orb');
const orbState = el('orbState');
const chatInput = el('chatInput');

const MAX_HISTORY_TURNS = 24; // system + N exchanges
const SYSTEM_PROMPT = { role: 'system', content: 'তুমি Sanju, বসের একজন বুদ্ধিমান ব্যক্তিগত AI সহকারী। বস বাংলা, হিন্দি বা ইংরেজি — যেই ভাষাতেই কথা বলুক না কেন, সেই ভাষাতেই স্বাভাবিকভাবে উত্তর দাও; মিশ্রিত ভাষায় (বাংলা-ইংরেজি বা হিন্দি-ইংরেজি) কথা বললে সেভাবেই স্বাভাবিক থাকবে, ভাষা অনুবাদ করে দেবে না যদি না বলা হয়। ছোট, স্পষ্ট, বন্ধুত্বপূর্ণ উত্তর দাও, দরকার হলে বিস্তারিত করবে। বসকে সম্মান দিয়ে কথা বলবে।' };

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem('sanju_history') || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return [SYSTEM_PROMPT];
}

function saveHistory() {
  const trimmed = [history[0], ...history.slice(-MAX_HISTORY_TURNS)];
  localStorage.setItem('sanju_history', JSON.stringify(trimmed));
}

let history = loadHistory();

// ---------- Greeting ----------
function setGreeting() {
  const hour = new Date().getHours();
  let text = 'শুভ সকাল,';
  if (hour >= 12 && hour < 17) text = 'শুভ অপরাহ্ন,';
  else if (hour >= 17 && hour < 21) text = 'শুভ সন্ধ্যা,';
  else if (hour >= 21 || hour < 5) text = 'শুভ রাত্রি,';
  el('greetingText').textContent = text;
  el('userName').textContent = store.userName;
}

// ---------- Orb state ----------
function setOrbState(mode) {
  // mode: 'idle' | 'listening' | 'thinking' | 'speaking'
  orb.classList.toggle('idle', mode === 'idle');
  const labels = {
    idle: 'প্রস্তুত',
    listening: 'শুনছি...',
    thinking: 'ভাবছি...',
    speaking: 'বলছি...'
  };
  orbState.textContent = labels[mode] || 'প্রস্তুত';
  el('statusLine').textContent = labels[mode] || 'প্রস্তুত';
}

// ---------- Chat rendering ----------
function loadUiLog() {
  try {
    const saved = JSON.parse(localStorage.getItem('sanju_ui_log') || 'null');
    if (Array.isArray(saved)) return saved;
  } catch {}
  return [];
}

let uiLog = loadUiLog();

function saveUiLog() {
  const trimmed = uiLog.slice(-60);
  localStorage.setItem('sanju_ui_log', JSON.stringify(trimmed));
}

function renderMessage(text, who) {
  const bubble = document.createElement('div');
  bubble.className = `msg ${who}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function addMessage(text, who) {
  renderMessage(text, who);
  uiLog.push({ text, who });
  saveUiLog();
}

// ---------- Groq call ----------
async function askSanju(userText) {
  if (!store.apiKey) {
    addMessage('প্রথমে সেটিংস থেকে তোমার Groq API key বসাও।', 'bot');
    openSettings();
    return;
  }
  addMessage(userText, 'user');
  history.push({ role: 'user', content: userText });
  setOrbState('thinking');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${store.apiKey}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: history,
        temperature: 0.7
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'API error');

    const reply = data.choices?.[0]?.message?.content?.trim() || '...';
    history.push({ role: 'assistant', content: reply });
    saveHistory();
    addMessage(reply, 'bot');
    speak(reply);
  } catch (err) {
    addMessage('একটা সমস্যা হয়েছে: ' + err.message, 'bot');
    setOrbState('idle');
  }
}

// ---------- Phone control (native plugin) ----------
const Phone = window.Capacitor?.Plugins?.PhoneControl || null;

async function ensurePermission(alias) {
  if (!Phone) return false;
  try {
    const fn = alias === 'call' ? Phone.requestCallPermission : Phone.requestSmsPermission;
    const res = await fn();
    return !!res?.granted;
  } catch {
    return false;
  }
}

function extractPhoneNumber(text) {
  const match = text.match(/(\+?\d[\d\s-]{6,}\d)/);
  return match ? match[1].replace(/[\s-]/g, '') : null;
}

async function handleCall(number) {
  if (!Phone) { addMessage('এই বিল্ডে ফোন কন্ট্রোল যোগ করা নেই।', 'bot'); return; }
  const granted = await ensurePermission('call');
  if (!granted) { addMessage('কল করার পারমিশন দাওনি, তাই কল করতে পারলাম না।', 'bot'); return; }
  addMessage(`${number} নম্বরে কল করছি...`, 'bot');
  try {
    await Phone.callNumber({ number });
  } catch (e) {
    addMessage('কল করতে সমস্যা হলো: ' + e.message, 'bot');
  }
}

async function handleSms(number, message) {
  if (!Phone) { addMessage('এই বিল্ডে ফোন কন্ট্রোল যোগ করা নেই।', 'bot'); return; }
  const granted = await ensurePermission('sms');
  if (!granted) { addMessage('SMS পাঠানোর পারমিশন দাওনি।', 'bot'); return; }
  try {
    await Phone.sendSms({ number, message });
    addMessage(`${number} নম্বরে "${message}" মেসেজ পাঠিয়ে দিয়েছি।`, 'bot');
  } catch (e) {
    addMessage('মেসেজ পাঠাতে সমস্যা হলো: ' + e.message, 'bot');
  }
}

async function handleOpenApp(appName) {
  if (!Phone) { addMessage('এই বিল্ডে ফোন কন্ট্রোল যোগ করা নেই।', 'bot'); return; }
  try {
    const { apps } = await Phone.listApps();
    const needle = appName.trim().toLowerCase();
    const found = apps.find(a => a.label.toLowerCase().includes(needle));
    if (!found) { addMessage(`"${appName}" নামে কোনো অ্যাপ খুঁজে পেলাম না।`, 'bot'); return; }
    await Phone.openApp({ packageName: found.packageName });
    addMessage(`${found.label} খুলে দিলাম।`, 'bot');
  } catch (e) {
    addMessage('অ্যাপ খুলতে সমস্যা হলো: ' + e.message, 'bot');
  }
}

function bnToArabicDigits(text) {
  const map = { '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9' };
  return text.replace(/[০-৯]/g, d => map[d]);
}

function parseAlarmTime(text) {
  const t = bnToArabicDigits(text);
  let hour = null, minute = 0;

  let m = t.match(/(\d{1,2})[:ঃ.](\d{2})/);
  if (m) {
    hour = parseInt(m[1], 10);
    minute = parseInt(m[2], 10);
  } else {
    m = t.match(/(\d{1,2})\s*টা/) || t.match(/(\d{1,2})\b/);
    if (m) hour = parseInt(m[1], 10);
  }
  if (hour === null || isNaN(hour)) return null;

  const isPM = /বিকাল|সন্ধ্যা|রাত|pm/i.test(text);
  const isAM = /সকাল|ভোর|সকালে|am/i.test(text);
  if (isPM && hour < 12) hour += 12;
  if (isAM && hour === 12) hour = 0;

  return { hour: hour % 24, minute: minute % 60 };
}

async function handleAlarm(text) {
  if (!Phone) { addMessage('এই বিল্ডে অ্যালার্ম ফিচার যোগ করা নেই।', 'bot'); return; }
  const time = parseAlarmTime(text);
  if (!time) { addMessage('ঠিক কয়টায় অ্যালার্ম দিতে চাও বুঝতে পারলাম না, যেমন লিখে দেখো: "সকাল ৭টায় অ্যালার্ম দাও"', 'bot'); return; }
  try {
    await Phone.setAlarm({ hour: time.hour, minute: time.minute, message: 'Sanju Alarm' });
    const hh = String(time.hour).padStart(2, '0');
    const mm = String(time.minute).padStart(2, '0');
    addMessage(`${hh}:${mm}-এ অ্যালার্ম সেট করে দিলাম।`, 'bot');
  } catch (e) {
    addMessage('অ্যালার্ম সেট করতে সমস্যা হলো: ' + e.message, 'bot');
  }
}

async function handleFlashlight(on) {
  if (!Phone) { addMessage('এই বিল্ডে ফ্ল্যাশলাইট ফিচার যোগ করা নেই।', 'bot'); return; }
  try {
    await Phone.toggleFlashlight({ on });
    addMessage(on ? 'ফ্ল্যাশলাইট জ্বালিয়ে দিলাম।' : 'ফ্ল্যাশলাইট বন্ধ করে দিলাম।', 'bot');
  } catch (e) {
    addMessage('ফ্ল্যাশলাইট চালাতে সমস্যা হলো: ' + e.message, 'bot');
  }
}

// Returns true if the text was handled as a phone-control command
async function tryPhoneCommand(text) {
  if (/অ্যালার্ম|এলার্ম|alarm/i.test(text)) {
    addMessage(text, 'user');
    await handleAlarm(text);
    return true;
  }

  if (/ফ্ল্যাশ(লাইট)?|টর্চ|flashlight|torch/i.test(text)) {
    const on = !/বন্ধ|নিভাও|off/i.test(text);
    addMessage(text, 'user');
    await handleFlashlight(on);
    return true;
  }

  const number = extractPhoneNumber(text);

  if (number && /sms|এসএমএস|মেসেজ\s*(পাঠাও|করো)/i.test(text)) {
    addMessage(text, 'user');
    let message = text
      .replace(number, '')
      .replace(/sms|এসএমএস|মেসেজ|পাঠাও|করো|নম্বরে/gi, '')
      .trim();
    if (!message) message = 'হাই';
    await handleSms(number, message);
    return true;
  }

  if (number && /কল\s*(করো|দাও)|call/i.test(text)) {
    addMessage(text, 'user');
    await handleCall(number);
    return true;
  }

  const openMatch =
    text.match(/(?:open|চালু করো)\s+([a-zA-Z0-9\u0980-\u09FF ]+)/i) ||
    text.match(/([a-zA-Z0-9\u0980-\u09FF]+)\s+খোলো/i);
  if (openMatch) {
    addMessage(text, 'user');
    await handleOpenApp(openMatch[1].trim());
    return true;
  }

  return false;
}

// ---------- Text-to-speech ----------
function detectSpeechLang(text) {
  if (/[\u0980-\u09FF]/.test(text)) return 'bn-BD';   // Bengali script
  if (/[\u0900-\u097F]/.test(text)) return 'hi-IN';   // Devanagari (Hindi)
  return 'en-IN';                                     // Latin script fallback
}

const Tts = window.Capacitor?.Plugins?.Tts || null;

async function speak(text) {
  const language = detectSpeechLang(text);

  if (Tts) {
    try {
      setOrbState('speaking');
      await Tts.speak({
        text: text,
        language: language
      });
      setOrbState('idle');
      return;
    } catch (e) {
      console.warn('Native TTS failed:', e);
    }
  }

  // Browser fallback
  if (!('speechSynthesis' in window)) {
    setOrbState('idle');
    return;
  }

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = language;
  utter.rate = 1;
  utter.onstart = () => setOrbState('speaking');
  utter.onend = () => setOrbState('idle');

  window.speechSynthesis.speak(utter);
}

// ---------- Speech-to-text (native plugin, with WebView fallback) ----------
const VoiceInput = window.Capacitor?.Plugins?.VoiceInput || null;

async function ensureMicPermission() {
  if (!VoiceInput) return false;
  try {
    const res = await VoiceInput.requestMicPermission();
    return !!res?.granted;
  } catch {
    return false;
  }
}

// Legacy WebView Web Speech API — kept only as a fallback if the native
// plugin isn't present in this build (e.g. running in a plain browser tab).
let recognition = null;
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
function initRecognition() {
  if (!SpeechRecognitionAPI) return null;
  const rec = new SpeechRecognitionAPI();
  rec.lang = 'bn-BD';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = async (e) => {
    const text = e.results[0][0].transcript;
    const handled = await tryPhoneCommand(text);
    if (!handled) askSanju(text);
  };
  rec.onerror = () => { setOrbState('idle'); toggleMic(false); };
  rec.onend = () => toggleMic(false);
  return rec;
}

let recording = false;

async function toggleMic(forceState) {
  const micBtn = el('micBtn');

  // Native path: one press-to-talk cycle via Android's real SpeechRecognizer
  if (VoiceInput) {
    if (recording) return; // already listening, ignore extra taps
    const granted = await ensureMicPermission();
    if (!granted) { addMessage('মাইক ব্যবহারের পারমিশন দাওনি।', 'bot'); return; }
    recording = true;
    micBtn.classList.add('recording');
    setOrbState('listening');
    try {
      const res = await VoiceInput.listen({ language: 'bn-BD' });
      const text = (res?.text || '').trim();
      if (text) {
        const handled = await tryPhoneCommand(text);
        if (!handled) await askSanju(text);
      } else {
        setOrbState('idle');
      }
    } catch (e) {
      addMessage('কথা ঠিকমতো ধরতে পারলাম না, আবার চেষ্টা করো।', 'bot');
      setOrbState('idle');
    } finally {
      recording = false;
      micBtn.classList.remove('recording');
    }
    return;
  }

  // Fallback path: legacy WebView Web Speech API
  recording = typeof forceState === 'boolean' ? forceState : !recording;
  micBtn.classList.toggle('recording', recording);
  if (recording) {
    if (!recognition) recognition = initRecognition();
    if (!recognition) {
      addMessage('এই বিল্ডে ভয়েস ইনপুট চালু নেই, টাইপ করে জিজ্ঞেস করো।', 'bot');
      recording = false;
      micBtn.classList.remove('recording');
      return;
    }
    setOrbState('listening');
    recognition.start();
  } else {
    if (recognition) recognition.stop();
    setOrbState('idle');
  }
}

// ---------- Scan HUD ----------
async function appendHudLine(html) {
  const line = document.createElement('div');
  line.className = 'line';
  line.innerHTML = html;
  el('hudLog').appendChild(line);
  await new Promise(r => setTimeout(r, 420));
}

async function runSystemScan() {
  const hudLog = el('hudLog');
  hudLog.innerHTML = '';
  el('scanModal').classList.add('open');

  await appendHudLine('&gt; SYSTEM SCAN <b>শুরু হচ্ছে...</b>');

  try {
    if (navigator.getBattery) {
      const battery = await navigator.getBattery();
      const pct = Math.round(battery.level * 100);
      await appendHudLine(`&gt; POWER CORE: <b>${pct}%</b> ${battery.charging ? '(চার্জিং)' : ''}`);
    } else {
      await appendHudLine('&gt; POWER CORE: <b>N/A</b>');
    }
  } catch { await appendHudLine('&gt; POWER CORE: <b>N/A</b>'); }

  const conn = navigator.connection;
  const netLabel = conn ? (conn.effectiveType || 'অনলাইন').toUpperCase() : (navigator.onLine ? 'অনলাইন' : 'অফলাইন');
  await appendHudLine(`&gt; NETWORK LINK: <b>${netLabel}</b>`);

  if (Phone) {
    try {
      const { apps } = await Phone.listApps();
      await appendHudLine(`&gt; INSTALLED MODULES: <b>${apps.length} apps</b>`);
    } catch {
      await appendHudLine('&gt; INSTALLED MODULES: <b>N/A</b>');
    }
  } else {
    await appendHudLine('&gt; INSTALLED MODULES: <b>N/A (phone control নেই)</b>');
  }

  try {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const usedGB = (usage / (1024 ** 3)).toFixed(1);
      const quotaGB = (quota / (1024 ** 3)).toFixed(1);
      await appendHudLine(`&gt; STORAGE: <b>${usedGB} GB</b> / ${quotaGB} GB`);
    } else {
      await appendHudLine('&gt; STORAGE: <b>N/A</b>');
    }
  } catch { await appendHudLine('&gt; STORAGE: <b>N/A</b>'); }

  await appendHudLine('&gt; DIAGNOSTIC <b>COMPLETE</b> — সব সিস্টেম স্বাভাবিক ✅');
}

// ---------- Device status (best-effort, works without native plugins) ----------
async function updateDeviceStatus() {
  try {
    if (navigator.getBattery) {
      const battery = await navigator.getBattery();
      el('batteryValue').textContent = Math.round(battery.level * 100) + '%';
    } else {
      el('batteryValue').textContent = '—';
    }
  } catch { el('batteryValue').textContent = '—'; }

  const conn = navigator.connection;
  el('networkValue').textContent = conn ? (conn.effectiveType || 'অনলাইন').toUpperCase() : (navigator.onLine ? 'অনলাইন' : 'অফলাইন');
}

// ---------- Settings modal ----------
function openSettings() {
  el('apiKeyInput').value = store.apiKey;
  el('nameInput').value = store.userName;
  el('settingsModal').classList.add('open');
}
function closeSettings() { el('settingsModal').classList.remove('open'); }

// ---------- Wire up events ----------
el('sendBtn').addEventListener('click', async () => {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  const handled = await tryPhoneCommand(text);
  if (!handled) askSanju(text);
});
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('sendBtn').click();
});
el('micBtn').addEventListener('click', () => toggleMic());
document.querySelectorAll('[data-action="settings"]').forEach(b => b.addEventListener('click', openSettings));
document.querySelectorAll('[data-action="phone"]').forEach(b => b.addEventListener('click', async () => {
  if (!Phone) {
    addMessage('এই বিল্ডে ফোন কন্ট্রোল যোগ করা নেই। GitHub থেকে সবশেষ ভার্সন দিয়ে APK বানাও।', 'bot');
    return;
  }
  const callOk = await ensurePermission('call');
  const smsOk = await ensurePermission('sms');
  addMessage(
    `ফোন কন্ট্রোল ${callOk && smsOk ? 'চালু হলো' : 'আংশিক চালু হলো'}। এভাবে বলো:\n` +
    `• "01712345678 নম্বরে কল করো"\n` +
    `• "01712345678 নম্বরে sms করো আসছি"\n` +
    `• "youtube খোলো"`,
    'bot'
  );
}));
el('closeSettings').addEventListener('click', closeSettings);
el('saveSettings').addEventListener('click', () => {
  store.apiKey = el('apiKeyInput').value.trim();
  store.userName = el('nameInput').value.trim() || 'বস';
  setGreeting();
  closeSettings();
});
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'scan') runSystemScan();
  });
});
el('closeScan').addEventListener('click', () => el('scanModal').classList.remove('open'));

// ---------- Init ----------
setGreeting();
setOrbState('idle');
updateDeviceStatus();
if (uiLog.length) {
  uiLog.forEach(m => renderMessage(m.text, m.who));
} else if (!store.apiKey) {
  setTimeout(() => addMessage('হাই! আমি SANJU। শুরু করতে সেটিংসে গিয়ে তোমার Groq API key বসাও।', 'bot'), 400);
} else {
  setTimeout(() => addMessage('হাই বস, আমি SANJU। কী করতে পারি তোমার জন্য?', 'bot'), 400);
}
