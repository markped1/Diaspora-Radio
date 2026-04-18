/**
 * Auto-rotating CORS proxy service
 *
 * Fetches pages through free CORS proxies, rewrites relative URLs to absolute,
 * then loads the result as a blob URL in the iframe so assets load correctly.
 */

const PROXY_POOL = [
  (t: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(t)}`,
  (t: string) => `https://cors.sh/?${encodeURIComponent(t)}`,
  (t: string) => `https://corsfix.com/?${encodeURIComponent(t)}`,
  (t: string) => `https://corsproxy.io/?${encodeURIComponent(t)}`,
];

const PROXY_NAMES = ['codetabs', 'cors.sh', 'corsfix', 'corsproxy.io'];

let currentIndex = 0;
let failCounts = [0, 0, 0, 0];

export function getCurrentProxyName(): string {
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
  if (isCapacitor) return 'Direct';
  return PROXY_NAMES[currentIndex % PROXY_POOL.length];
}

export function markProxyFailed(): void {
  failCounts[currentIndex]++;
  if (failCounts[currentIndex] >= 2) {
    currentIndex = (currentIndex + 1) % PROXY_POOL.length;
    console.warn(`Rotated to proxy: ${getCurrentProxyName()}`);
  }
}

export function markProxySuccess(): void {
  failCounts[currentIndex] = 0;
}

export function getProxiedUrl(targetUrl: string): string {
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
  if (isCapacitor) return targetUrl;
  return PROXY_POOL[currentIndex % PROXY_POOL.length](targetUrl);
}

/**
 * Rewrites relative URLs in HTML to absolute so assets load through the proxy.
 */
function rewriteUrls(html: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const origin = base.origin;
  const basePath = base.href.substring(0, base.href.lastIndexOf('/') + 1);

  return html
    // Fix href and src attributes
    .replace(/(href|src|action)=["'](?!https?:\/\/|\/\/|#|data:|javascript:)([^"']*?)["']/gi,
      (match, attr, path) => {
        if (!path) return match;
        const abs = path.startsWith('/') ? `${origin}${path}` : `${basePath}${path}`;
        return `${attr}="${abs}"`;
      })
    // Fix CSS url() references
    .replace(/url\(['"]?(?!https?:\/\/|\/\/|data:)([^'")]+)['"]?\)/gi,
      (match, path) => {
        const abs = path.startsWith('/') ? `${origin}${path}` : `${basePath}${path}`;
        return `url("${abs}")`;
      })
    // Add base tag to help browser resolve remaining relative URLs
    .replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`);
}

/**
 * Fetches a URL through the proxy pool, rewrites URLs, returns a blob URL.
 * Auto-rotates proxies on failure.
 */
export async function findWorkingProxy(targetUrl: string): Promise<string> {
  const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
  if (isCapacitor) return targetUrl;

  for (let attempt = 0; attempt < PROXY_POOL.length; attempt++) {
    const idx = (currentIndex + attempt) % PROXY_POOL.length;
    const proxyUrl = PROXY_POOL[idx](targetUrl);

    try {
      console.log(`🔄 Trying proxy ${PROXY_NAMES[idx]} for ${targetUrl}`);
      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();

      if (text.length < 500) throw new Error('Response too short — likely blocked');

      // Detect if proxy returned its own homepage instead of the target
      // (cors.sh does this when rate-limited — returns 44019 bytes of its own page)
      if (text.includes('cors.sh') && text.includes('CORS Proxy') && !targetUrl.includes('cors.sh')) {
        throw new Error('Proxy returned its own page — rate limited');
      }
      if (text.includes('codetabs.com') && text.includes('API') && !targetUrl.includes('codetabs')) {
        throw new Error('Proxy returned its own page — rate limited');
      }

      // Rewrite relative URLs so assets load correctly
      const rewritten = rewriteUrls(text, targetUrl);

      // Inject link interceptor — catches ALL clicks and posts message to parent
      // This prevents 410 errors from expired stream URLs opening in new tabs
      const interceptScript = `
<script>
(function() {
  // Remove all target="_blank" to prevent new tab opens
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[target]').forEach(function(a) {
      a.removeAttribute('target');
    });
  });
  // Intercept all clicks on anchor tags
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (el && el.href && el.href.startsWith('http') && !el.href.startsWith(window.location.origin)) {
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({ type: 'NDR_NAVIGATE', url: el.href }, '*');
    }
  }, true);
  // Also intercept window.open calls
  var origOpen = window.open;
  window.open = function(url) {
    if (url && url.startsWith('http')) {
      window.parent.postMessage({ type: 'NDR_NAVIGATE', url: url }, '*');
    }
    return null;
  };
})();
</script>`;

      // Insert interceptor right after <head> tag
      const injected = rewritten.replace(/<head([^>]*)>/i, `<head$1>${interceptScript}`);

      // Create a blob URL — this loads in iframe without any X-Frame-Options issues
      const blob = new Blob([injected], { type: 'text/html; charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);

      currentIndex = idx;
      failCounts[idx] = 0;
      console.log(`✅ Proxy ${PROXY_NAMES[idx]} succeeded (${text.length} bytes)`);
      return blobUrl;

    } catch (err) {
      console.warn(`❌ Proxy ${PROXY_NAMES[idx]} failed:`, err);
      failCounts[idx]++;
    }
  }

  // All proxies failed — return direct URL as last resort
  console.warn('All proxies failed, using direct URL');
  return targetUrl;
}
