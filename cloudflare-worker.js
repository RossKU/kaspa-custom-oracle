/**
 * Cloudflare Workers CORS Proxy
 *
 * Usage: https://your-worker.workers.dev/?url=https://api.example.com/endpoint
 *
 * Features:
 * - Adds CORS headers to any API response
 * - Forwards all request methods (GET, POST, etc.)
 * - Preserves headers and body
 * - No rate limits (Cloudflare free tier: 100k requests/day)
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    try {
      // Get target URL from query parameter
      const url = new URL(request.url);
      const targetUrl = url.searchParams.get('url');

      if (!targetUrl) {
        return new Response('Missing url parameter', {
          status: 400,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Validate URL
      let target;
      try {
        target = new URL(targetUrl);
      } catch (e) {
        return new Response('Invalid URL', {
          status: 400,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Security: Only allow specific domains (optional)
      const allowedDomains = [
        'open-api.bingx.com',
        'api.bingx.com',
        // Add other domains as needed
      ];

      if (!allowedDomains.some(domain => target.hostname.includes(domain))) {
        return new Response('Domain not allowed', {
          status: 403,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Forward the request
      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
      });

      // Fetch from target API
      const response = await fetch(proxyRequest);

      // Create new response with CORS headers
      const newResponse = new Response(response.body, response);

      // Add CORS headers
      newResponse.headers.set('Access-Control-Allow-Origin', '*');
      newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      newResponse.headers.set('Access-Control-Allow-Headers', '*');
      newResponse.headers.set('Access-Control-Max-Age', '86400');

      return newResponse;

    } catch (error) {
      return new Response(`Proxy error: ${error.message}`, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};

function handleOptions(request) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}
