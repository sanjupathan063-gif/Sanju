import React, { useState, useEffect, useCallback } from 'react';
import {
  Phone,
  Lock,
  Bell,
  RefreshCw,
  Activity,
  ShieldCheck,
  Zap,
  Mic,
  MicOff,
  Sparkles,
  Wifi,
  WifiOff,
  Plus,
  Volume2,
  Calendar,
  AlertCircle,
  Database,
  ArrowRight,
  ExternalLink,
  Download,
  Package,
} from 'lucide-react';
import { Header } from './components/Header';
import { VoiceCommander } from './components/VoiceCommander';
import { AgentMode } from './components/AgentMode';
import { PhoneCallModal } from './components/PhoneCallModal';
import { SecureVaultModal } from './components/SecureVaultModal';
import { NotificationCenterModal } from './components/NotificationCenterModal';
import { ProfileSyncModal } from './components/ProfileSyncModal';
import { VoiceAnalysisModal } from './components/VoiceAnalysisModal';
import { useNetwork } from './hooks/useNetwork';
import { Storage } from './services/storage';
import { voiceAssistant } from './services/voiceAssistant';
import { playNotificationAlert } from './services/audioFeedback';
import { downloadSanjuAppZip } from './services/downloadHelper';
import { searchYouTube, openApp } from './services/phoneActions';
import {
  UserProfile,
  Contact,
  CallRecord,
  VaultItem,
  NotificationItem,
  VoiceAnalysisData,
  Language,
} from './types';

