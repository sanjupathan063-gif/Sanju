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

let history = [
  { role: 'system', content: 'তুমি Sanju, বসের একজন বুদ্ধিমান ব্যক্তিগত AI সহকারী। বস বাংলা, হিন্দি বা ইংরেজি — যেই ভাষাতেই কথা বলুক না কেন, সেই ভাষাতেই স্বাভাবিকভাবে উত্তর দাও; মিশ্রিত ভাষায় (বাংলা-ইংরেজি বা হিন্দি-ইংরেজি) কথা বললে সেভাবেই স্বাভাবিক থাকবে, ভাষা অনুবাদ করে দেবে না যদি না বলা হয়। ছোট, স্পষ্ট, বন্ধুত্বপূর্ণ উত্তর দাও, দরকার হলে বিস্তারিত করবে। বসকে সম্মান দিয়ে কথা বলবে।' }
];

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
function addMessage(text, who) {
  const bubble = document.createElement('div');
  bubble.className = `msg ${who}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
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

// Returns true if the text was handled as a phone-control command
async function tryPhoneCommand(text) {
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

function speak(text) {
  if (!('speechSynthesis' in window)) { setOrbState('idle'); return; }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = detectSpeechLang(text);
  utter.rate = 1;
  utter.onstart = () => setOrbState('speaking');
  utter.onend = () => setOrbState('idle');
  window.speechSynthesis.speak(utter);
}

// ---------- Speech-to-text ----------
let recognition = null;
let recording = false;
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

function toggleMic(forceState) {
  const micBtn = el('micBtn');
  recording = typeof forceState === 'boolean' ? forceState : !recording;
  micBtn.classList.toggle('recording', recording);
  if (recording) {
    if (!recognition) recognition = initRecognition();
    if (!recognition) {
      addMessage('এই ফোনে ভয়েস ইনপুট সাপোর্ট নেই, টাইপ করে জিজ্ঞেস করো।', 'bot');
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
  });
});

// ---------- Init ----------
setGreeting();
setOrbState('idle');
updateDeviceStatus();
if (!store.apiKey) {
  setTimeout(() => addMessage('হাই! আমি SANJU। শুরু করতে সেটিংসে গিয়ে তোমার Groq API key বসাও।', 'bot'), 400);
}
