import { Capacitor } from '@capacitor/core';

type PhoneControl = {
  searchYouTube?: (opts: { query: string }) => Promise<void>;
  openUrl?: (opts: { url: string }) => Promise<void>;
  openApp?: (opts: { packageName: string }) => Promise<void>;
};

function plugin(): PhoneControl | null {
  const plugins = (Capacitor as any).Plugins;
  return plugins?.PhoneControl || null;
}

export async function searchYouTube(query: string): Promise<boolean> {
  const clean = query.trim();
  if (!clean) return false;
  try {
    const p = plugin();
    if (p?.searchYouTube && Capacitor.isNativePlatform()) {
      await p.searchYouTube({ query: clean });
      return true;
    }
  } catch (e) {
    console.warn('Native YouTube search failed:', e);
  }
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(clean)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export async function openUrl(url: string): Promise<boolean> {
  try {
    const p = plugin();
    if (p?.openUrl && Capacitor.isNativePlatform()) {
      await p.openUrl({ url });
      return true;
    }
  } catch (e) {
    console.warn('Native URL open failed:', e);
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export async function openApp(packageName: string): Promise<boolean> {
  try {
    const p = plugin();
    if (p?.openApp && Capacitor.isNativePlatform()) {
      await p.openApp({ packageName });
      return true;
    }
  } catch (e) {
    console.warn('Native app launch failed:', e);
  }
  return false;
}