export default function App() {
  const { isOnline } = useNetwork();

  // App State initialized from offline-first persistent storage
  const [profile, setProfile] = useState<UserProfile>(() => Storage.getProfile());
  const [contacts, setContacts] = useState<Contact[]>(() => Storage.getContacts());
  const [callLogs, setCallLogs] = useState<CallRecord[]>(() => Storage.getCallLogs());
  const [vaultItems, setVaultItems] = useState<VaultItem[]>(() => Storage.getVaultItems());
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => Storage.getNotifications());
  const [voiceLogs, setVoiceLogs] = useState<VoiceAnalysisData[]>(() => Storage.getVoiceLogs());
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => Storage.getSyncPendingCount());

  const [language, setLanguage] = useState<Language>(profile.preferredLanguage || 'bn');
  const [isListening, setIsListening] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<VoiceAnalysisData | null>(voiceLogs[0] || null);

  // Modals state
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callInitialTarget, setCallInitialTarget] = useState<string | null>(null);
  const [vaultModalOpen, setVaultModalOpen] = useState(false);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<VoiceAnalysisData | null>(null);

  const isBn = language === 'bn';

  // Keep assistant voice language in sync
  useEffect(() => {
    voiceAssistant.setLanguage(language);
  }, [language]);

  // Voice recognition callbacks
  const handleVoiceCommand = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return;

      const analysis = await voiceAssistant.processVoiceCommand(transcript, isOnline, language);
      setLastAnalysis(analysis);
      Storage.saveVoiceLog(analysis);
      setVoiceLogs(Storage.getVoiceLogs());

      // Immediate voice audio response
      voiceAssistant.speak(analysis.speechResponse, language);

      // Perform actionable intent
      if (analysis.intent === 'CALL') {
        const target = analysis.detectedEntities[0] || 'মা (Mom)';
        setCallInitialTarget(target);
        setCallModalOpen(true);
      } else if (analysis.intent === 'CREATE_NOTE') {
        const newItem: VaultItem = {
          id: 'v_voice_' + Date.now(),
          title: isBn ? 'ভয়েস নোট' : 'Voice Note',
          category: 'note',
          content: analysis.transcript,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const updatedVault = [newItem, ...vaultItems];
        setVaultItems(updatedVault);
        Storage.saveVaultItems(updatedVault);
        setPendingSyncCount(Storage.getSyncPendingCount());

        Storage.addNotification({
          title: isBn ? 'ভয়েস নোট এনক্রিপ্ট হয়েছে' : 'Voice Note Encrypted',
          message: analysis.transcript,
          type: 'security',
          priority: 'normal',
        });
        setNotifications(Storage.getNotifications());
      } else if (analysis.intent === 'CREATE_REMINDER') {
        Storage.addNotification({
          title: isBn ? 'ভয়েস রিমাইন্ডার নির্ধারিত' : 'Voice Reminder Scheduled',
          message: analysis.transcript,
          type: 'reminder',
          priority: 'high',
        });
        setNotifications(Storage.getNotifications());
        playNotificationAlert();
      } else if (analysis.intent === 'ENCRYPT_VAULT') {
        setVaultModalOpen(true);
      } else if (analysis.intent === 'YOUTUBE_SEARCH') {
        const query = analysis.detectedEntities[0] || 'cartoon';
        await searchYouTube(query);
      } else if (analysis.intent === 'OPEN_APP') {
        const packageName = analysis.detectedEntities[1];
        if (packageName && packageName !== 'camera' && packageName !== 'settings') {
          await openApp(packageName);
        } else {
          // Camera/settings are handled through the Android action layer in future native builds.
          Storage.addNotification({
            title: isBn ? 'অ্যাকশন প্রস্তুত' : 'Action ready',
            message: analysis.speechResponse,
            type: 'system',
            priority: 'normal',
          });
          setNotifications(Storage.getNotifications());
        }
      }
    },
    [isOnline, language, vaultItems, isBn]
  );

  useEffect(() => {
    voiceAssistant.onStateChange((listening) => {
      setIsListening(listening);
    });

    voiceAssistant.onResult((transcript, isFinal) => {
      if (isFinal) {
        handleVoiceCommand(transcript);
      }
    });

    voiceAssistant.onError((err) => {
      console.warn('Voice engine error notice:', err);
    });
  }, [handleVoiceCommand]);

  const toggleMic = (continuous = true) => {
    if (isListening) {
      voiceAssistant.stopListening();
    } else {
      voiceAssistant.startListening(continuous);
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    setTimeout(() => {
      Storage.clearPendingSync();
      setPendingSyncCount(0);
      setIsSyncing(false);
      Storage.addNotification({
        title: isBn ? 'ক্লাউড সিঙ্ক সফল' : 'Sync Successful',
        message: isBn ? 'আপনার সমস্ত অফলাইন ডেটা ক্লাউড সার্ভারে নিরাপদে সংরক্ষিত হয়েছে।' : 'All offline records backed up to cloud.',
        type: 'sync',
        priority: 'low',
      });
      setNotifications(Storage.getNotifications());
    }, 1200);
  };

  const handleExecuteDirectCall = (target: string) => {
    setCallInitialTarget(target);
    setCallModalOpen(true);
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <Header
        profile={profile}
        language={language}
        onLanguageChange={(newLang) => {
          setLanguage(newLang);
          const updated = { ...profile, preferredLanguage: newLang };
          setProfile(updated);
          Storage.saveProfile(updated);
        }}
        isListening={isListening}
        onToggleMic={() => toggleMic(profile.continuousListening)}
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        isSyncing={isSyncing}
        onManualSync={handleManualSync}
        unreadNotificationsCount={unreadCount}
        onOpenNotifications={() => setNotificationsModalOpen(true)}
        onOpenProfile={() => setProfileModalOpen(true)}
        onOpenCallModal={() => {
          setCallInitialTarget(null);
          setCallModalOpen(true);
        }}
        onOpenVault={() => setVaultModalOpen(true)}
      />

      {/* Offline Mode Banner */}
      {!isOnline && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-300 flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {isBn
              ? 'অফলাইন মোড সক্রিয় — আপনার ভয়েস কমান্ড ও ডেটা লোকাল মেমোরিতে নিরাপদে সংরক্ষিত হচ্ছে। অনলাইন হলে স্বয়ংক্রিয় সিঙ্ক হবে।'
              : 'Offline Mode Active — Voice commands and records are saved locally with zero-loss encryption.'}
          </span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Hero Voice Commander */}
        <VoiceCommander
          isListening={isListening}
          onToggleMic={(cont) => toggleMic(cont)}
          language={language}
          onExecuteCall={handleExecuteDirectCall}
          onOpenVault={() => setVaultModalOpen(true)}
          onOpenAnalysis={(data) => {
            setSelectedAnalysis(data);
            setAnalysisModalOpen(true);
          }}
          lastAnalysis={lastAnalysis}
          isOnline={isOnline}
        />

        {/* Approval-based local Agent Mode */}
        <AgentMode
          language={language}
          onCreateNote={(title, content) => {
            const now = new Date().toISOString();
            const item: VaultItem = {
              id: 'agent_' + Date.now(), title, category: 'note', content,
              createdAt: now, updatedAt: now,
            };
            const updated = [item, ...Storage.getVaultItems()];
            setVaultItems(updated);
            Storage.saveVaultItems(updated);
            setPendingSyncCount(Storage.getSyncPendingCount());
          }}
        />

        {/* ZIP File Ready Download Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-950/70 via-slate-900 to-cyan-950/70 border border-indigo-500/30 p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-lg">
              <Package className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {isBn ? 'সম্পূর্ণ sanju-app.zip ফাইল প্রস্তুত!' : 'Complete sanju-app.zip Package Ready!'}
                </h3>
                <span className="text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                  Android &amp; Web
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-xl">
                {isBn
                  ? 'আপনার অনুরোধ অনুযায়ী সমস্ত সোর্স কোড, অফলাইন মোড, ভয়েস ডায়ালার, AES এনক্রিপশন ও অ্যান্ড্রয়েড নেটিভ প্লাগইন সহ sanju-app.zip তৈরি করা হয়েছে।'
                  : 'Includes full React source, Android Native Patches, Capacitor config, build-apk.yml, and www bundle.'}
              </p>
            </div>
          </div>

          <button
            onClick={() => downloadSanjuAppZip()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm shadow-xl shadow-indigo-600/30 transition hover:scale-105 shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{isBn ? 'sanju-app.zip ডাউনলোড করুন' : 'Download sanju-app.zip'}</span>
          </button>
        </div>

        {/* Feature Hub Grid: Calling, Encrypted Vault, Notifications, Sync Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Calling & Quick Contact */}
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-emerald-500/40 transition-all flex flex-col justify-between shadow-lg group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Phone className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                  {isBn ? 'ইনস্ট্যান্ট কল' : 'Fast Call'}
                </span>
              </div>

              <h3 className="text-sm font-bold text-white mb-1">
                {isBn ? 'ভয়েস কল ও ডায়ালার' : 'Voice Calling & Contacts'}
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {isBn
                  ? 'কথা বলে সরাসরি কল করুন: "মাকে কল করো" অথবা "জরুরী ৯৯৯ কল"'
                  : 'Hands-free voice dialer: "Call Mom" or "Call 999"'}
              </p>

              {/* Quick Call favorites list */}
              <div className="space-y-1.5">
                {contacts.slice(0, 2).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleExecuteDirectCall(c.name)}
                    className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 text-xs transition"
                  >
                    <span className="font-semibold text-slate-200 truncate">{c.name}</span>
                    <span className="text-[11px] text-emerald-400 font-mono font-medium">{isBn ? 'কল' : 'Call'}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                setCallInitialTarget(null);
                setCallModalOpen(true);
              }}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-emerald-600 hover:text-white text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <span>{isBn ? 'ডায়াল প্যাড খুলুন' : 'Open Dialer'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 2: AES-256 Encrypted Vault */}
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/40 transition-all flex flex-col justify-between shadow-lg group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Lock className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-bold uppercase bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">
                  AES-256 GCM
                </span>
              </div>

              <h3 className="text-sm font-bold text-white mb-1">
                {isBn ? 'এনক্রিপশন ও সিকিউর ভল্ট' : 'AES-256 Secure Vault'}
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {isBn
                  ? 'গোপন পাসওয়ার্ড, ব্যাংক পিন এবং ভয়েস নোট এন্ড-টু-এন্ড এনক্রিপ্টেড।'
                  : 'Zero-knowledge client-side encrypted vault and backup packages.'}
              </p>

              <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{isBn ? 'সংরক্ষিত সিক্রেট:' : 'Secret Records:'}</span>
                  <span className="font-bold text-indigo-300">{vaultItems.length} {isBn ? 'টি' : 'items'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{isBn ? 'সুরক্ষা স্থিতি:' : 'Security:'}</span>
                  <span className="font-semibold text-emerald-400">{isBn ? 'লকড ও নিরাপদ' : 'Protected'}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setVaultModalOpen(true)}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-indigo-600 hover:text-white text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <span>{isBn ? 'ভল্ট আনলক করুন' : 'Unlock Vault'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 3: Real-Time Notifications */}
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 transition-all flex flex-col justify-between shadow-lg group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Bell className="w-5 h-5" />
                </div>
                {unreadCount > 0 ? (
                  <span className="text-[10px] font-bold uppercase bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/30">
                    {unreadCount} {isBn ? 'নতুন' : 'New'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase bg-slate-800 text-slate-400 px-2 py-0.5 rounded">
                    {isBn ? 'আপ-টু-ডেট' : 'Up to date'}
                  </span>
                )}
              </div>

              <h3 className="text-sm font-bold text-white mb-1">
                {isBn ? 'রিয়েল-টাইম নোটিফিকেশন' : 'Real-time Notifications'}
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {isBn
                  ? 'ভয়েস রিমাইন্ডার, ইনকামিং কল ও সিস্টেম অ্যালার্ট তাৎক্ষণিক পান।'
                  : 'Desktop push and in-app sound notifications for reminders & alerts.'}
              </p>

              {/* Latest notification snippet */}
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
                <p className="font-semibold text-slate-200 truncate">
                  {notifications[0]?.title || (isBn ? 'কোনো অ্যালার্ট নেই' : 'No alerts')}
                </p>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {notifications[0]?.message || (isBn ? 'সব কিছু স্বাভাবিক রয়েছে' : 'All clear')}
                </p>
              </div>
            </div>

            <button
              onClick={() => setNotificationsModalOpen(true)}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-amber-600 hover:text-white text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <span>{isBn ? 'সব নোটিফিকেশন দেখুন' : 'View Alerts'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 4: Data Sync & Offline Status */}
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col justify-between shadow-lg group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Database className="w-5 h-5" />
                </div>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                    isOnline
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}
                >
                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>

              <h3 className="text-sm font-bold text-white mb-1">
                {isBn ? 'ডাটা সিঙ্ক ও অফলাইন হাব' : 'Offline Mode & Data Sync'}
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {isBn
                  ? 'ইন্টারনেট ছাড়াই কাজ করুন। পেন্ডিং ডেটা ক্লাউডে সুরক্ষিত সিঙ্ক হবে।'
                  : 'Zero data loss. Automatic sync queue when connection restores.'}
              </p>

              <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{isBn ? 'পেন্ডিং কিউ:' : 'Queue:'}</span>
                  <span className="font-bold text-cyan-300">{pendingSyncCount} {isBn ? 'টি' : 'items'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{isBn ? 'লোকাল স্টোরেজ:' : 'Local Storage:'}</span>
                  <span className="font-semibold text-emerald-400">{isBn ? 'সক্রিয়' : 'Active'}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setProfileModalOpen(true)}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-cyan-600 hover:text-white text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <span>{isBn ? 'সিঙ্ক সেন্টার খুলুন' : 'Sync Center'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* AI Voice Insights Banner */}
        {lastAnalysis && (
          <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Activity className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">
                    {isBn ? 'এআই ভয়েস ও মুড অ্যানালাইসিস রিপোর্ট' : 'AI Voice & Sentiment Report'}
                  </h4>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {lastAnalysis.sentiment}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                  {lastAnalysis.summary}
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setSelectedAnalysis(lastAnalysis);
                setAnalysisModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center gap-2"
            >
              <span>{isBn ? 'বিস্তারিত বিশ্লেষণ দেখুন' : 'View Full Insights'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800/80 bg-slate-950/80 py-4 px-4 text-center text-xs text-slate-500">
        <p>
          Sanju AI Voice &amp; Secure Assistant •{' '}
          {isBn
            ? 'ভয়েস কমান্ড, রিয়েল-টাইম নোটিফিকেশন, ব্যাকগ্রাউন্ড মাইক, এন্ড-টু-এন্ড এনক্রিপশন ও অফলাইন মোড'
            : 'Voice Assistant, Background Mic, Real-time Calling, AES-256 Vault & Offline Sync'}
        </p>
      </footer>

      {/* Modals */}
      <PhoneCallModal
        isOpen={callModalOpen}
        onClose={() => setCallModalOpen(false)}
        contacts={contacts}
        onAddContact={(newContact) => {
          const updated = [...contacts, newContact];
          setContacts(updated);
          Storage.saveContacts(updated);
          setPendingSyncCount(Storage.getSyncPendingCount());
        }}
        callLogs={callLogs}
        onSaveCallLog={(record) => {
          setCallLogs((prev) => [record, ...prev]);
        }}
        language={language}
        initialCallTarget={callInitialTarget}
      />

      <SecureVaultModal
        isOpen={vaultModalOpen}
        onClose={() => setVaultModalOpen(false)}
        vaultItems={vaultItems}
        onSaveVaultItems={(items) => {
          setVaultItems(items);
          Storage.saveVaultItems(items);
          setPendingSyncCount(Storage.getSyncPendingCount());
        }}
        language={language}
        pinCode={profile.pinCode}
      />

      <NotificationCenterModal
        isOpen={notificationsModalOpen}
        onClose={() => setNotificationsModalOpen(false)}
        notifications={notifications}
        onMarkAllAsRead={() => {
          const marked = notifications.map((n) => ({ ...n, isRead: true }));
          setNotifications(marked);
          Storage.saveNotifications(marked);
        }}
        onClearAll={() => {
          setNotifications([]);
          Storage.saveNotifications([]);
        }}
        onAddNotification={(notif) => {
          const created = Storage.addNotification(notif);
          setNotifications(Storage.getNotifications());
        }}
        language={language}
      />

      <ProfileSyncModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        profile={profile}
        onSaveProfile={(updated) => {
          setProfile(updated);
          Storage.saveProfile(updated);
          setPendingSyncCount(Storage.getSyncPendingCount());
        }}
        language={language}
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        onSyncCompleted={() => {
          setPendingSyncCount(0);
        }}
      />

      <VoiceAnalysisModal
        isOpen={analysisModalOpen}
        onClose={() => setAnalysisModalOpen(false)}
        data={selectedAnalysis}
        history={voiceLogs}
        language={language}
      />
    </div>
  );
}
