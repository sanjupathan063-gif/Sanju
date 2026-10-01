import { VoiceAnalysisData, Language } from '../types';
import { playListenChime, playSuccessChime } from './audioFeedback';

// Web Speech API Types
type SpeechRecognitionType = any;

class VoiceAssistantService {
  private recognition: SpeechRecognitionType | null = null;
  private isListening = false;
  private continuousMode = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private onResultCallback: ((transcript: string, isFinal: boolean) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onStateChangeCallback: ((listening: boolean) => void) | null = null;
  private preferredLanguage: Language = 'bn';

  constructor() {
    this.initSpeechRecognition();
  }

  private initSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition is not supported on this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.preferredLanguage === 'bn' ? 'bn-BD' : 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStateChangeCallback?.(true);
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const activeText = finalTranscript || interimTranscript;
      if (activeText.trim()) {
        this.onResultCallback?.(activeText.trim(), Boolean(finalTranscript));
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return;
      console.warn('Speech recognition error:', event.error);
      this.onErrorCallback?.(event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onStateChangeCallback?.(false);
      // Restart if continuous background mode is enabled
      if (this.continuousMode) {
        setTimeout(() => {
          if (this.continuousMode && !this.isListening) {
            try {
              this.recognition?.start();
            } catch {
              // ignore duplicate start attempts
            }
          }
        }, 300);
      }
    };
  }

  public setLanguage(lang: Language) {
    this.preferredLanguage = lang;
    if (this.recognition) {
      this.recognition.lang = lang === 'bn' ? 'bn-BD' : 'en-US';
    }
  }

  public async startListening(continuous = false): Promise<boolean> {
    this.continuousMode = continuous;

    try {
      // 1. Initialize audio visualizer analyzer stream
      await this.initAudioStream();

      // 2. Play acoustic chime for voice trigger
      playListenChime();

      // 3. Start speech recognition engine
      if (!this.recognition) {
        this.initSpeechRecognition();
      }

      if (this.recognition && !this.isListening) {
        try {
          this.recognition.start();
        } catch {
          // already started
        }
      }

      return true;
    } catch (err: any) {
      console.error('Failed to start listening:', err);
      this.onErrorCallback?.(err.message || 'মাইক্রোফোনের অনুমতি পাওয়া যায়নি');
      return false;
    }
  }

  public stopListening() {
    this.continuousMode = false;
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.isListening = false;
    this.onStateChangeCallback?.(false);
  }

  public async initAudioStream(): Promise<void> {
    if (this.mediaStream && this.analyser) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.mediaStream = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;

      source.connect(this.analyser);
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
    } catch (err) {
      console.warn('Microphone stream access error:', err);
    }
  }

  public getAudioFrequencyData(): Uint8Array | null {
    if (!this.analyser || !this.dataArray) return null;
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  public getAudioVolume(): number {
    const data = this.getAudioFrequencyData();
    if (!data) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return Math.min(100, Math.round(sum / data.length));
  }

  public onResult(callback: (transcript: string, isFinal: boolean) => void) {
    this.onResultCallback = callback;
  }

  public onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }

