// Masa English relay (Cloudflare Worker).
// Keeps the Anthropic API key on the server and only answers requests that
// carry the shared passphrase (APP_TOKEN) from the app's own origin.
//
// Settings → Variables and Secrets in the Cloudflare dashboard:
//   ANTHROPIC_API_KEY  (Secret)  the Anthropic API key
//   APP_TOKEN          (Secret)  the passphrase typed into the app's settings
//   ALLOWED_ORIGIN     (Text)    e.g. https://your-name.github.io
//   GRADE_MODEL        (Text, optional) model for corrections, default claude-sonnet-5-5
//   SCENE_MODEL        (Text, optional) model for new scenes, default claude-haiku-5-5
//
// Plain fetch is used (no npm packages) so the file can be pasted straight
// into the dashboard editor without a build step.

// Cost-conscious defaults: Sonnet 5.5 for corrections (nuance matters), Haiku 5.5 for scene writing.
const DEFAULT_MODEL = { scene: "claude-haiku-5-5", grade: "claude-sonnet-5-5" };
const EFFORT = { scene: "low", grade: "medium" };
// Server-side refusal fallback ("default" mode) is not offered for Haiku models.
const supportsFallback = (model) => !/haiku/.test(model);
const MAX_PROMPT_CHARS = 20000;

// Structured outputs: the API guarantees the reply matches these shapes,
// so smaller models can't break the JSON the app reads.
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: "string" };
const int = { type: "integer" };
const mark = { type: "string", enum: ["○", "△", "×"] };
const fix = { type: "array", items: obj({ from: str, to: str, why: str }) };
const SCHEMA = {
  scene: obj({
    title: str,
    type: str,
    partnerName: str,
    setting: str,
    turns: { type: "array", items: obj({ partner: str, ja: str, en: str }) },
  }),
  grade: obj({
    score: int,
    scores: obj({ grammar: int, nuance: int, structure: int }),
    summary: str,
    grammar: fix,
    nuance: fix,
    structure: fix,
    corrected: str,
    natural: { type: "array", items: obj({ en: str, tone: { type: "string", enum: ["カジュアル", "標準", "丁寧"] }, note: str }) },
    keyPhrase: obj({ en: str, ja: str, note: str }),
    cefr: { type: "string", enum: ["A2", "B1", "B2", "C1", "C2"] },
    judge: obj({
      meaning: mark, meaningNote: str,
      grammar: mark, grammarNote: str,
      pronunciation: { type: "string", enum: ["○", "△", "×", "－"] }, pronunciationNote: str,
    }),
  }),
};

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
    if (!Object.hasOwn(EFFORT, kind) || !prompt || prompt.length > MAX_PROMPT_CHARS) return reply(400, { code: "bad_request" });

    const model = (kind === "grade" ? env.GRADE_MODEL : env.SCENE_MODEL) || DEFAULT_MODEL[kind];
    const fallback = supportsFallback(model);
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2026-10-21",
    };
    // If a safety classifier declines, the API retries on its recommended fallback model.
    if (fallback) headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    const payload = {
      model,
      max_tokens: 16000,
      output_config: { effort: EFFORT[kind], format: { type: "json_schema", schema: SCHEMA[kind] } },
      messages: [{ role: "user", content: prompt }],
    };
    if (fallback) payload.fallbacks = "default";

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch {
      return reply(502, { code: "upstream_error" });
    }

    if (res.status === 429) return reply(429, { code: "rate_limited" });
    const data = await res.json().catch(() => null);
    const err = (data && data.error) || {};
    // Out of API credit: say so plainly instead of a generic network error.
    if (res.status === 402 || err.type === "billing_error" || /credit balance/i.test(err.message || "")) return reply(402, { code: "no_credit" });
    if (!res.ok || !data) return reply(502, { code: "upstream_error", status: res.status, detail: err.type });
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
