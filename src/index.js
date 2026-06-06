// Logbook — Cloudflare Worker (API)
// ----------------------------------
//  GET  /api/projects : list all projects (token required)
//  POST /api/status   : upsert by project name (token required; updatedAt is set automatically)
//  Other paths are served by the static asset (public/index.html).
//
//  Fields per project: status (enum), summary (current state), next (next step), repo (optional)
//  Auth:    Authorization: Bearer <LOGBOOK_TOKEN>   (set via `wrangler secret put LOGBOOK_TOKEN`)
//  Storage: Workers KV (binding=LOGBOOK_KV), single key "projects" holding an array.

const STATUSES = ["active", "stalled", "done", "frozen"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/projects" && request.method === "GET") return handleList(request, env);
    if (url.pathname === "/api/status" && request.method === "POST") return handleUpsert(request, env);
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

  const projects = await readProjects(env);
  let p = projects.find(function (x) {
    return String(x.name).toLowerCase() === name.toLowerCase();
  });
  if (!p) {
    p = { id: crypto.randomUUID(), name: name, status: "active", summary: "", next: "", repo: "" };
    projects.push(p);
  }

  // merge only the provided fields (partial updates are fine)
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return json({ error: "status must be one of: " + STATUSES.join(", ") }, 400);
    }
    p.status = body.status;
  }
  if (body.summary !== undefined) p.summary = (body.summary === null ? "" : String(body.summary));
  if (body.next !== undefined) p.next = (body.next === null ? "" : String(body.next));
  if (body.repo !== undefined) p.repo = (body.repo === null ? "" : String(body.repo));
  p.updatedAt = Date.now(); // server-side, can't be faked

  await writeProjects(env, projects);
  return json({ ok: true, project: p });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