  public onStateChange(callback: (listening: boolean) => void) {
    this.onStateChangeCallback = callback;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  /**
   * Immediate Text-to-Speech response (বাংলা এবং English)
   */
  private selectedVoiceURI: string | null = localStorage.getItem('sanju_female_voice_uri_v1');
  private voiceList(): SpeechSynthesisVoice[] {
    return ('speechSynthesis' in window) ? window.speechSynthesis.getVoices() : [];
  }

  /** Select and persist a feminine-sounding installed voice when available. */
  public getFemaleVoiceName(lang: Language = 'bn'): string {
    const voices = this.voiceList();
    const saved = this.selectedVoiceURI && voices.find(v => v.voiceURI === this.selectedVoiceURI);
    if (saved) return saved.name;
    const langPrefix = lang === 'bn' ? 'bn' : 'en';
    const matching = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));
    const femaleHints = /female|woman|zira|samantha|aria|jenny|sara|susan|google.*(বাংলা|bangla|bengali)|heera|priya|aditi|neerja/i;
    const chosen = matching.find(v => femaleHints.test(v.name)) || matching.find(v => !/male|david|mark|daniel/i.test(v.name)) || matching[0];
    if (chosen) {
      this.selectedVoiceURI = chosen.voiceURI;
      try { localStorage.setItem('sanju_female_voice_uri_v1', chosen.voiceURI); } catch {}
      return chosen.name;
    }
    return lang === 'bn' ? 'System Bengali voice (female if installed)' : 'System English voice (female if installed)';
  }

  public speak(text: string, lang: Language = 'bn'): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || !text.trim()) { resolve(); return; }
      const synth = window.speechSynthesis;
      synth.cancel();
      const speakNow = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = this.voiceList();
        const saved = this.selectedVoiceURI && voices.find(v => v.voiceURI === this.selectedVoiceURI);
        const langPrefix = lang === 'bn' ? 'bn' : 'en';
        const matching = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));
        const femaleHints = /female|woman|zira|samantha|aria|jenny|sara|susan|heera|priya|aditi|neerja/i;
        const chosen = saved || matching.find(v => femaleHints.test(v.name)) || matching.find(v => !/male|david|mark|daniel/i.test(v.name)) || matching[0];
        if (chosen) {
          utterance.voice = chosen;
          utterance.lang = chosen.lang;
          this.selectedVoiceURI = chosen.voiceURI;
          try { localStorage.setItem('sanju_female_voice_uri_v1', chosen.voiceURI); } catch {}
        } else {
          utterance.lang = lang === 'bn' ? 'bn-BD' : 'en-US';
        }
        utterance.rate = 0.96;
        utterance.pitch = 1.12;
        utterance.volume = 1;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        synth.speak(utterance);
      };
      if (synth.getVoices().length) speakNow();
      else {
        const onVoices = () => { synth.removeEventListener?.('voiceschanged', onVoices); speakNow(); };
        synth.addEventListener?.('voiceschanged', onVoices);
        setTimeout(() => { synth.removeEventListener?.('voiceschanged', onVoices); speakNow(); }, 900);
      }
    });
  }

  /**
   * Analyze voice input with AI (Gemini backend) or Offline Heuristic Engine
   */
  public async processVoiceCommand(
    transcript: string,
    isOnline: boolean,
    lang: Language = 'bn'
  ): Promise<VoiceAnalysisData> {
    // Deterministic local routing runs FIRST for high-confidence device commands.
    // This prevents an AI/backend response from misclassifying content ("cartoon video")
    // as an application name.
    const local = this.parseLocally(transcript, lang);
    if (local.confidenceScore >= 0.90 && local.intent !== 'QUERY') return local;

    if (isOnline) {
      try {
        const response = await fetch('/api/voice/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, language: lang, context: { timestamp: new Date().toISOString() } }),
        });
        if (response.ok) {
          const result = await response.json();
          // Never let backend AI overwrite a strong local device/content classification.
          const backendIntent = result.intent || 'QUERY';
          const safeIntent = (local.intent !== 'QUERY' && local.confidenceScore >= 0.82)
            ? local.intent : backendIntent;
          return {
            transcript,
            detectedLanguage: result.detectedLanguage || lang,
            intent: safeIntent,
            speechResponse: safeIntent === 'YOUTUBE_SEARCH'
              ? (lang === 'bn' ? `ইউটিউবে "${local.detectedEntities[0] || transcript}" খুঁজছি।` : `Searching YouTube for "${local.detectedEntities[0] || transcript}".`)
              : (result.speechResponse || `অনুরোধ গৃহীত হয়েছে: ${transcript}`),
            sentiment: result.voiceAnalysis?.sentiment || local.sentiment,
            urgencyScore: result.voiceAnalysis?.urgencyScore || local.urgencyScore,
            confidenceScore: Math.max(local.confidenceScore, result.voiceAnalysis?.confidenceScore || 0),
            detectedEntities: local.detectedEntities.length ? local.detectedEntities : (result.voiceAnalysis?.detectedEntities || []),
            summary: result.voiceAnalysis?.summary || local.summary,
            timestamp: new Date().toISOString(),
          };
        }
      } catch (err) {
        console.warn('Backend AI analysis unavailable; using local parser:', err);
      }
    }
    return local;
  }

  /**
   * Deterministic Bengali/Banglish/English command router.
   * App names and content queries are deliberately separated.
   */
  public parseLocally(transcript: string, lang: Language): VoiceAnalysisData {
    const text = transcript.trim();
    const lower = text.toLowerCase();
    let intent: VoiceAnalysisData['intent'] = 'QUERY';
    let speechResponse = '';
    let sentiment: VoiceAnalysisData['sentiment'] = 'calm';
    let urgencyScore = 3;
    let confidenceScore = 0.55;
    const detectedEntities: string[] = [];

    const normalize = (v: string) => v
      .replace(/[“”"']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (/(জরুরি|জরুরী|বিপদ|urgent|emergency|help)/i.test(lower)) {
      urgencyScore = 9; sentiment = 'urgent';
    } else if (/(তাড়াতাড়ি|তাড়াতাড়ি|quick|fast|hurry)/i.test(lower)) {
      urgencyScore = 7; sentiment = 'excited';
    }

    // 1) YouTube CONTENT intent must be checked before generic app intent.
    const yt = lower.match(/(?:youtube|youtub|ইউটিউব|ইউটুব|ইউটিউব্)\s*(?:থেকে|তে|এ|তে)?\s*(?:একটা|একটি|এক|the)?\s*(?:ভিডিও|video)?\s*(?:চালাও|চালু করো|দেখাও|দেখতে চাই|খুঁজে দাও|খোঁজো|search|play|watch)?\s*(.*)$/i);
    const genericVideo = lower.match(/(?:একটা|একটি|এক)\s*(?:কার্টুন|কারটুন|cartoon)\s*(?:ভিডিও|video)?\s*(?:চালাও|দেখাও|দেখতে চাই|খুঁজে দাও|play|watch)?/i);
    const youtubeMention = /(youtube|youtub|ইউটিউব|ইউটুব)/i.test(lower);
    const contentWords = /(ভিডিও|video|কার্টুন|কারটুন|cartoon|গান|song|মুভি|movie|নাটক|series|শিক্ষামূলক|tutorial|টিউটোরিয়াল)/i.test(lower);

    if (youtubeMention && contentWords) {
      let query = '';
      if (yt?.[1]) query = normalize(yt[1]);
      query = query.replace(/^(থেকে|তে|এ)\s*/i, '').trim();
      if (!query || /^(চালাও|চালু করো|দেখাও|play|watch)$/i.test(query)) {
        const cartoon = /(কার্টুন|কারটুন|cartoon)/i.test(lower);
        query = cartoon ? 'cartoon' : 'video';
      }
      intent = 'YOUTUBE_SEARCH';
      detectedEntities.push(query);
      speechResponse = lang === 'bn' ? `ইউটিউবে "${query}" খুঁজছি।` : `Searching YouTube for "${query}".`;
      confidenceScore = 0.98;
    }
    // Natural Bangla: "একটা কার্টুন ভিডিও চালাও" -> YouTube content, not an app.
    else if (genericVideo) {
      intent = 'YOUTUBE_SEARCH';
      const query = /কার্টুন|কারটুন|cartoon/i.test(lower) ? 'cartoon' : 'video';
      detectedEntities.push(query);
      speechResponse = lang === 'bn' ? `ইউটিউবে "${query}" ভিডিও খুঁজছি।` : `Searching YouTube for "${query}".`;
      confidenceScore = 0.95;
    }
    // 2) Explicit app launch only when the command contains an app-launch verb.
    else if (/(খোলো|খুলে দাও|চালু করো|ওপেন|open|launch|start)\b/i.test(lower)) {
      const appMap: Array<[RegExp,string,string]> = [
        [/(youtube|youtub|ইউটিউব|ইউটুব)/i,'YouTube','com.google.android.youtube'],
        [/(whatsapp|হোয়াটসঅ্যাপ|হোয়াটসঅ্যাপ)/i,'WhatsApp','com.whatsapp'],
        [/(chrome|ক্রোম|browser|ব্রাউজার)/i,'Chrome','com.android.chrome'],
        [/(gmail|জিমেইল)/i,'Gmail','com.google.android.gm'],
        [/(maps|ম্যাপস|গুগল ম্যাপ)/i,'Google Maps','com.google.android.apps.maps'],
        [/(camera|ক্যামেরা)/i,'Camera','camera'],
        [/(settings|সেটিংস)/i,'Android Settings','settings'],
      ];
      const app = appMap.find(([re]) => re.test(lower));
      if (app) {
        intent = 'OPEN_APP';
        detectedEntities.push(app[1], app[2]);
        speechResponse = lang === 'bn' ? `${app[1]} খোলার জন্য প্রস্তুত।` : `Ready to open ${app[1]}.`;
        confidenceScore = 0.98;
      }
    }
    // Call intent
    else if (/(call|কল|ফোন|phone|dial)/i.test(lower)) {
      intent = 'CALL';
      let target = 'মা (Mom)';
      if (/(বাবা|father|dad)/i.test(lower)) target = 'বাবা (Father)';
      else if (/(emergency|জরুরি|জরুরী|৯৯৯|999)/i.test(lower)) target = 'Emergency (জরুরী সেবা)';
      else if (/(রহিম|rahim)/i.test(lower)) target = 'রহিম (Rahim)';
      else if (/(অফিস|office)/i.test(lower)) target = 'অফিস টিম (Office)';
      else if (/(ডাক্তার|doctor|সুমনা)/i.test(lower)) target = 'ডাঃ সুমনা (Dr. Sumona)';
      else {
        const m = text.match(/(?:call|কল|ফোন)\s+(?:করো|দাও)?\s*(.+)$/i);
        if (m?.[1]) target = normalize(m[1]);
      }
      detectedEntities.push(target);
      speechResponse = lang === 'bn' ? `${target} কে কল করার প্রস্তুতি নিচ্ছি।` : `Preparing to call ${target}.`;
      confidenceScore = 0.93;
    }
    else if (/(নোট|note|লিখে রাখ|save|সংরক্ষণ)/i.test(lower)) {
      intent = 'CREATE_NOTE';
      detectedEntities.push(text);
      speechResponse = lang === 'bn' ? 'নোটটি সংরক্ষণ করার জন্য প্রস্তুত।' : 'The note is ready to be saved.';
      confidenceScore = 0.94;
    }
    else if (/(মনে করিয়ে|মনে করিয়ে|remind|রিমাইন্ডার|নোটিফিকেশন|alert|সতর্ক)/i.test(lower)) {
      intent = 'CREATE_REMINDER';
      detectedEntities.push(text);
      speechResponse = lang === 'bn' ? 'রিমাইন্ডার সংরক্ষণ করার জন্য প্রস্তুত।' : 'The reminder is ready to be saved.';
      confidenceScore = 0.94;
    }
    else if (/(vault|ভল্ট|পাসওয়ার্ড|পাসওয়ার্ড|লক|সিক্রেট)/i.test(lower)) {
      intent = 'ENCRYPT_VAULT';
      speechResponse = lang === 'bn' ? 'সিকিউর ভল্ট খোলার জন্য প্রস্তুত।' : 'The secure vault is ready.';
      confidenceScore = 0.93;
    }
    else {
      intent = 'QUERY';
      if (/(কেমন আছো|how are you)/i.test(lower)) {
        speechResponse = lang === 'bn' ? 'আমি প্রস্তুত আছি। কী কাজ করতে হবে বলুন।' : 'I am ready. Tell me what you want to do.';
      } else if (/(তুমি কে|who are you)/i.test(lower)) {
        speechResponse = lang === 'bn' ? 'আমি SANJU, আপনার ফোনের AI assistant।' : 'I am SANJU, your phone AI assistant.';
      } else {
        speechResponse = lang === 'bn' ? `আমি কমান্ডটি বুঝতে পারিনি: "${text}"।` : `I could not identify an action for: "${text}".`;
      }
      confidenceScore = 0.60;
    }

    playSuccessChime();
    return {
      transcript: text,
      detectedLanguage: lang,
      intent,
      speechResponse,
      sentiment,
      urgencyScore,
      confidenceScore,
      detectedEntities,
      summary: `Local command routing: ${text.slice(0, 80)}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export const voiceAssistant = new VoiceAssistantService();
