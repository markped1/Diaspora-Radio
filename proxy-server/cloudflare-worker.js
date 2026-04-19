export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response('NDR Sports Proxy OK', { status: 200 });
    }

    let target;
    try {
      target = new URL(decodeURIComponent(targetUrl));
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    const workerOrigin = url.origin;
    const proxyPrefix = workerOrigin + '/?url=';

    try {
      const response = await fetch(target.href, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': request.headers.get('Accept') || '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': target.origin + '/',
          'Origin': target.origin,
        },
        redirect: 'follow',
      });

      const newHeaders = new Headers(response.headers);
      newHeaders.delete('x-frame-options');
      newHeaders.delete('content-security-policy');
      newHeaders.delete('content-security-policy-report-only');
      newHeaders.set('access-control-allow-origin', '*');

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/html')) {
        let html = await response.text();
        const o = target.origin;

        html = html
          .replace(/(src|href|action)="(https?:\/\/[^"]+)"/gi, function(m,a,u){ return a+'="'+proxyPrefix+encodeURIComponent(u)+'"'; })
          .replace(/(src|href|action)='(https?:\/\/[^']+)'/gi, function(m,a,u){ return a+"='"+proxyPrefix+encodeURIComponent(u)+"'"; })
          .replace(/(src|href|action)="(\/[^"]+)"/gi, function(m,a,p){ return a+'="'+proxyPrefix+encodeURIComponent(o+p)+'"'; })
          .replace(/(src|href|action)='(\/[^']+)'/gi, function(m,a,p){ return a+"='"+proxyPrefix+encodeURIComponent(o+p)+"'"; });

        var inject = '<base href="'+o+'/"><script>(function(){document.addEventListener("click",function(e){var el=e.target;while(el&&el.tagName!=="A")el=el.parentElement;if(el&&el.href&&el.href.startsWith("http")){e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"NDR_NAVIGATE",url:el.href},"*");}},true);window.open=function(u){if(u)window.parent.postMessage({type:"NDR_NAVIGATE",url:u},"*");return null;};})();<\/script>';
        html = html.replace(/<head([^>]*)>/i, '<head$1>'+inject);

        newHeaders.set('content-type', 'text/html; charset=utf-8');
        return new Response(html, { status: response.status, headers: newHeaders });
      }

      if (contentType.includes('javascript') || contentType.includes('text/css')) {
        let text = await response.text();
        return new Response(text, { status: response.status, headers: newHeaders });
      }

      return new Response(response.body, { status: response.status, headers: newHeaders });

    } catch (err) {
      return new Response('Proxy error: ' + err.message, {
        status: 502,
        headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }
      });
    }
  },
};
