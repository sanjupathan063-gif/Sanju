# SANJU command routing improvements

এই সংস্করণে command routing-এ কয়েকটি গুরুত্বপূর্ণ ভুল ঠিক করা হয়েছে:

- `YouTube` + `ভিডিও/কার্টুন/গান/...` এখন **content search** হিসেবে ধরা হয়; app name হিসেবে নয়।
- `একটা কার্টুন ভিডিও চালাও` → YouTube search query `cartoon`।
- `YouTube থেকে একটা cartoon video চালাও` → YouTube content search।
- `YouTube খোলো` → YouTube app launch intent।
- WhatsApp/Chrome/Gmail/Maps-এর মতো app launch শুধু explicit open/খোলো/চালু করো command-এ হয়।
- Strong local device/content intent backend AI-কে override করতে পারে, যাতে backend ভুল classification করলে device action নষ্ট না হয়।
- Native Android `searchYouTube` ও `openUrl` bridge যোগ করা হয়েছে; YouTube app না থাকলে browser fallback।
- Unsupported command হলে এখন fake “completed” response না দিয়ে বুঝতে না পারার কথা জানায়।
- Agent Mode-এ content command এবং app command আলাদা করা হয়েছে।

নোট: Android permission, installed app, OS version, WebView/Capacitor configuration এবং device policy অনুযায়ী native action-এর ফল ভিন্ন হতে পারে।
