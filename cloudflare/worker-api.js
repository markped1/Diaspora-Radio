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
  const qIndex = rawUrl.indexOf('?');
  const params = qIndex !== -1 ? new URLSearchParams(rawUrl.substring(qIndex + 1)) : new URLSearchParams();

  const streamTarget = params.get('url');
  const pageTarget = params.get('page');

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
      const upstream = await fetch(pageTarget, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': new URL(pageTarget).origin,
        },
        redirect: 'follow',
      });

      const contentType = upstream.headers.get('content-type') || 'text/html';
      let body = await upstream.text();

      // Rewrite absolute URLs to go through proxy
      const origin = new URL(pageTarget).origin;
      body = body
        .replace(/href="\/(?!\/)/g, `href="${origin}/`)
        .replace(/src="\/(?!\/)/g, `src="${origin}/`)
        .replace(/action="\/(?!\/)/g, `action="${origin}/`);

      // Build clean response headers — strip all frame-blocking headers
      const responseHeaders = {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        // Explicitly DO NOT set X-Frame-Options or CSP frame-ancestors
      };

      return new Response(body, { status: upstream.status, headers: responseHeaders });
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
