# SANJU — Android App (GitHub দিয়ে APK বিল্ড)

এই ফোল্ডারে একটা সম্পূর্ণ, বিল্ড-রেডি Capacitor প্রজেক্ট আছে। GitHub-এ পুশ করলেই
GitHub Actions নিজে থেকে `.apk` বানিয়ে দেবে — তোমার ফোনে Android Studio বা Buildozer
কিছুই লাগবে না।

## ফোল্ডার গঠন
```
sanju-app/
├── www/                  ← UI (HTML/CSS/JS) — এখানেই ডিজাইন এডিট করবে
│   ├── index.html
│   ├── style.css
│   └── app.js
├── native-patches/        ← ফোন কন্ট্রোল (কল/SMS/apps) দেওয়া নেটিভ Android কোড
├── capacitor.config.json
├── package.json
└── .github/workflows/build-apk.yml   ← GitHub Actions বিল্ড স্ক্রিপ্ট
```

## ধাপ ১: GitHub রিপো বানাও
GitHub.com থেকে একটা নতুন **public বা private repository** বানাও, যেমন `sanju-app`।

## ধাপ ২: Termux থেকে পুশ করো
```bash
cd sanju-app
git init
git add .
git commit -m "Sanju app first version"
git branch -M main
git remote add origin https://github.com/<তোমার-ইউজারনেম>/sanju-app.git
git push -u origin main
```
(GitHub-এ পাসওয়ার্ডের বদলে Personal Access Token লাগবে — Settings → Developer settings → Personal access tokens থেকে বানিয়ে নাও।)

## ধাপ ৩: বিল্ড হওয়া দেখো
পুশ করার পর GitHub রিপোর **Actions** ট্যাবে যাও। "Build Sanju APK" workflow
নিজে থেকেই চলা শুরু করবে (৩-৫ মিনিট লাগে)।

## ধাপ ৪: APK ডাউনলোড করো
Workflow শেষ হলে সেই রানের পেজে নিচে **Artifacts** সেকশনে `sanju-debug-apk`
নামে একটা zip পাবে — ডাউনলোড করে ফোনে আনজিপ করলে `app-debug.apk` পাবে। এটাই
ইনস্টল করবে (Settings → Install unknown apps → অনুমতি দিতে হবে)।

## অ্যাপ প্রথমবার চালু করলে
প্রথমবার খুলে ⚙️ সেটিংস বাটনে গিয়ে তোমার **Groq API key** বসাও (একই key যেটা
Termux স্ক্রিপ্টে ব্যবহার করছ)। এরপর থেকে চ্যাট বক্স বা মাইক বাটনে জিজ্ঞেস করলে
সরাসরি অ্যাপ থেকেই Groq-কে কল হবে, Termux চালু রাখার দরকার নেই।

## যা জানা দরকার (সীমাবদ্ধতা)
- **কথা বলা (TTS)**: Android WebView-তে ভালোভাবেই কাজ করে — Sanju উত্তর মুখে বলবে।
- **মাইক দিয়ে কথা শোনা (voice input)**: Android-এর WebView browser speech-recognition
  API সাপোর্ট করে না, তাই মাইক বাটন অনেক ফোনে কাজ নাও করতে পারতে পারে। আপাতত টাইপ
  করেই জিজ্ঞেস করাটাই সবচেয়ে ভরসাযোগ্য। ভবিষ্যতে চাইলে native
  `@capacitor-community/speech-recognition` প্লাগিন যোগ করে আসল মাইক সাপোর্ট আনা যায়
  — সেটা চাইলে বলো, workflow আপডেট করে দেব।

## ফোন কন্ট্রোল (কল, SMS, apps খোলা)
এখন সরাসরি এই অ্যাপ থেকেই কল করা, SMS পাঠানো আর অন্য অ্যাপ খোলা যায় — Termux বা আলাদা
কোনো Accessibility সার্ভিস ছাড়াই। হোমস্ক্রিনে **ফোন কন্ট্রোল** বাটনে একবার ট্যাপ করলে
Android পারমিশন (কল আর SMS) চাইবে, সেটা "Allow" দিলেই যথেষ্ট। এরপর চ্যাট বক্সে বা
মাইকে এভাবে বলা/লেখা যাবে:
- `01712345678 নম্বরে কল করো`
- `01712345678 নম্বরে sms করো আসছি`
- `youtube খোলো`

এই তিনটা প্যাটার্ন মিললে অ্যাপ সরাসরি ফোনকে কমান্ড দেয়, Groq-কে জিজ্ঞেস করে না। এর বাইরের
যেকোনো কথা স্বাভাবিকভাবেই Sanju-কে (Groq) জিজ্ঞেস করা হয়।

**সতর্কতা**: `sendSms` পারমিশন পেলে অ্যাপ কোনো কনফার্মেশন ছাড়াই সরাসরি SMS
পাঠিয়ে দেয় — নম্বর ভুল করে বললে ভুল নম্বরেই মেসেজ চলে যাবে, তাই এই ফিচারটা নিজের
বিশ্বস্ত ফোনেই রাখা ভালো।

## ডিজাইন বদলাতে চাইলে
`www/style.css`-এর উপরে `:root` ভেরিয়েবলগুলো (রং) বদলালেই পুরো থিম বদলে যাবে।
নাম "SANJU" থেকে অন্য কিছু করতে চাইলে `index.html`-এ `.brand` আর `.wordmark`
লেখা দুটো জায়গা বদলাও।
