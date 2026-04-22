/**
 * NDR CORS Proxy — Cloudflare Worker
 * Proxies IPTV m3u8 streams adding CORS headers so browsers can play any stream.
 * Usage: https://your-worker.workers.dev/?url=https://stream.example.com/live.m3u8
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

  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response('NDR CORS Proxy — add ?url=https://stream.m3u8', {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  }

  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    return new Response('Only http/https URLs allowed', {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
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
      const proxyBase = url.protocol + '//' + url.host + '/?url=';

      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;

        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return proxyBase + encodeURIComponent(trimmed);
        }
        if (trimmed.startsWith('//')) {
          return proxyBase + encodeURIComponent('https:' + trimmed);
        }
        // Relative URL
        const resolved = new URL(trimmed, baseUrl + basePath).href;
        return proxyBase + encodeURIComponent(resolved);
      }).join('\n');

      return new Response(rewritten, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Binary segments — stream through
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=10',
      },
    });

  } catch (err) {
    return new Response('Proxy error: ' + err.message, {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  }
}
