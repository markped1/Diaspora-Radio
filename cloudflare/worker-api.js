/**
 * NDR CORS + Frame Proxy — Cloudflare Worker
 *
 * Two modes:
 * 1. ?url=https://stream.m3u8  → IPTV/HLS proxy (strips CORS, rewrites segments)
 * 2. ?page=https://site.com    → Full page proxy (strips X-Frame-Options, CSP frame-ancestors)
 *
 * Usage:
 *   IPTV:  https://worker.dev/?url=https://stream.example.com/live.m3u8
 *   Page:  https://worker.dev/?page=https://daddyhd.com
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
  const pathname = urlObj.pathname; // e.g. /page/https://daddyhd.com or /url/https://stream.m3u8

  // Support path-based routing: /page/<target> or /url/<target>
  let streamTarget = null;
  let pageTarget = null;

  if (pathname.startsWith('/page/')) {
    pageTarget = decodeURIComponent(pathname.substring(6));
  } else if (pathname.startsWith('/url/')) {
    streamTarget = decodeURIComponent(pathname.substring(5));
  } else {
    // Fallback: query string (for backward compat)
    const qIndex = rawUrl.indexOf('?');
    if (qIndex !== -1) {
      const qs = rawUrl.substring(qIndex + 1);
      const urlIdx = qs.indexOf('url=');
      const pageIdx = qs.indexOf('page=');
      if (pageIdx !== -1) pageTarget = decodeURIComponent(qs.substring(pageIdx + 5).split('&')[0]);
      else if (urlIdx !== -1) streamTarget = decodeURIComponent(qs.substring(urlIdx + 4).split('&')[0]);
    }
  }

  // ── No target — health check ──────────────────────────────────────────────
  if (!streamTarget && !pageTarget) {
    return new Response('NDR Proxy OK\n?url= for IPTV streams\n?page= for web pages', {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  }

  // ── PAGE PROXY — strips X-Frame-Options and CSP frame-ancestors ───────────
  if (pageTarget) {
    if (!pageTarget.startsWith('http')) {
      return new Response('Invalid URL', { status: 400, headers: CORS_HEADERS });
    }
    try {
      const targetOrigin = new URL(pageTarget).origin;
      const workerBase = rawUrl.split('?')[0];

      const upstream = await fetch(pageTarget, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': targetOrigin,
        },
        redirect: 'follow',
      });

      const contentType = upstream.headers.get('content-type') || 'text/html';
      let body = await upstream.text();

      // Inject a <base> tag so relative URLs resolve correctly against the target origin
      // Also inject a script to intercept link clicks and route through proxy
      const baseTag = `<base href="${targetOrigin}/">`;
      const interceptScript = `<script>
        (function(){
          // Proxy all fetch/XHR requests
          var proxyBase = '${workerBase}?page=';
          // Override link clicks to stay in proxy
          document.addEventListener('click', function(e){
            var a = e.target.closest('a');
            if(a && a.href && a.href.startsWith('http') && !a.href.includes('${workerBase}')){
              e.preventDefault();
              window.location.href = proxyBase + encodeURIComponent(a.href);
            }
          }, true);
        })();
      </script>`;

      // Insert base tag and intercept script into <head>
      body = body.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${interceptScript}`);

      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          // No X-Frame-Options, no CSP — stripped intentionally
        },
      });
    } catch (err) {
      return new Response('Page proxy error: ' + err.message, {
        status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
      });
    }
  }

  // ── STREAM PROXY — IPTV/HLS m3u8 ─────────────────────────────────────────
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
      const workerBase = rawUrl.split('?')[0];
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
