// Logbook — Cloudflare Worker (API)
// ----------------------------------
//  GET    /api/projects      : list all projects (token required)
//  POST   /api/status        : upsert by project name (token required; updatedAt is set automatically)
//  DELETE /api/projects/:id  : delete a project by id (token required)
//  Other paths are served by the static asset (public/index.html).
//
//  Fields per project: status (enum), summary (current state), next (next step), repo (optional)
//  Auth:    Authorization: Bearer <LOGBOOK_TOKEN>   (set via `wrangler secret put LOGBOOK_TOKEN`)
//  Storage: Workers KV (binding=LOGBOOK_KV), single key "projects" holding an array.

const STATUSES = ["active", "stalled", "done", "frozen"];

// Per-field length caps. Keep KV value compact and reject obvious DoS payloads.
const LIMITS = { project: 100, summary: 5000, next: 2000, repo: 500 };

function tooLong(s, max) { return typeof s === "string" && s.length > max; }
function isValidRepoUrl(s) { return s === "" || /^https?:\/\//i.test(s); }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/projects" && request.method === "GET") return handleList(request, env);
    if (url.pathname === "/api/status" && request.method === "POST") return handleUpsert(request, env);
    const delMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (delMatch && request.method === "DELETE") return handleDelete(request, env, decodeURIComponent(delMatch[1]));
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return new Response("Not found", { status: 404 }); // non-API handled by static assets
  }
};

function authed(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  return Boolean(env.LOGBOOK_TOKEN) && token === env.LOGBOOK_TOKEN;
}

async function readProjects(env) {
  const raw = await env.LOGBOOK_KV.get("projects");
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    return Array.isArray(d) ? d : [];
  } catch (e) {
    return [];
  }
}
async function writeProjects(env, projects) {
  await env.LOGBOOK_KV.put("projects", JSON.stringify(projects));
}

async function handleList(request, env) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
  const projects = await readProjects(env);
  return json({ projects: projects });
}

async function handleUpsert(request, env) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid JSON body" }, 400);
  }

  const name = (body.project || body.name || "").toString().trim();
  if (!name) return json({ error: "field 'project' is required" }, 400);
  if (tooLong(name, LIMITS.project)) return json({ error: "project name too long (max " + LIMITS.project + " chars)" }, 400);

  const projects = await readProjects(env);
  let p = projects.find(function (x) {
    return String(x.name).toLowerCase() === name.toLowerCase();
  });
  if (!p) {
    p = { id: crypto.randomUUID(), name: name, status: "active", summary: "", next: "", repo: "" };
    projects.push(p);
  }

  // merge only the provided fields (partial updates are fine); validate each.
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return json({ error: "status must be one of: " + STATUSES.join(", ") }, 400);
    }
    p.status = body.status;
  }
  if (body.summary !== undefined) {
    const s = body.summary === null ? "" : String(body.summary);
    if (tooLong(s, LIMITS.summary)) return json({ error: "summary too long (max " + LIMITS.summary + " chars)" }, 400);
    p.summary = s;
  }
  if (body.next !== undefined) {
    const s = body.next === null ? "" : String(body.next);
    if (tooLong(s, LIMITS.next)) return json({ error: "next too long (max " + LIMITS.next + " chars)" }, 400);
    p.next = s;
  }
  if (body.repo !== undefined) {
    const s = (body.repo === null ? "" : String(body.repo)).trim();
    if (tooLong(s, LIMITS.repo)) return json({ error: "repo too long (max " + LIMITS.repo + " chars)" }, 400);
    if (!isValidRepoUrl(s)) return json({ error: "repo must start with http:// or https://" }, 400);
    p.repo = s;
  }
  p.updatedAt = Date.now(); // server-side, can't be faked

  await writeProjects(env, projects);
  return json({ ok: true, project: p });
}

async function handleDelete(request, env, id) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
  if (!id) return json({ error: "id is required" }, 400);

  const projects = await readProjects(env);
  const idx = projects.findIndex(function (x) { return x.id === id; });
  if (idx === -1) return json({ error: "project not found" }, 404);

  const removed = projects.splice(idx, 1)[0];
  await writeProjects(env, projects);
  return json({ ok: true, deleted: removed });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store"
    }
  });
}
