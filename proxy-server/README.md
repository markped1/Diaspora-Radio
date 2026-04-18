# NDR Sports Proxy

Strips `X-Frame-Options` headers so any sports site can be embedded in the NDR sports browser.

## Deploy Free on Railway (Recommended — 5 minutes)

1. Go to https://railway.app and sign up (free, no card)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your NDR repo
4. Set **Root Directory** to `proxy-server`
5. Railway auto-detects Node.js and deploys
6. Copy the generated URL (e.g. `https://ndr-proxy.railway.app`)
7. Add to your `.env.local`:
   ```
   VITE_PROXY_URL=https://ndr-proxy.railway.app
   ```
8. Restart `npm run dev`

## Deploy on Render (Alternative)

1. Go to https://render.com → New Web Service
2. Connect GitHub repo, set Root Directory to `proxy-server`
3. Build command: `npm install`
4. Start command: `npm start`
5. Copy URL → add to `.env.local` as `VITE_PROXY_URL`

## How it works

The proxy receives requests like:
```
GET https://your-proxy.railway.app/proxy?url=https://yalla-live.cyou
```

It fetches the page, strips `X-Frame-Options` and `Content-Security-Policy` headers, and returns the content — allowing it to load in an iframe.
