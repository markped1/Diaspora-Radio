/**
 * SportsTv — Built-in Football Browser with Auto-Rotating Proxy
 *
 * Uses a pool of free CORS proxies that auto-rotate when one fails,
 * so sports sites load in the iframe without "refused to connect" errors.
 *
 * Proxy pool: cors.sh → codetabs → corsfix → corsproxy.io (auto-rotates on failure)
 * On mobile (Capacitor): uses direct URL — no proxy needed
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SportChannel } from '../types';
import { dbService } from '../services/dbService';
import {
  getProxiedUrl, markProxyFailed, markProxySuccess,
  getCurrentProxyName, findWorkingProxy,
} from '../services/proxyService';

// Detect if running inside Capacitor (Android/iOS app)
const isCapacitor = typeof (window as any).Capacitor !== 'undefined';

// Use Chrome Custom Tabs with injected floating Push Live button
async function openInAppBrowser(url: string, onPush?: (matchUrl: string) => void): Promise<void> {
  try {
    const { InAppBrowser } = await import('@capgo/inappbrowser');

    // Floating Push Live button injected into every page
    const floatingButton = `
      (function(){
        if(document.getElementById('ndr-push-btn')) return;
        var btn = document.createElement('div');
        btn.id = 'ndr-push-btn';
        btn.innerHTML = '🔴 PUSH LIVE';
        btn.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:999999;background:#e53e3e;color:#fff;font-weight:900;font-size:13px;padding:12px 18px;border-radius:50px;box-shadow:0 4px 20px rgba(0,0,0,0.5);cursor:pointer;letter-spacing:1px;border:2px solid #fff;';
        btn.onclick = function(){
          window.mobileApp.postMessage({ action: 'PUSH_LIVE', url: window.location.href });
          btn.innerHTML = '✅ PUSHED!';
          btn.style.background = '#38a169';
          setTimeout(function(){ btn.innerHTML = '🔴 PUSH LIVE'; btn.style.background = '#e53e3e'; }, 2000);
        };
        document.body.appendChild(btn);
      })();
    `;

    // Listen for push message from the injected button
    const msgListener = await InAppBrowser.addListener('messageFromWebview', (event: any) => {
      const data = event.detail || event;
      if (data?.action === 'PUSH_LIVE' && data?.url && onPush) {
        onPush(data.url);
      }
    });

    // Inject button on every page load
    const loadListener = await InAppBrowser.addListener('browserPageLoaded', async () => {
      try {
        await InAppBrowser.executeScript({ code: floatingButton });
      } catch {}
    });

    // Track URL changes
    const urlListener = await InAppBrowser.addListener('urlChangeEvent', async (event: any) => {
      setTimeout(async () => {
        try {
          await InAppBrowser.executeScript({ code: floatingButton });
        } catch {}
      }, 1500);
    });

    // Clean up on close
    const closeListener = await InAppBrowser.addListener('closeEvent', () => {
      msgListener.remove();
      loadListener.remove();
      urlListener.remove();
      closeListener.remove();
    });

    await InAppBrowser.openWebView({
      url,
      toolbarColor: '#008751',
      title: 'NDR Sports — Tap 🔴 PUSH LIVE to broadcast',
      showReloadButton: true,
      activeNativeNavigationForWebview: true,
      openBlankTargetInWebView: true,
      ignoreUntrustedSSLError: true,
      isPresentAfterPageLoad: true,
      enableZoom: true,
    });

  } catch (e) {
    console.error('openWebView failed:', e);
    window.open(url, '_blank');
  }
}

interface SportsTvProps {
  onPushLive: (channel: SportChannel) => void;
}

const BOOKMARKS = [
  // ── Yalla variants ────────────────────────────────────────────────────────
  { name: 'Yalla Live',     url: 'https://www.live-yalla.io',              logo: '⚽' },
  { name: 'Yalla Shoot',    url: 'https://shoot-yalla.to',                 logo: '🎯' },
  { name: 'Yalla Shoot 2',  url: 'https://eshoot.org',                     logo: '🥅' },
  // ── Most reliable free football sites (2025/26) ───────────────────────────
  { name: 'DaddyHD',        url: 'https://daddyhd.com',                    logo: '📺' },
  { name: 'Streami',        url: 'https://streami.su/category/football',   logo: '🔴' },
  { name: 'StreamEast',     url: 'https://v2.streameast.sk',               logo: '🌊' },
  { name: 'Ronaldo7',       url: 'https://ronaldo7.soccer/soccer',         logo: '⭐' },
  { name: 'Sportsurge',     url: 'https://sportsurge.ws',                  logo: '⚡' },
  { name: 'VIP League',     url: 'https://vipleague.im/football',          logo: '👑' },
  { name: 'Total Sportek',  url: 'https://www.total-sportek.to',           logo: '📡' },
  { name: 'Sporticos',      url: 'https://sporticos.com/en-gb',            logo: '🏆' },
  { name: 'Hesgoal',        url: 'https://hesgoals.mov/schedule',          logo: '🥅' },
];

const SportsTv: React.FC<SportsTvProps> = ({ onPushLive }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const retryCountRef = useRef(0);
  const blobUrlRef = useRef<string>(''); // track blob URLs to revoke them

  const [targetUrl, setTargetUrl] = useState('https://www.live-yalla.io');
  const [iframeSrc, setIframeSrc] = useState('');
  const [addressBar, setAddressBar] = useState('https://www.live-yalla.io');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [proxyName, setProxyName] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [loadStatus, setLoadStatus] = useState('');
  const [history, setHistory] = useState<string[]>(['https://www.live-yalla.io']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [savedMatches, setSavedMatches] = useState<SportChannel[]>([]);
  const [saveLabel, setSaveLabel] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [liveUrl, setLiveUrl] = useState(''); // tracks URL as admin browses

  useEffect(() => {
    dbService.getSportChannels().then(setSavedMatches);
  }, []);

  // Load a URL — native browser on Android, proxy iframe on PC
  const loadUrl = useCallback(async (url: string) => {
    if (isCapacitor) {
      // On Android: open in native in-app WebView — stays inside app, streams play
      setIsLoading(false);
      setLoadError(false);
      setIframeSrc('');
      await openInAppBrowser(url);
      return;
    }

    // On PC: use proxy iframe
    setIsLoading(true);
    setLoadError(false);
    setRetrying(false);
    setLoadStatus('Finding best proxy...');
    retryCountRef.current = 0;

    if (blobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrlRef.current);
    }

    setLoadStatus('Fetching through proxy...');
    // Use Cloudflare page proxy (?page=) which strips X-Frame-Options
    const cfProxy = (import.meta as any).env?.VITE_PROXY_URL || '';
    let proxied: string;
    if (cfProxy) {
      proxied = `${cfProxy}?page=${encodeURIComponent(url)}`;
      setProxyName('Cloudflare');
    } else {
      const result = await findWorkingProxy(url);
      proxied = result;
    }
    blobUrlRef.current = proxied;
    setIframeSrc(proxied);
    setProxyName(getCurrentProxyName());
    setLoadStatus('');
  }, []);

  // Navigate to a new URL
  const navigate = useCallback((url: string) => {
    let finalUrl = url.trim();
    if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
    setTargetUrl(finalUrl);
    setAddressBar(finalUrl);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(finalUrl);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    loadUrl(finalUrl);
  }, [history, historyIndex, loadUrl]);

  // Listen for navigation messages posted from inside the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'NDR_NAVIGATE' && e.data?.url) {
        console.log('📡 Intercepted link:', e.data.url);
        navigate(e.data.url);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [navigate]);

  // Initial load
  useEffect(() => {
    loadUrl('https://www.live-yalla.io');
  }, []);

  const goBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setTargetUrl(prev);
      setAddressBar(prev);
      loadUrl(prev);
    }
  };

  const refresh = () => loadUrl(targetUrl);

  // Intercept clicks inside iframe — load links through proxy instead of new tab
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    setLoadError(false);
    markProxySuccess();
    setProxyName(getCurrentProxyName());

    // Try to intercept link clicks inside the iframe
    try {
      const iframeDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
      if (iframeDoc) {
        iframeDoc.addEventListener('click', (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          const anchor = target.closest('a') as HTMLAnchorElement | null;
          if (anchor && anchor.href && anchor.href.startsWith('http')) {
            e.preventDefault();
            e.stopPropagation();
            navigate(anchor.href);
          }
        }, true);
      }
    } catch {
      // Cross-origin iframe — can't access DOM, that's fine
    }
  }, []);

  // Handle iframe error — rotate proxy and retry
  const handleError = useCallback(async () => {
    retryCountRef.current++;
    if (retryCountRef.current <= 4) {
      setRetrying(true);
      markProxyFailed();
      const proxied = getProxiedUrl(targetUrl);
      setIframeSrc('');
      setTimeout(() => {
        setIframeSrc(proxied);
        setProxyName(getCurrentProxyName());
        setRetrying(false);
      }, 800);
    } else {
      setIsLoading(false);
      setLoadError(true);
    }
  }, [targetUrl]);

  const flash = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(''), 2500); };

  const handlePushLive = async () => {
    const ch: SportChannel = {
      id: 'live-' + Math.random().toString(36).substr(2, 9),
      name: saveLabel.trim() || 'Live Football',
      url: targetUrl,
      logo: '⚽', category: 'Football',
      matchInfo: targetUrl, isLive: true,
      timestamp: Date.now(),
    };
    await dbService.saveSportChannel(ch);
    setSavedMatches(await dbService.getSportChannels());
    onPushLive(ch);
    flash('🔴 Pushed live to listener screen!');
  };

  const handleSaveMatch = async () => {
    if (!saveLabel.trim()) { flash('Enter a match name first'); return; }
    const ch: SportChannel = {
      id: 'match-' + Math.random().toString(36).substr(2, 9),
      name: saveLabel.trim(), url: targetUrl,
      logo: '⚽', category: 'Football',
      matchInfo: targetUrl, timestamp: Date.now(),
    };
    await dbService.saveSportChannel(ch);
    setSavedMatches(await dbService.getSportChannels());
    setSaveLabel(''); setShowSaveForm(false);
    flash(`✅ "${ch.name}" saved`);
  };

  const handleDeleteMatch = async (id: string) => {
    await dbService.deleteSportChannel(id);
    setSavedMatches(prev => prev.filter(c => c.id !== id));
    flash('🗑 Deleted');
  };

  const handlePushSaved = async (ch: SportChannel) => {
    const updated = { ...ch, isLive: true };
    await dbService.saveSportChannel(updated);
    setSavedMatches(prev => prev.map(c => ({ ...c, isLive: c.id === ch.id })));
    onPushLive(updated);
    flash(`🔴 ${ch.name} pushed live!`);
  };

  return (
    <div className="space-y-3">

      {/* ── BROWSER ── */}
      <div className="bg-gray-950 rounded-xl overflow-hidden border border-gray-800 shadow-2xl">

        {/* Title bar */}
        <div className="bg-gray-900 px-3 py-1.5 flex items-center justify-between border-b border-gray-800">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-green-400"></span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-[6px] font-black text-gray-500 uppercase">via {proxyName || '...'}</span>
            <span className="text-[7px] font-black text-gray-400 uppercase tracking-widest">⚽ Football Browser</span>
          </div>
          <button onClick={handlePushLive}
            className="bg-red-600 text-white px-3 py-1 rounded-lg text-[6px] font-black uppercase flex items-center space-x-1 hover:bg-red-500 active:scale-95">
            <i className="fas fa-broadcast-tower text-[7px]"></i>
            <span>Push Live</span>
          </button>
        </div>

        {/* Nav bar */}
        <div className="bg-gray-800 px-2 py-1.5 flex items-center space-x-1.5 border-b border-gray-700">
          <button onClick={goBack} disabled={historyIndex === 0}
            className="w-7 h-7 rounded-lg bg-gray-700 text-gray-300 flex items-center justify-center disabled:opacity-30 hover:bg-gray-600">
            <i className="fas fa-arrow-left text-[9px]"></i>
          </button>
          <button onClick={refresh}
            className="w-7 h-7 rounded-lg bg-gray-700 text-gray-300 flex items-center justify-center hover:bg-gray-600">
            <i className={`fas fa-sync-alt text-[9px] ${isLoading || retrying ? 'animate-spin text-green-400' : ''}`}></i>
          </button>
          <form onSubmit={e => { e.preventDefault(); navigate(addressBar); }} className="flex-1 flex">
            <input value={addressBar} onChange={e => setAddressBar(e.target.value)}
              className="flex-1 bg-gray-700 text-white text-[8px] px-3 py-1.5 rounded-lg outline-none focus:bg-gray-600 font-mono"
              placeholder="Enter URL..." />
          </form>
          <button onClick={() => navigate(addressBar)}
            className="w-7 h-7 rounded-lg bg-green-600 text-white flex items-center justify-center hover:bg-green-500">
            <i className="fas fa-arrow-right text-[9px]"></i>
          </button>
        </div>

        {/* Bookmarks */}
        <div className="px-2 py-1 flex space-x-1 overflow-x-auto no-scrollbar border-b border-gray-700"
          style={{ backgroundColor: '#1a1a2e' }}>
          {BOOKMARKS.map(b => (
            <button key={b.url} onClick={() => navigate(b.url)}
              className={`shrink-0 flex items-center space-x-1 px-2 py-1 rounded-lg text-[6px] font-black uppercase transition-all ${
                targetUrl.includes(b.url.replace('https://', '').split('/')[0])
                  ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}>
              <span>{b.logo}</span><span>{b.name}</span>
            </button>
          ))}
        </div>

        {/* Viewport — Android: native browser button | PC: proxy iframe */}
        <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>

          {isCapacitor ? (
            /* ── ANDROID: open WebView with floating Push Live button ── */
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 space-y-3 p-4">
              <span className="text-4xl">⚽</span>
              <p className="text-[9px] font-black text-white uppercase text-center">NDR Sports Browser</p>
              <p className="text-[7px] text-gray-400 text-center leading-relaxed">
                Browse to any match. A red <span className="text-red-400 font-bold">🔴 PUSH LIVE</span> button floats on every page. Tap it to instantly broadcast the match to all listeners.
              </p>
              <button
                onClick={() => {
                  openInAppBrowser(targetUrl, async (matchUrl: string) => {
                    // Admin tapped Push Live inside the browser
                    const ch: SportChannel = {
                      id: 'live-' + Math.random().toString(36).substr(2, 9),
                      name: 'Live Match',
                      url: matchUrl,
                      logo: '⚽', category: 'Football',
                      matchInfo: matchUrl, isLive: true,
                      timestamp: Date.now(),
                    };
                    await dbService.saveSportChannel(ch);
                    setSavedMatches(await dbService.getSportChannels());
                    onPushLive(ch);
                    flash('🔴 Match pushed live to listeners!');
                  });
                }}
                className="w-full bg-green-600 text-white px-4 py-3 rounded-xl text-[10px] font-black uppercase flex items-center justify-center space-x-2 shadow-lg active:scale-95">
                <i className="fas fa-globe text-sm"></i>
                <span>Open Sports Browser</span>
              </button>
              {feedback && <p className="text-[8px] font-black text-green-400 animate-pulse">{feedback}</p>}
            </div>
          ) : (
            /* ── PC: proxy iframe ── */
            <>
              {/* Loading overlay */}
              {(isLoading || retrying) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 space-y-2">
                  <i className="fas fa-circle-notch fa-spin text-green-400 text-xl"></i>
                  <span className="text-[7px] text-gray-300 font-black uppercase">
                    {loadStatus || (retrying ? `Trying proxy ${getCurrentProxyName()}...` : 'Loading...')}
                  </span>
                  <span className="text-[6px] text-gray-500">via {proxyName || '...'}</span>
                </div>
              )}

              {/* Error state */}
              {loadError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 space-y-3 p-4 z-10">
                  <i className="fas fa-exclamation-triangle text-yellow-400 text-2xl"></i>
                  <p className="text-[8px] font-black text-white uppercase text-center">Proxy failed for this site</p>
                  <p className="text-[6px] text-gray-400 text-center leading-relaxed">
                    Install the Android APK for full stream support. On PC, open in a new tab.
                  </p>
                  <div className="flex space-x-2">
                    <button onClick={refresh} className="bg-green-600 text-white px-3 py-2 rounded-lg text-[7px] font-black uppercase">Retry</button>
                    <button onClick={() => window.open(targetUrl, '_blank')} className="bg-yellow-500 text-black px-3 py-2 rounded-lg text-[7px] font-black uppercase">Open in Tab</button>
                  </div>
                </div>
              )}

              {/* iframe */}
              {iframeSrc && !loadError && (
                <iframe
                  ref={iframeRef}
                  key={iframeSrc}
                  src={iframeSrc}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="no-referrer"
                  title="Football Browser"
                  onLoad={handleIframeLoad}
                  onError={handleError}
                />
              )}
            </>
          )}
        </div>

        {/* Bottom bar */}
        <div className="bg-gray-900 px-3 py-2 border-t border-gray-800 space-y-1.5">
          {feedback && <p className="text-[7px] font-black text-green-400 text-center animate-pulse">{feedback}</p>}
          <div className="flex space-x-2">
            <button onClick={() => setShowSaveForm(!showSaveForm)}
              className="flex-1 bg-gray-700 text-white py-1.5 rounded-lg text-[7px] font-black uppercase flex items-center justify-center space-x-1 hover:bg-gray-600">
              <i className="fas fa-bookmark text-[8px]"></i><span>Save Match</span>
            </button>
            <button onClick={handlePushLive}
              className="flex-1 bg-red-600 text-white py-1.5 rounded-lg text-[7px] font-black uppercase flex items-center justify-center space-x-1 hover:bg-red-500">
              <i className="fas fa-broadcast-tower text-[8px]"></i><span>Push Live Now</span>
            </button>
          </div>
          {showSaveForm && (
            <div className="flex space-x-2">
              <input value={saveLabel} onChange={e => setSaveLabel(e.target.value)}
                placeholder="Match name (e.g. Man Utd vs Arsenal)"
                className="flex-1 bg-gray-700 text-white text-[8px] px-3 py-1.5 rounded-lg outline-none focus:bg-gray-600"
                onKeyDown={e => e.key === 'Enter' && handleSaveMatch()} />
              <button onClick={handleSaveMatch}
                className="px-3 bg-green-600 text-white rounded-lg text-[7px] font-black uppercase">Save</button>
            </div>
          )}
        </div>
      </div>

      {/* ── SAVED MATCHES ── */}
      {savedMatches.length > 0 && (
        <div className="space-y-1">
          <p className="text-[7px] font-black uppercase text-gray-500 tracking-widest px-1">Saved Matches</p>
          {savedMatches.map(ch => (
            <div key={ch.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${ch.isLive ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-100'}`}>
              <div className="flex items-center p-2.5 space-x-2">
                <span className="text-xl shrink-0">{ch.logo}</span>
                <div className="flex-1 truncate">
                  <div className="flex items-center space-x-1.5">
                    <p className="text-[8px] font-black text-gray-800 truncate">{ch.name}</p>
                    {ch.isLive && (
                      <span className="shrink-0 flex items-center space-x-0.5 bg-red-500 px-1.5 py-0.5 rounded-full">
                        <span className="w-1 h-1 bg-white rounded-full animate-pulse"></span>
                        <span className="text-[5px] font-black text-white">LIVE</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[6px] text-blue-400 truncate">{ch.url}</p>
                </div>
              </div>
              <div className="flex border-t border-gray-50">
                <button onClick={() => navigate(ch.url)}
                  className="flex-1 py-1.5 bg-green-50 text-green-700 text-[6px] font-black uppercase flex items-center justify-center space-x-1 border-r border-gray-50">
                  <i className="fas fa-play text-[6px]"></i><span>Load</span>
                </button>
                <button onClick={() => handlePushSaved(ch)}
                  className="flex-1 py-1.5 bg-red-50 text-red-600 text-[6px] font-black uppercase flex items-center justify-center space-x-1 border-r border-gray-50">
                  <i className="fas fa-broadcast-tower text-[6px]"></i><span>Push Live</span>
                </button>
                <button onClick={() => handleDeleteMatch(ch.id)}
                  className="px-4 py-1.5 bg-gray-50 text-gray-400 text-[6px] font-black uppercase">
                  <i className="fas fa-trash text-[6px]"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}` }} />
    </div>
  );
};

export default SportsTv;
