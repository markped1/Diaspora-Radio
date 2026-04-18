/**
 * NDR Sports Proxy Server
 * Strips X-Frame-Options and Content-Security-Policy headers
 * so any website can be embedded in the sports browser iframe.
 *
 * Deploy free on:
 *   - Railway:  https://railway.app  (connect GitHub repo, deploy this folder)
 *   - Render:   https://render.com   (new Web Service, root dir: proxy-server)
 *   - Vercel:   npx vercel (from proxy-server folder)
 *
 * After deploying, set VITE_PROXY_URL=https://your-proxy.railway.app in .env.local
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow requests from any origin (your NDR app)
app.use(cors({ origin: '*' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'NDR Sports Proxy' }));

// Proxy route: /proxy?url=https://yalla-live.cyou
app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  let target;
  try {
    target = new URL(decodeURIComponent(targetUrl));
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Strip headers that block iframe embedding
  const stripHeaders = (proxyRes) => {
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['content-security-policy-report-only'];
    delete proxyRes.headers['x-content-type-options'];
    // Allow embedding from anywhere
    proxyRes.headers['access-control-allow-origin'] = '*';
  };

  createProxyMiddleware({
    target: target.origin,
    changeOrigin: true,
    pathRewrite: () => target.pathname + target.search,
    on: {
      proxyRes: stripHeaders,
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(502).json({ error: 'Proxy failed: ' + err.message });
      },
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  })(req, res, next);
});

app.listen(PORT, () => {
  console.log(`NDR Sports Proxy running on port ${PORT}`);
  console.log(`Usage: GET /proxy?url=https://yalla-live.cyou`);
});
