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
  { role: 'system', content: 'তুমি SANJU, একজন সহায়ক ব্যক্তিগত AI সহকারী। বাংলায় সংক্ষিপ্ত ও স্পষ্টভাবে উত্তর দাও, প্রয়োজনে হিন্দি বা ইংরেজি শব্দ মিশিয়ে স্বাভাবিকভাবে কথা বলো।' }
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
        model: 'llama-3.3-70b-versatile',
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

// ---------- Text-to-speech ----------
function speak(text) {
  if (!('speechSynthesis' in window)) { setOrbState('idle'); return; }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'bn-BD';
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
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    askSanju(text);
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
el('sendBtn').addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  askSanju(text);
});
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('sendBtn').click();
});
el('micBtn').addEventListener('click', () => toggleMic());
document.querySelectorAll('[data-action="settings"]').forEach(b => b.addEventListener('click', openSettings));
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
