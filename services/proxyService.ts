/**
 * Auto-rotating proxy service for NDR Sports Browser
 *
 * Priority order:
 * 1. Cloudflare Worker (VITE_PROXY_URL) — best, deploy free in 2 min
 * 2. codetabs — free, works for most sites
 * 3. cors.sh — free backup
 * 4. corsfix — free backup
 *
 * The Cloudflare Worker is a TRUE reverse proxy — it fetches the full page
 * server-side and strips X-Frame-Options, so JavaScript works correctly.
 * Free tier: 100,000 requests/day, no credit card needed.
 *
 * Deploy: https://workers.cloudflare.com
 * See proxy-server/cloudflare-worker.js for the worker code.
 */

const CF_WORKER = import.meta.env.VITE_PROXY_URL || '';

// Proxy builders — each returns a URL that fetches the target through a proxy
const PROXY_POOL: Array<{ name: string; build: (t: string) => string }> = [
  // Cloudflare Worker (best — true reverse proxy, JS works)
  ...(CF_WORKER ? [{ name: 'Cloudflare', build: (t: string) => `${CF_WORKER}?url=${encodeURIComponent(t)}` }] : []),
  // Free public proxies (fetch HTML only — JS-heavy sites may show blank)
  { name: 'codetabs',    build: (t: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(t)}` },
  { name: 'cors.sh',     build: (t: string) => `https://cors.sh/?${encodeURIComponent(t)}` },
  { name: 'corsfix',     build: (t: string) => `https://corsfix.com/?${encodeURIComponent(t)}` },
];

let currentIndex = 0;
const failCounts = new Array(PROXY_POOL.length).fill(0);

export function getCurrentProxyName(): string {
  if (typeof (window as any).Capacitor !== 'undefined') return 'Direct (Mobile)';
  return PROXY_POOL[currentIndex % PROXY_POOL.length]?.name || '?';
}

export function markProxyFailed(): void {
  const idx = currentIndex % PROXY_POOL.length;
  failCounts[idx]++;
  if (failCounts[idx] >= 2) {
    currentIndex = (currentIndex + 1) % PROXY_POOL.length;
    console.warn(`Rotated to proxy: ${getCurrentProxyName()}`);
  }
}

export function markProxySuccess(): void {
  failCounts[currentIndex % PROXY_POOL.length] = 0;
}

export function getProxiedUrl(targetUrl: string): string {
  if (typeof (window as any).Capacitor !== 'undefined') return targetUrl;
  return PROXY_POOL[currentIndex % PROXY_POOL.length].build(targetUrl);
}

/**
 * Finds the best working proxy for a URL.
 * For Cloudflare Worker: returns the proxy URL directly (server handles everything).
 * For public proxies: fetches HTML, rewrites URLs, returns blob URL.
 */
export async function findWorkingProxy(targetUrl: string): Promise<string> {
  if (typeof (window as any).Capacitor !== 'undefined') return targetUrl;

  for (let attempt = 0; attempt < PROXY_POOL.length; attempt++) {
    const idx = (currentIndex + attempt) % PROXY_POOL.length;
    const proxy = PROXY_POOL[idx];
    const proxyUrl = proxy.build(targetUrl);

    try {
      console.log(`🔄 Trying ${proxy.name} for ${targetUrl}`);

      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();
      if (text.length < 500) throw new Error('Response too short');

      // Detect rate-limited proxy returning its own homepage
      if (text.length === 44019) throw new Error('Proxy rate-limited (returned own page)');

      // For Cloudflare Worker — it handles everything server-side
      // Just return the proxy URL directly for the iframe to load
      if (proxy.name === 'Cloudflare') {
        currentIndex = idx;
        failCounts[idx] = 0;
        console.log(`✅ Cloudflare Worker ready`);
        return proxyUrl;
      }

      // For public proxies — create blob URL with rewritten assets
      const rewritten = rewriteUrls(text, targetUrl);
      const injected = injectInterceptor(rewritten, targetUrl);
      const blob = new Blob([injected], { type: 'text/html; charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);

      currentIndex = idx;
      failCounts[idx] = 0;
      console.log(`✅ ${proxy.name} succeeded (${text.length} bytes)`);
      return blobUrl;

    } catch (err) {
      console.warn(`❌ ${proxy.name} failed:`, err);
      failCounts[idx]++;
    }
  }

  console.warn('All proxies failed, using direct URL');
  return targetUrl;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rewriteUrls(html: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const origin = base.origin;
  const basePath = base.href.substring(0, base.href.lastIndexOf('/') + 1);

  return html
    .replace(/(href|src|action)=["'](?!https?:\/\/|\/\/|#|data:|javascript:|blob:)([^"']*?)["']/gi,
      (match, attr, path) => {
        if (!path) return match;
        const abs = path.startsWith('/') ? `${origin}${path}` : `${basePath}${path}`;
        return `${attr}="${abs}"`;
      })
    .replace(/url\(['"]?(?!https?:\/\/|\/\/|data:|blob:)([^'")]+)['"]?\)/gi,
      (match, path) => {
        const abs = path.startsWith('/') ? `${origin}${path}` : `${basePath}${path}`;
        return `url("${abs}")`;
      });
}

function injectInterceptor(html: string, targetUrl: string): string {
  const origin = new URL(targetUrl).origin;
  const script = `<base href="${origin}/">
<script>
(function(){
  document.addEventListener('click',function(e){
    var el=e.target;
    while(el&&el.tagName!=='A')el=el.parentElement;
    if(el&&el.href&&el.href.startsWith('http')){
      e.preventDefault();e.stopPropagation();
      window.parent.postMessage({type:'NDR_NAVIGATE',url:el.href},'*');
    }
  },true);
  window.open=function(u){if(u)window.parent.postMessage({type:'NDR_NAVIGATE',url:u},'*');return null;};
})();
<\/script>`;
  return html.replace(/<head([^>]*)>/i, `<head$1>${script}`);
}
