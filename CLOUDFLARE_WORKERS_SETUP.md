# Cloudflare Workers CORS Proxy Setup

## Why Cloudflare Workers?

BingX API doesn't allow direct browser access due to CORS policy. We previously used `corsproxy.io`, but it has rate limits causing 403 errors.

**Cloudflare Workers solution**:
- ✅ **Free**: 100,000 requests/day
- ✅ **Fast**: Cloudflare CDN worldwide
- ✅ **Reliable**: No rate limits
- ✅ **Secure**: You control the proxy

## Step 1: Create Cloudflare Account

1. Go to https://workers.cloudflare.com/
2. Sign up for free account (no credit card required)
3. Verify your email

## Step 2: Create Worker

1. Click **"Create a Service"** or **"Create Worker"**
2. Name it: `bingx-cors-proxy` (or any name you prefer)
3. Click **"Create Service"**

## Step 3: Deploy Proxy Code

1. Click **"Quick Edit"** button
2. **Delete all existing code** in the editor
3. **Copy and paste** the entire code from `cloudflare-worker.js` file
4. Click **"Save and Deploy"**

## Step 4: Get Your Worker URL

After deployment, your worker will be available at:
```
https://bingx-cors-proxy.YOUR-SUBDOMAIN.workers.dev
```

Example:
```
https://bingx-cors-proxy.john-doe.workers.dev
```

**Copy this URL** - you'll need it in the next step.

## Step 5: Update Application Code

Open `src/services/bingx-api.ts` and update line 9:

**Before**:
```typescript
const CORS_PROXY = 'https://corsproxy.io/?';
```

**After**:
```typescript
const CORS_PROXY = 'https://bingx-cors-proxy.YOUR-SUBDOMAIN.workers.dev/?url=';
```

**⚠️ Important**: Replace `YOUR-SUBDOMAIN` with your actual Cloudflare Workers subdomain.

## Step 6: Test

1. Commit and push your changes
2. Wait for GitHub Actions to deploy
3. Open your app: https://rossku.github.io/kaspa-custom-oracle/
4. Check browser console for errors
5. Verify no 403 errors in logs

## Usage Example

Your Cloudflare Worker accepts requests in this format:
```
https://bingx-cors-proxy.YOUR-SUBDOMAIN.workers.dev/?url=https://open-api.bingx.com/openApi/swap/v2/quote/depth?symbol=KAS-USDT
```

The worker will:
1. Fetch from BingX API
2. Add CORS headers to response
3. Return data to your browser

## Monitoring

1. Go to Cloudflare Workers dashboard
2. Click on your worker
3. View **"Metrics"** tab to see:
   - Requests per day
   - Success rate
   - Response time

## Troubleshooting

### Worker not found (404)
- Check your worker URL is correct
- Make sure worker is deployed (green checkmark)

### Still getting CORS errors
- Verify CORS_PROXY URL ends with `/?url=`
- Check browser console for exact error
- Try accessing worker URL directly in browser

### Rate limits
- Cloudflare Workers free tier: 100k requests/day
- If you exceed this, upgrade to paid plan ($5/month for 10M requests)

## Security Note

The provided worker code includes domain whitelist for BingX only:
```javascript
const allowedDomains = [
  'open-api.bingx.com',
  'api.bingx.com',
];
```

This prevents abuse of your proxy by third parties.

## Cost

**Free tier limits**:
- 100,000 requests/day
- 10ms CPU time per request
- 128MB memory

**Your usage** (estimated):
- Order book: 5s interval = 17,280 requests/day
- Position API: 5s interval = 17,280 requests/day
- **Total: ~35,000 requests/day** ✅ Within free tier

## Alternative: Vercel Serverless Functions

If you prefer Vercel (requires moving from GitHub Pages):

1. Deploy to Vercel instead of GitHub Pages
2. Create `/api/proxy.ts` file:
```typescript
export default async function handler(req: any, res: any) {
  const { url } = req.query;
  const response = await fetch(url);
  const data = await response.json();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(data);
}
```

3. Use: `https://your-app.vercel.app/api/proxy?url=...`

---

**Need help?** Check Cloudflare Workers docs: https://developers.cloudflare.com/workers/
