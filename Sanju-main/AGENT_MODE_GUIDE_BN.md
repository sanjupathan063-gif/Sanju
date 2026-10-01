# SANJU Agent Mode (বাংলা)

## কীভাবে ব্যবহার করবে
1. হোম স্ক্রিনে Agent Mode প্যানেলে কাজ লিখে Plan চাপো।
2. SANJU যে ধাপগুলো দেখাবে সেগুলো দেখে “অনুমতি দিয়ে চালাও” চাপো।
3. অ্যাপ খোলা, লোকাল নোট এবং সাধারণ মিনিট-ভিত্তিক রিমাইন্ডার সমর্থিত। অ্যাপ খোলার জন্য Android PhoneControl plugin ও সংশ্লিষ্ট অনুমতি দরকার।

## নিরাপত্তা ও সীমাবদ্ধতা
- প্রতিটি action-এর আগে confirmation dialog দেখায়।
- অ্যাপ চালু করতে ইনস্টল করা অ্যাপের তালিকা থেকে মিল খোঁজে; অ্যাপ না থাকলে ফলাফল জানায়।
- কল/SMS/পেমেন্ট বা অন্য সংবেদনশীল কাজ Agent Mode নিজে থেকে করে না।
- রিমাইন্ডার এই সংস্করণে JavaScript timer-ভিত্তিক; অ্যাপ force-stop/বন্ধ বা ফোন রিস্টার্ট হলে নাও বাজতে পারে। নির্ভরযোগ্য background alarm-এর জন্য Android native WorkManager/AlarmManager integration এবং exact-alarm permission প্রয়োজন।
- এটি সীমিত, অনুমতি-নির্ভর Agent Mode; পূর্ণ autonomous agent নয়।
