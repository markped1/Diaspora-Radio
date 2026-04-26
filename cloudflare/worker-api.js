/**
 * NDR CORS + Frame Proxy — Cloudflare Worker
 *
 * Routes:
 * /page/<url>  → Full page proxy (strips X-Frame-Options, injects Push Live button)
 * /url/<url>   → IPTV/HLS stream proxy (strips CORS, rewrites m3u8 segments)
 * ?url=<url>   → Legacy stream proxy (backward compat)
 * ?page=<url>  → Legacy page proxy (backward compat, used by in-page navigation)
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const rawUrl = request.url;
  const urlObj = new URL(rawUrl);
  const pathname = urlObj.pathname;
  const workerBase = rawUrl.split('?')[0].replace(/\/$/, '');

  let streamTarget = null;
  let pageTarget = null;

  // Path-based routing: /page/<target> or /url/<target>
  if (pathname.startsWith('/page/')) {
    pageTarget = decodeURIComponent(pathname.substring(6));
  } else if (pathname.startsWith('/url/')) {
    streamTarget = decodeURIComponent(pathname.substring(5));
  } else {
    // Query string fallback (used by in-page link navigation: ?page=... or ?url=...)
    const qs = urlObj.search.substring(1);
    const params = new URLSearchParams(qs);
    if (params.has('page')) pageTarget = params.get('page');
    else if (params.has('url')) streamTarget = params.get('url');
  }

  // ── Health check ──────────────────────────────────────────────────────────
  if (!streamTarget && !pageTarget) {
    return new Response('NDR Proxy OK\n/page/<url> for web pages\n/url/<url> for IPTV streams', {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  }

  // ── PAGE PROXY ────────────────────────────────────────────────────────────
  if (pageTarget) {
    if (!pageTarget.startsWith('http')) {
      return new Response('Invalid URL', { status: 400, headers: CORS_HEADERS });
    }
    try {
      const targetOrigin = new URL(pageTarget).origin;

      const upstream = await fetch(pageTarget, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': targetOrigin + '/',
        },
        redirect: 'follow',
      });

      const contentType = upstream.headers.get('content-type') || 'text/html';
      let body = await upstream.text();

      // Inject base tag + link interceptor + floating Push Live button
      const inject = `<base href="${targetOrigin}/">
<script>
(function(){
  var WB = '${workerBase}';

  // Intercept all link clicks — route through proxy instead of opening new tab
  document.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if(a && a.href && a.href.startsWith('http') && !a.href.includes(WB)){
      e.preventDefault();
      e.stopPropagation();
      // Post to parent (SportsTv iframe handler)
      try { window.parent.postMessage({type:'NDR_NAVIGATE', url: a.href}, '*'); } catch(x){}
    }
  }, true);

  // Block window.open — route through parent instead
  window.open = function(u){ 
    if(u) try { window.parent.postMessage({type:'NDR_NAVIGATE', url: u}, '*'); } catch(x){}
    return null; 
  };
  // Floating Push Live button
  function addPushBtn(){
    if(document.getElementById('ndr-push-btn')) return;
    var btn = document.createElement('div');
    btn.id = 'ndr-push-btn';
    btn.innerHTML = '🔴 PUSH LIVE';
    btn.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:2147483647;background:#e53e3e;color:#fff;font-weight:900;font-size:13px;padding:12px 20px;border-radius:50px;box-shadow:0 4px 24px rgba(0,0,0,0.6);cursor:pointer;letter-spacing:1px;border:2px solid #fff;font-family:sans-serif;';
    btn.onclick = function(){
      try { window.parent.postMessage({type:'NDR_PUSH_LIVE', url: window.location.href}, '*'); } catch(x){}
      btn.innerHTML = '✅ PUSHED!';
      btn.style.background = '#38a169';
      setTimeout(function(){ btn.innerHTML = '🔴 PUSH LIVE'; btn.style.background = '#e53e3e'; }, 2000);
    };
    document.body ? document.body.appendChild(btn) : document.addEventListener('DOMContentLoaded', addPushBtn);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addPushBtn);
  else addPushBtn();
})();
<\/script>`;

      body = body.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
      // If no <head>, prepend
      if (!body.includes(inject)) body = inject + body;
      // Strip all target="_blank" so links can't escape the iframe
      body = body.replace(/target\s*=\s*["']_blank["']/gi, 'target="_self"');

      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          // X-Frame-Options and CSP intentionally stripped
        },
      });
    } catch (err) {
      return new Response('Page proxy error: ' + err.message, {
        status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
      });
    }
  }

  // ── STREAM PROXY — IPTV/HLS ───────────────────────────────────────────────
  const target = streamTarget;
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    return new Response('Only http/https URLs allowed', {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  }

  try {
    const targetUrl = new URL(target);
    const baseUrl = targetUrl.protocol + '//' + targetUrl.host;
    const basePath = targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1);

    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NDR-Proxy/1.0)',
        'Referer': baseUrl + '/',
        'Origin': baseUrl,
      },
    });

    const contentType = upstream.headers.get('content-type') || '';
    const isM3u8 = target.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegurl');

    if (isM3u8) {
      const text = await upstream.text();
      const proxyBase = workerBase + '?url=';

      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return proxyBase + encodeURIComponent(trimmed);
        }
        if (trimmed.startsWith('//')) {
          return proxyBase + encodeURIComponent('https:' + trimmed);
        }
        const resolved = new URL(trimmed, baseUrl + basePath).href;
        return proxyBase + encodeURIComponent(resolved);
      }).join('\n');

      return new Response(rewritten, {
        status: upstream.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=10' },
    });

  } catch (err) {
    return new Response('Proxy error: ' + err.message, {
      status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  }
}
