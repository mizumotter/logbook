# Deploy — Logbook

**Where all your projects stand.**

A Cloudflare Worker that serves the Logbook board UI **and** an API your AI agent can POST to.

```
logbook/
  wrangler.jsonc      # config (KV binding, static assets)
  src/index.js        # the API (GET /api/projects, POST /api/status)
  public/index.html   # the board UI
```

You need: a Cloudflare account, Node.js installed, and (optional) a domain already on Cloudflare if you want a custom URL. All commands use `npx wrangler` (no global install needed).

## 1. Log in
```
npx wrangler login
```

## 2. Create the KV namespace
```
npx wrangler kv namespace create LOGBOOK_KV
```
It prints an `id`. Open `wrangler.jsonc` and replace `<KV_ID_HERE>` with that id.

## 3. Set your access token (Logbook's key)
Generate a strong random token and register it as a secret:
```
openssl rand -hex 32        # copy the output
npx wrangler secret put LOGBOOK_TOKEN
# paste the token when prompted
```
Save this token somewhere safe (a password manager). It is the key to read **and** write your Logbook.
- It is stored server-side as a secret — never in the code or the repo.
- If `secret put` says the Worker doesn't exist yet, run step 4 once first, then redo step 3.

## 4. Deploy
```
npx wrangler deploy
```
You get a URL like `https://logbook.<you>.workers.dev`.

## 5. Test the API (prove the write path)
Write one project:
```
curl -X POST https://logbook.<you>.workers.dev/api/status \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project":"my-app","status":"active","summary":"Where things stand right now.","next":"The one next thing to do.","repo":"https://github.com/you/my-app"}'
```
Read it back:
```
curl https://logbook.<you>.workers.dev/api/projects \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 6. Open the board
Visit the Worker URL in a browser, paste your token once → Logbook appears. Tap any card to expand its current state and next step.

## 7. Let your agent keep it current
Tell your coding agent (e.g. Claude Code), once:
> At the end of each session, POST our status to
> `https://logbook.<you>.workers.dev/api/status`
> with header `Authorization: Bearer <TOKEN>` and JSON body
> `{ "project": "<repo name>", "status": "active|stalled|done|frozen", "summary": "<where it stands now>", "next": "<the next step>" }`.

Now you just code; the agent keeps Logbook current; you only look.

## 8. Custom domain (optional)
Cloudflare dashboard → Workers & Pages → `logbook` → Settings → Domains & Routes →
add `logbook.your-domain.com`. Since the domain is on Cloudflare, DNS is set up automatically.

---

### Data model (per project)
`{ id, name, status: active|stalled|done|frozen, summary, next, repo, updatedAt }`
- `summary` = current state (free text, multiple lines OK)
- `next` = next step (free text, multiple lines OK)
- `updatedAt` is set automatically server-side on every write.

### Notes
- **Partial updates:** `POST /api/status` upserts by project name and merges — send only the fields you want to change.
- **KV is eventually consistent:** a write is instant in the same region but can take up to ~60s to show everywhere. Fine for one user.
- **Single token = single user (v1).** Going multi-user later means per-user tokens / data isolation — a separate step.
