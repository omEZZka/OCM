/**
 * Cloudflare Worker: Community Database for OpenCode
 * Fallback REST API for Jailbreaks & Plugins
 * 
 * Free tier setup:
 * 1. Deploy this worker to Cloudflare Workers (e.g. `ocm-community`)
 * 2. Bind a KV namespace named `OCM_KV` (Workers & Pages -> Settings -> Variables -> KV Namespace Bindings)
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const pathParts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const col = pathParts[0] || 'jailbreaks';
    const id = pathParts[1] || null;

    const kv = env && env.OCM_KV;

    // GET /:collection or GET /:collection/:id
    if (request.method === 'GET') {
      if (id) {
        let item = kv ? await kv.get(`${col}:${id}`, 'json') : null;
        return new Response(JSON.stringify(item || {}), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      let list = [];
      if (kv) {
        const keys = await kv.list({ prefix: `${col}:` });
        for (const k of keys.keys) {
          const val = await kv.get(k.name, 'json');
          if (val) list.push(val);
        }
      }
      return new Response(JSON.stringify(list), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST /:collection or PUT /:collection/:id
    if (request.method === 'POST' || request.method === 'PUT') {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const itemId = id || body.id || (col + '_' + Date.now().toString(36));
      body.id = itemId;
      if (kv) {
        let existing = await kv.get(`${col}:${itemId}`, 'json') || {};
        const merged = Object.assign(existing, body);
        await kv.put(`${col}:${itemId}`, JSON.stringify(merged));
        return new Response(JSON.stringify(merged), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(body), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // PATCH /:collection/:id (partial update, e.g. likes/dislikes)
    if (request.method === 'PATCH') {
      if (!id) return new Response('Missing ID', { status: 400, headers: corsHeaders });
      let body = {};
      try { body = await request.json(); } catch (_) {}
      if (kv) {
        let existing = await kv.get(`${col}:${id}`, 'json') || {};
        const merged = Object.assign(existing, body);
        await kv.put(`${col}:${id}`, JSON.stringify(merged));
        return new Response(JSON.stringify(merged), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(body), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // DELETE /:collection/:id
    if (request.method === 'DELETE') {
      if (id && kv) {
        await kv.delete(`${col}:${id}`);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};
