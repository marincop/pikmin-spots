// 皮克敏純點地圖 — Apple 登入 ＋ 管理員審核閘門
// 零外部依賴（只用 node 內建），由 Coolify 以 Dockerfile.auth 部署。
//
// 流程：
//   1. 未登入 → 任何路徑都回登入頁（整站保護）
//   2. 前端用 Apple JS SDK 取得 identityToken → POST /api/auth/apple
//   3. 本服務驗證 JWT（Apple JWKS / RS256）→ 取得穩定的 sub
//   4. 查名單：approved → 發 session cookie ✓
//              pending  → 顯示「已送出申請，等待管理者批准」
//              denied   → 顯示「未通過」
//              新申請   → 記錄 + 通知管理員（Telegram，可選）
//   5. 管理頁 /admin（Basic Auth）→ 批准 / 拒絕
//
// 環境變數：
//   APPLE_SERVICE_ID    Sign in with Apple 的 Service ID（= JWT 的 aud）
//   SESSION_SECRET      cookie 簽章密鑰（隨機長字串）
//   ADMIN_PASSWORD      管理頁密碼
//   DATA_DIR            volume 路徑（預設 /data）
//   STATIC_ROOT         靜態檔根目錄（預設 /app/static）
//   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   新申請通知（可選）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const STATIC_ROOT = process.env.STATIC_ROOT || "/app/static";
const DATA_DIR = process.env.DATA_DIR || "/data";
const SERVICE_ID = process.env.APPLE_SERVICE_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString("hex");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";

// ── LINE Login（第二種登入來源）──
const LINE_ID = process.env.LINE_CHANNEL_ID || "";
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const LINE_AUTHZ = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE = "https://api.line.me/v2/profile";
const LINE_BTN = LINE_ID
  ? '<a href="/api/auth/line/start" style="display:inline-block;margin-top:10px;padding:10px 18px;border-radius:10px;background:#06C755;color:#fff;text-decoration:none;font-size:15px">用 LINE 登入</a>'
  : "";
const DB_FILE = path.join(DATA_DIR, "auth.json");

let db = { users: {}, sessions: {} }; // users[sub] = {sub,email,status,ts,note}
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { /* 首次啟動 */ }
const save = () => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); } catch (e) { console.error("save failed", e.message); } };

/* ---------- cookie 簽章 ---------- */
const b64u = (b) => Buffer.from(b).toString("base64url");
function signSession(sub) {
  const payload = `${sub}.${Date.now() + 30 * 864e5}`;             // 30 天
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${b64u(payload)}.${mac}`;
}
function readSession(cookie) {
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)pk=([^;]+)/);
  if (!m) return null;
  const [p, mac] = m[1].split(".");
  if (!p || !mac) return null;
  const payload = Buffer.from(p, "base64url").toString();
  const want = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (mac !== want) return null;
  // ⚠️ Apple 的 sub 本身含「.」（例：000043.xxx.0251）→ 不能用 split(".") 切
  // 用最後一個「.」切開，前面全部是 sub
  const dot = payload.lastIndexOf(".");
  if (dot < 0) return null;
  const sub = payload.slice(0, dot);
  const exp = payload.slice(dot + 1);
  if (Number(exp) < Date.now()) return null;
  return sub;
}

/* ---------- Apple identityToken 驗證 ---------- */
let jwksCache = { at: 0, keys: [] };
async function appleKeys() {
  if (Date.now() - jwksCache.at < 36e5 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch("https://appleid.apple.com/auth/keys");
  const j = await r.json();
  jwksCache = { at: Date.now(), keys: j.keys || [] };
  return jwksCache.keys;
}
async function verifyApple(idToken) {
  const [h, p, s] = String(idToken).split(".");
  if (!h || !p || !s) throw new Error("token 格式錯誤");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  const keys = await appleKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("找不到對應的 Apple 公鑰");
  const pem = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), pem, Buffer.from(s, "base64url"));
  if (!ok) throw new Error("簽章驗證失敗");
  if (payload.iss !== "https://appleid.apple.com") throw new Error("issuer 不符");
  if (SERVICE_ID && payload.aud !== SERVICE_ID) throw new Error(`aud 不符（收到 ${payload.aud}）`);
  if (Number(payload.exp) * 1000 < Date.now()) throw new Error("token 已過期");
  return { sub: payload.sub, email: payload.email || "" };
}

/* ---------- Telegram 通知 ---------- */
async function notifyNew(u) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const text = `🐜 pikmin 新申請\n${u.email || "(未提供 email)"}\nsub: ${u.sub}\n→ 前往管理頁批准：https://pikmin.marincop-ai.com/admin`;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text }),
    });
  } catch (e) { console.error("tg notify failed", e.message); }
}

