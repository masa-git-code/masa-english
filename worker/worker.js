// Masa English relay (Cloudflare Worker).
// Keeps the Anthropic API key on the server and only answers requests that
// carry the shared passphrase (APP_TOKEN) from the app's own origin.
//
// Settings → Variables and Secrets in the Cloudflare dashboard:
//   ANTHROPIC_API_KEY  (Secret)  the Anthropic API key
//   APP_TOKEN          (Secret)  the passphrase typed into the app's settings
//   ALLOWED_ORIGIN     (Text)    e.g. https://your-name.github.io
//
// Plain fetch is used (no npm packages) so the file can be pasted straight
// into the dashboard editor without a build step.

const MODEL = "claude-opus-5-5";
const EFFORT = { scene: "low", grade: "medium" };
const MAX_PROMPT_CHARS = 20000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : (allowed[0] || ""),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (request.method !== "POST") return reply(405, { code: "method_not_allowed" });
    if (!okOrigin) return reply(403, { code: "forbidden_origin" });
    if (!env.ANTHROPIC_API_KEY || !env.APP_TOKEN) return reply(500, { code: "server_not_configured" });

    const auth = request.headers.get("Authorization") || "";
    if (!safeEqual(auth, "Bearer " + env.APP_TOKEN)) return reply(401, { code: "bad_pass" });

    let body;
    try { body = await request.json(); } catch { return reply(400, { code: "bad_request" }); }
    const kind = body && body.kind;
    const prompt = body && typeof body.prompt === "string" ? body.prompt : "";
    if (!EFFORT[kind] || !prompt || prompt.length > MAX_PROMPT_CHARS) return reply(400, { code: "bad_request" });

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2026-10-21",
          // If a safety classifier declines, the API retries on its recommended fallback model.
          "anthropic-beta": "server-side-fallback-2026-07-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 16000,
          output_config: { effort: EFFORT[kind] },
          fallbacks: "default",
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch {
      return reply(502, { code: "upstream_error" });
    }

    if (res.status === 429) return reply(429, { code: "rate_limited" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return reply(502, { code: "upstream_error", status: res.status, detail: data && data.error && data.error.type });
    if (data.stop_reason === "refusal") return reply(422, { code: "refused" });

    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text.trim()) return reply(502, { code: "empty_completion" });
    return reply(200, { text, stop_reason: data.stop_reason });
  },
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