/* ---------- 靜態檔 ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".png": "image/png" };
function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.join(STATIC_ROOT, rel);
  if (!file.startsWith(STATIC_ROOT)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404"); return; }
    const ext = path.extname(file).toLowerCase();
    const noCache = /(sw\.js|index\.html|app\.js)$/.test(file);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": noCache ? "no-store" : "public, max-age=300" }).end(buf);
  });
}

/* ---------- 頁面 ---------- */
const LOGIN_HTML = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>皮克敏純點地圖｜登入</title>
<style>body{margin:0;font:16px/1.6 -apple-system,system-ui,"PingFang TC",sans-serif;background:#0f1720;color:#e8eef5;display:grid;place-items:center;min-height:100vh}
.card{max-width:380px;padding:32px 28px;background:#161f2b;border:1px solid #24303f;border-radius:16px;text-align:center}
h1{font-size:20px;margin:0 0 6px}p{color:#9fb0c0;font-size:14px;margin:0 0 20px}
#msg{margin-top:14px;font-size:14px;min-height:22px}#msg.err{color:#ff9a9a}#msg.ok{color:#8ad6a0}
button{margin-top:8px}</style></head><body><div class="card">
<h1>🍀 皮克敏純點地圖</h1><p>本站需要 Apple 登入，並由管理者審核通過後才能使用。</p>
<div id="apple"></div>${LINE_BTN}<div id="msg"></div></div>
<script src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"></script>
<script>
const SERVICE_ID = ${JSON.stringify(SERVICE_ID)};
AppleID.auth.init({ clientId: SERVICE_ID, scope: 'name email', redirectURI: location.origin + '/api/auth/apple/callback', usePopup: true });
document.getElementById('apple').innerHTML = '<button id="signin" style="font-size:16px;padding:10px 18px;border-radius:10px;border:0;background:#fff;color:#111;cursor:pointer"> 用 Apple 登入</button>';
const msg = document.getElementById('msg');
document.getElementById('signin').onclick = async () => {
  msg.textContent = '登入中…'; msg.className = '';
  try {
    const r = await AppleID.auth.signIn();
    const t = r.authorization && r.authorization.id_token;
    if (!t) throw new Error('未取得身分憑證');
    const res = await fetch('/api/auth/apple', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: t, user: r.user || null }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) { location.reload(); return; }
    msg.className = 'err'; msg.textContent = j.message || j.error || '登入失敗';
  } catch (e) { msg.className = 'err'; msg.textContent = '登入失敗：' + (e && e.message || e); }
};
</script></body></html>`;

function adminHTML() {
  const rows = Object.values(db.users).sort((a, b) => b.ts - a.ts).map((u) => {
    const badge = u.status === "approved" ? "✅ 已批准" : u.status === "denied" ? "⛔ 已拒絕" : "⏳ 待批准";
    const btn = (do_, label, msg) => `<button name="do" value="${do_}"${msg ? ` onclick="return confirm('${msg}')"` : ""}>${label}</button>`;
    const btns = (u.status === "pending" || !u.status)
      ? btn("approve", "批准") + " " + btn("deny", "拒絕", "確定要拒絕嗎？") + " " + btn("delete", "🗑️ 刪除", "確定要刪除？他下次登入會重新申請。")
      : u.status === "approved"
        ? btn("deny", "改為拒絕", "確定要改為拒絕嗎？") + " " + btn("delete", "🗑️ 刪除", "確定要刪除嗎？")
        : btn("approve", "改為批准") + " " + btn("delete", "🗑️ 刪除", "確定要刪除嗎？");
    const act = `<form method="POST" action="/admin/act" style="display:inline"><input type="hidden" name="sub" value="${u.sub}">${btns}</form>`;
    const src = String(u.sub).startsWith("line:") ? "LINE" : "Apple";
    return `<tr><td>${badge}</td><td>${(u.email || u.name || "-")}</td><td style="font-size:12px;color:#8aa">${src}｜${u.sub}</td><td>${new Date(u.ts).toLocaleString("zh-TW")}</td><td>${act}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>pikmin 管理</title>
<style>body{font:15px/1.5 -apple-system,"PingFang TC",sans-serif;background:#0f1720;color:#e8eef5;padding:24px}
table{border-collapse:collapse;width:100%;max-width:1100px}th,td{border-bottom:1px solid #26313f;padding:8px;text-align:left}
button{padding:4px 10px;border-radius:8px;border:1px solid #35455a;background:#1d2836;color:#e8eef5;cursor:pointer}
.pend{color:#ffd479}</style></head><body><h2>🍀 皮克敏純點地圖 — 使用者審核</h2>
<p class="pend">待批准：${Object.values(db.users).filter((u) => (u.status || "pending") === "pending").length} 筆</p>
<table><tr><th>狀態</th><th>Email</th><th>sub</th><th>申請時間</th><th>操作</th></tr>${rows}</table>
<p style="color:#7d8ea0;font-size:13px">批准後，該使用者下次登入即可進入網站。</p></body></html>`;
}

const waitingHTML = (status) => {
  const denied = status === "denied";
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>皮克敏純點地圖</title>
<style>body{margin:0;font:16px/1.7 -apple-system,system-ui,"PingFang TC",sans-serif;background:#0f1720;color:#e8eef5;display:grid;place-items:center;min-height:100vh}
.card{max-width:400px;padding:32px 28px;background:#161f2b;border:1px solid #24303f;border-radius:16px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#9fb0c0;font-size:14.5px}
a.btn{display:inline-block;margin-top:16px;padding:9px 18px;border-radius:10px;background:#24303f;color:#e8eef5;text-decoration:none;font-size:14px}</style></head>
<body><div class="card"><h1>${denied ? "⛔ 未通過審核" : "⏳ 已送出申請，等待批准"}</h1>
<p>${denied ? "你的申請未通過，請聯絡管理者。" : "管理者批准後，按下面的按鈕重新整理就能進入地圖。"}</p>
<a class="btn" href="/">🔄 重新整理</a></div></body></html>`;
};

/* ---------- 使用者紀錄（兩種登入來源共用） ---------- */
function upsertUser(sub, email, name) {
  let u = db.users[sub];
  if (!u) {
    u = { sub, email: email || "", name: name || "", status: "pending", ts: Date.now() };
    db.users[sub] = u;
    save();
    notifyNew(u);
  } else if (email && !u.email) {
    u.email = email;
    if (name && !u.name) u.name = name;
    save();
  }
  return u;
}

/* ---------- LINE Login ---------- */
function lineStart(req, res) {
  if (!LINE_ID) { res.writeHead(302, { location: "/login?err=line_not_configured" }).end(); return; }
  const host = req.headers.host || "";
  const st = crypto.randomBytes(12).toString("hex");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(st).digest("base64url");
  const ri = `https://${host}/api/auth/line/callback`;
  const u = `${LINE_AUTHZ}?response_type=code&client_id=${encodeURIComponent(LINE_ID)}` +
            `&redirect_uri=${encodeURIComponent(ri)}&state=${st}&scope=${encodeURIComponent("profile openid")}`;
  res.writeHead(302, {
    "set-cookie": `pkst=${st}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    location: u,
  }).end();
}

async function lineCallback(req, res, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stc = (req.headers.cookie || "").match(/(?:^|;\s*)pkst=([^;]+)/);
  const [st, sig] = stc ? stc[1].split(".") : [];
  const okState = !!(st && state === st && sig === crypto.createHmac("sha256", SESSION_SECRET).update(st).digest("base64url"));
  if (!code || !okState) { res.writeHead(302, { location: "/login?err=state" }).end(); return; }
  const host = req.headers.host || "";
  const ri = `https://${host}/api/auth/line/callback`;
  try {
    const tr = await fetch(LINE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ri, client_id: LINE_ID, client_secret: LINE_SECRET }),
    });
    const tj = await tr.json();
    if (!tj.access_token) { console.error("LINE token failed:", JSON.stringify(tj).slice(0, 200)); res.writeHead(302, { location: "/login?err=line_token" }).end(); return; }
    const pr = await fetch(LINE_PROFILE, { headers: { authorization: "Bearer " + tj.access_token } });
    const pj = await pr.json();
    if (!pj.userId) { res.writeHead(302, { location: "/login?err=line_profile" }).end(); return; }
    const sub = "line:" + pj.userId;
    upsertUser(sub, "", pj.displayName || "");
    res.writeHead(302, {
      "set-cookie": `pk=${signSession(sub)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`,
      location: "/",
    }).end();
  } catch (e) {
    console.error("LINE callback error:", e.message);
    res.writeHead(302, { location: "/login?err=line" }).end();
  }
}

/* ---------- HTTP ---------- */
const server = http.createServer(async (req, res) => {
  console.log(new Date().toISOString(), req.method, req.url);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const cookie = req.headers.cookie || "";
  const sub = readSession(cookie);
  const user = sub ? db.users[sub] : null;
  const authed = !!(user && user.status === "approved");
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(obj)); };
  const body = () => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });

  /* 登入 / 登出 */
  if (p === "/login") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(LOGIN_HTML); return; }
  // Apple 的 return URL（popup 模式用不到，但 Service ID 必須登記這個網址）
  if (p === "/api/auth/apple/callback") { res.writeHead(302, { location: "/login" }).end(); return; }
  if (p === "/api/auth/logout") { res.writeHead(302, { "set-cookie": "pk=; Path=/; Max-Age=0", location: "/login" }).end(); return; }

  /* LINE 登入 */
  if (p === "/api/auth/line/start") { lineStart(req, res); return; }
  if (p === "/api/auth/line/callback") { await lineCallback(req, res, url); return; }

  if (p === "/api/auth/apple" && req.method === "POST") {
    try {
      const { idToken } = JSON.parse((await body()) || "{}");
      const id = await verifyApple(idToken);
      let u = db.users[id.sub];
      if (!u) { u = { sub: id.sub, email: id.email, status: "pending", ts: Date.now() }; db.users[id.sub] = u; save(); notifyNew(u); }
      else if (id.email && !u.email) { u.email = id.email; save(); }
      // 一律發通行證；能否放行由閘門依狀態判斷
      // （批准後只要重新整理即可進入，不用再登入一次）
      res.writeHead(200, {
        "set-cookie": `pk=${signSession(id.sub)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`,
        "content-type": "application/json; charset=utf-8",
      }).end(JSON.stringify({ ok: true, status: u.status }));
      return;
    } catch (e) { console.error("APPLE-VERIFY-FAILED:", e.message); return json(401, { error: "verify_failed", message: String(e.message || e) }); }
  }
  if (p === "/api/auth/me") return json(200, { authed, status: user ? user.status : null, email: user ? user.email : null });

  /* 管理頁（Basic Auth） */
  if (p === "/admin" || p.startsWith("/admin/")) {
    const auth = req.headers.authorization || "";
    const [scheme, enc] = auth.split(" ");
    const pass = scheme === "Basic" ? Buffer.from(enc || "", "base64").toString().split(":")[1] : "";
    if (!ADMIN_PASSWORD || pass !== ADMIN_PASSWORD) { res.writeHead(401, { "www-authenticate": 'Basic realm="pikmin-admin"' }).end("需要管理員密碼"); return; }
    if (p === "/admin/act" && req.method === "POST") {
      const q = new URLSearchParams(await body());
      const s = q.get("sub"), act = q.get("do");
      if (db.users[s]) {
        if (act === "delete") { delete db.users[s]; }
        else { db.users[s].status = act === "approve" ? "approved" : "denied"; db.users[s].ts = Date.now(); }
        save();
      }
      res.writeHead(302, { location: "/admin" }).end(); return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(adminHTML()); return;
  }

  /* 整站保護：未登入 → 登入頁；已登入但未批准 → 狀態頁；已批准 → 應用本體 */
  if (!user) { res.writeHead(302, { location: "/login" }).end(); return; }
  if (user.status !== "approved") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(waitingHTML(user.status));
    return;
  }
  serveStatic(res, p);
});

server.listen(PORT, () => console.log(`pikmin auth server on :${PORT}（static=${STATIC_ROOT}, data=${DATA_DIR}, serviceId=${SERVICE_ID || "(未設定)"}）`));
