
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const FACEBOOK_URL = process.env.FACEBOOK_URL || "https://www.facebook.com/share/1JHonUUaCA/?mibextid=wwXIfr";
const ZALO_URL = process.env.ZALO_URL || "https://zalo.me/0818249250";
const TIKTOK_URL = process.env.TIKTOK_URL || "https://www.tiktok.com/@huyftsupport?_r=1&_t=ZS-94olc9q74ba";
const ZALO_ICON_URL = process.env.ZALO_ICON_URL || "https://upload.wikimedia.org/wikipedia/commons/9/91/Icon_of_Zalo.svg";

const STORE_PATH = path.join(__dirname, "keys.json");
const LOGO_PATH = path.join(__dirname, "public", "logo.png");
const rateMap = new Map();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || "keys.json";

let keys = {};
let storeReady = false;

function loadLocalStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveLocalStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(keys, null, 2), "utf8");
}
function hasGithubStore() {
  return Boolean(GITHUB_TOKEN && GITHUB_REPO && GITHUB_DATA_PATH);
}
function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.github.com",
      path: apiPath,
      method,
      headers: {
        "User-Agent": "aimtrickhead-panel",
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        let parsed = {};
        try { parsed = JSON.parse(data || "{}"); } catch { parsed = {}; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const err = new Error(parsed.message || `GitHub ${res.statusCode}`);
        err.statusCode = res.statusCode;
        reject(err);
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
async function readGithubStore() {
  const [owner, repo] = GITHUB_REPO.split("/");
  const apiPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${GITHUB_DATA_PATH.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  try {
    const file = await githubRequest("GET", apiPath);
    const content = Buffer.from(file.content || "", "base64").toString("utf8");
    const parsed = JSON.parse(content || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err.statusCode === 404) {
      await writeGithubStore({});
      return {};
    }
    throw err;
  }
}
async function writeGithubStore(store) {
  const [owner, repo] = GITHUB_REPO.split("/");
  const apiPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${GITHUB_DATA_PATH.split("/").map(encodeURIComponent).join("/")}`;
  let sha;
  try {
    const existing = await githubRequest("GET", `${apiPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
    sha = existing.sha;
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
  const body = {
    message: "Update keys store",
    content: Buffer.from(JSON.stringify(store, null, 2), "utf8").toString("base64"),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  await githubRequest("PUT", apiPath, body);
}
function normalizeKeyItem(item) {
  if (!item || typeof item !== "object") return null;
  if (!Array.isArray(item.devices)) item.devices = [];
  if (item.device && !item.devices.includes(item.device)) item.devices.push(item.device);
  if (typeof item.usesLeft !== "number") {
    if (typeof item.uses === "number") item.usesLeft = Number(item.uses || 0);
    else item.usesLeft = 0;
  }
  if (typeof item.totalDevices !== "number") {
    item.totalDevices = Math.max(item.devices.length, item.devices.length + Number(item.usesLeft || 0));
  }
  item.usesLeft = Math.max(0, Number(item.usesLeft || 0));
  item.totalDevices = Math.max(item.devices.length, Number(item.totalDevices || 0));
  item.expireAt = Number(item.expireAt || 0);
  item.createdAt = Number(item.createdAt || Date.now());
  delete item.device;
  delete item.uses;
  return item;
}
function normalizeAllStore(store) {
  const out = {};
  Object.keys(store || {}).forEach(k => {
    const normalized = normalizeKeyItem(store[k]);
    if (normalized) out[k] = normalized;
  });
  return out;
}
async function initStore() {
  try {
    if (hasGithubStore()) {
      keys = normalizeAllStore(await readGithubStore());
      await writeGithubStore(keys);
      console.log("Store ready: GitHub");
    } else {
      keys = normalizeAllStore(loadLocalStore());
      saveLocalStore();
      console.log("Store ready: local file");
    }
  } catch (err) {
    console.error("Store init failed, fallback local:", err.message);
    keys = normalizeAllStore(loadLocalStore());
    saveLocalStore();
  }
  storeReady = true;
}
async function saveStore() {
  keys = normalizeAllStore(keys);
  try {
    if (hasGithubStore()) await writeGithubStore(keys); else saveLocalStore();
  } catch (err) {
    console.error("Save store failed:", err.message);
    saveLocalStore();
  }
}

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use((req, res, next) => {
  if (!storeReady && !req.path.startsWith("/healthz")) return res.status(503).json({ ok:false, msg:"Store đang khởi động" });
  next();
});
app.use((req, res, next) => {
  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const arr = (rateMap.get(ip) || []).filter(t => now - t < 15000);
  arr.push(now);
  rateMap.set(ip, arr);
  if (arr.length > 90) return res.status(429).json({ ok:false, msg:"Thao tác quá nhanh" });
  next();
});
function isAdmin(req) {
  if (!ADMIN_KEY) return false;
  const adminKey = String(req.headers["x-admin-key"] || "").trim();
  return adminKey === ADMIN_KEY;
}
function genKey() {
  const a = Math.random().toString(36).slice(2,6).toUpperCase();
  const b = Math.random().toString(36).slice(2,6).toUpperCase();
  return `ATH-${a}-${b}`;
}
function formatVNTime(ms) {
  if (!ms) return "Vĩnh viễn";
  return new Date(ms).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}
function signText(text) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(text).digest("hex");
}
function createSessionToken(key, device, expireAt) {
  const issuedAt = Date.now();
  const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
  return Buffer.from(`${payload}|${signText(payload)}`, "utf8").toString("base64url");
}
function verifySessionToken(token) {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parts = raw.split("|");
    if (parts.length !== 5) return null;
    const [key, device, expireAt, issuedAt, sig] = parts;
    const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
    if (sig !== signText(payload)) return null;
    return { key, device, expireAt:Number(expireAt), issuedAt:Number(issuedAt) };
  } catch { return null; }
}
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}
function renderLogo(size=74, radius=22) {
  if (fs.existsSync(LOGO_PATH)) return `<img src="/logo.png" alt="Logo" style="width:${size}px;height:${size}px;object-fit:cover;display:block;border-radius:${radius}px">`;
  return `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#8c52ff,#ff70c7);font-size:${Math.round(size*0.42)}px;color:#fff">✦</div>`;
}
function iconZalo() {
  return `<img src="${ZALO_ICON_URL}" alt="Zalo" style="width:20px;height:20px;display:block;border-radius:6px">`;
}
function iconFacebook() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.023 4.388 11.015 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.017 1.792-4.684 4.533-4.684 1.313 0 2.686.235 2.686.235v2.963H15.83c-1.49 0-1.955.931-1.955 1.886v2.263h3.328l-.532 3.49h-2.796V24C19.612 23.088 24 18.096 24 12.073Z"/><path fill="#fff" d="M16.671 15.563l.532-3.49h-3.328V9.81c0-.955.465-1.886 1.955-1.886h1.514V4.96s-1.373-.235-2.686-.235c-2.741 0-4.533 1.667-4.533 4.684v2.664H7.078v3.49h3.047V24h3.75v-8.437h2.796Z"/></svg>`;
}
function pageShell(title, body, extraHead="") {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><title>${esc(title)}</title>${extraHead}<style>${baseStyles()}</style></head><body><div class="bgAura"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>${body}</body></html>`;
}
function baseStyles() {
  return `
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;font-family:Alata,Arial,sans-serif}
html{-webkit-text-size-adjust:100%;touch-action:manipulation}
body{margin:0;min-height:100vh;color:#fff;overflow-x:hidden;background:
radial-gradient(circle at 12% 18%, rgba(110,92,210,.16), transparent 24%),
radial-gradient(circle at 85% 18%, rgba(80,145,255,.10), transparent 24%),
radial-gradient(circle at 50% 100%, rgba(120,90,210,.12), transparent 30%),
linear-gradient(160deg,#05060b,#0b0f17,#090b12)}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.10;background:linear-gradient(transparent,rgba(255,255,255,.02),transparent);background-size:100% 5px;animation:scan 10s linear infinite}
body:after{content:"";position:fixed;inset:-15%;pointer-events:none;opacity:.12;background:radial-gradient(circle at 20% 20%, rgba(255,255,255,.05) 1px, transparent 1.5px),radial-gradient(circle at 80% 70%, rgba(255,255,255,.04) 1px, transparent 1.6px);background-size:22px 22px,28px 28px;animation:moveDots 22s linear infinite}
@keyframes scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
@keyframes moveDots{from{transform:translateY(0)}to{transform:translateY(80px)}}
@keyframes floatOrb{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(18px,-24px,0)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulseGlow{0%,100%{box-shadow:0 0 0 rgba(0,0,0,0),0 0 26px rgba(95,120,255,.06)}50%{box-shadow:0 0 0 rgba(0,0,0,0),0 0 40px rgba(95,120,255,.12)}}
@keyframes overlayIn{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:scale(1)}}
@keyframes popIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.bgAura{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.orb{position:absolute;border-radius:50%;filter:blur(30px);opacity:.18;animation:floatOrb 16s ease-in-out infinite}
.orb.o1{width:220px;height:220px;left:-50px;top:12%;background:rgba(88,108,235,.30)}
.orb.o2{width:260px;height:260px;right:-70px;top:34%;background:rgba(98,162,255,.16);animation-delay:-6s}
.orb.o3{width:240px;height:240px;left:30%;bottom:-90px;background:rgba(136,96,255,.18);animation-delay:-10s}
.wrap{position:relative;z-index:1;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px}
.card{width:min(94vw,560px);max-height:calc(100vh - 34px);overflow:auto;border-radius:28px;background:rgba(12,16,24,.80);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(16px);box-shadow:0 12px 45px rgba(0,0,0,.28),0 0 26px rgba(95,120,255,.07);animation:pulseGlow 5s infinite}
.card::-webkit-scrollbar{width:0;height:0}
.top{padding:22px 18px 16px;border-bottom:1px solid rgba(255,255,255,.08);position:relative;overflow:hidden}
.top:after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,rgba(110,132,255,.92),rgba(148,167,255,.88),transparent)}
.brand{display:flex;align-items:center;gap:14px}
.logoBox{width:74px;height:74px;border-radius:22px;overflow:hidden;flex:0 0 74px;background:rgba(255,255,255,.04)}
.title{margin:0;font-size:clamp(22px,5vw,30px);color:#eef2ff}
.sub{margin:6px 0 0;color:#b8c1d8;font-size:13px}
.credit{margin-top:10px;color:#8eb3ff;font-size:12px;font-weight:700;letter-spacing:.6px}
.content{padding:16px}

.authScreen{position:relative;z-index:1;min-height:100vh;padding:28px 18px;display:flex;align-items:center;justify-content:center}
.authShell{width:min(100%,960px);display:grid;grid-template-columns:1.15fr .85fr;gap:24px;align-items:stretch}
.authHero{padding:28px;min-height:70vh;border-radius:34px;background:linear-gradient(180deg,rgba(18,23,34,.70),rgba(9,12,18,.48));border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px);position:relative;overflow:hidden;animation:popIn .35s ease}
.authHero:before{content:"";position:absolute;inset:auto -10% -30% auto;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(110,132,255,.28),transparent 65%)}
.authHero:after{content:"";position:absolute;left:-8%;top:-10%;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(144,104,255,.20),transparent 65%)}
.authContent{position:relative;z-index:1;display:flex;flex-direction:column;justify-content:space-between;min-height:100%}
.authTop{max-width:560px}
.authBadge{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);font-size:13px;color:#e7efff}
.authBigTitle{margin:18px 0 10px;font-size:clamp(34px,7vw,62px);line-height:1.02;letter-spacing:.2px}
.authBigTitle .muted{display:block;color:#9ea8c4;font-size:.48em;font-weight:400;margin-top:10px}
.authDesc{margin:0;max-width:620px;color:#bec7db;line-height:1.72;font-size:15px}
.authFeatureRow{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
.featureGlass{padding:14px 14px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
.featureGlass b{display:block;font-size:15px;margin-bottom:6px}
.featureGlass span{color:#b6bfd7;font-size:12px;line-height:1.5}
.loginPanel{padding:22px;border-radius:30px;background:rgba(11,14,22,.84);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(16px);box-shadow:0 10px 34px rgba(0,0,0,.28);display:flex;flex-direction:column;justify-content:center;animation:popIn .4s ease}
.loginPanel .brand{margin-bottom:12px}
.loginTitle{margin:12px 0 8px;font-size:28px}
.loginHint{margin:0;color:#bcc4da;font-size:13px;line-height:1.6}
.loginHero{padding:18px;border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.07);animation:fadeUp .35s ease}
.input,.btn,.smallBtn,.socialBtn,.tabBtn,.simpleBtn{border:none;outline:none}
.input{width:100%;height:56px;padding:0 16px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);color:#fff;font-size:15px;margin-top:12px}
.input::placeholder{color:#8f97ab}
.btn,.smallBtn,.simpleBtn,.socialBtn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:56px;padding:0 18px;border-radius:16px;cursor:pointer;transition:.22s ease;color:#fff;text-decoration:none;font-size:15px}
.btn{width:100%;margin-top:12px;background:linear-gradient(135deg,#4d7cff,#7ba6ff)}
.smallBtn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.09)}
.simpleBtn{background:linear-gradient(135deg,#175cff,#4896ff)}
.socialBtn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09)}
.btn:hover,.smallBtn:hover,.simpleBtn:hover,.socialBtn:hover,.tabBtn:hover{transform:translateY(-1px)}
.actionRow,.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.msg{min-height:22px;margin-top:12px;text-align:center;font-size:14px}
.ok{color:#9dffcf}.err{color:#ff96b7}.hidden{display:none !important}
.topLine{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.pill{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);font-size:12px;color:#f0e6ff}
.noticeBox,.contactCard,.tile,.quietNote{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);border-radius:18px}
.noticeBox{padding:13px 14px}
.contactCard{margin-top:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.contactMeta{display:flex;align-items:center;gap:12px}
.contactIcon{width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center}
.contactText .big,.name{margin:0;font-size:15px}
.contactText .small,.desc,.footer,.quietNote{margin:5px 0 0;color:#c5bdd4;font-size:12px;line-height:1.55}
.tabs{display:flex;gap:8px;margin:16px 0 12px;overflow:auto;padding-bottom:2px}.tabs::-webkit-scrollbar{display:none}
.tabBtn{height:44px;padding:0 14px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#dcd4eb;white-space:nowrap;flex:0 0 auto}
.tabBtn.active{background:linear-gradient(135deg,#4d7cff,#7ba6ff);color:#fff;border-color:transparent}
.tabPane{display:none;animation:fadeUp .25s ease}.tabPane.active{display:block}
.tile{padding:14px;margin-top:10px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.switch{position:relative;width:58px;height:32px;flex:0 0 58px}.switch input{display:none}
.slider{position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.10);transition:.25s;cursor:pointer}
.slider:before{content:"";position:absolute;width:24px;height:24px;left:4px;top:3px;border-radius:50%;background:#fff;transition:.25s}
.switch input:checked + .slider{background:linear-gradient(135deg,#4d7cff,#7ba6ff)}.switch input:checked + .slider:before{transform:translateX(26px)}
.sliderWrap{margin-top:10px}.rangeLabel{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:12px;color:#d8d2e7}
input[type=range]{width:100%;appearance:none;height:6px;border-radius:999px;background:rgba(255,255,255,.12);outline:none}
input[type=range]::-webkit-slider-thumb{appearance:none;width:20px;height:20px;border-radius:50%;background:#fff;border:none;box-shadow:0 0 0 4px rgba(255,255,255,.08)}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(120px);padding:12px 16px;border-radius:14px;background:rgba(11,8,18,.92);border:1px solid rgba(255,255,255,.08);color:#fff;z-index:60;transition:.26s}
.toast.show{transform:translateX(-50%) translateY(0)}
.fxOverlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at center, rgba(73,124,255,.28), rgba(3,5,10,.94) 62%);opacity:0;pointer-events:none;transition:.28s;z-index:55}
.fxOverlay.show{opacity:1}
.fxCard{width:min(90vw,540px);padding:32px 26px;border-radius:28px;border:1px solid rgba(255,255,255,.12);background:rgba(12,18,30,.80);backdrop-filter:blur(14px);text-align:center;animation:overlayIn .22s ease}
.fxTitle{margin:0;font-size:38px;letter-spacing:1.4px}
.fxSub{margin:12px 0 0;color:#d6e0ff}
.fxGlow{width:120px;height:120px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle, rgba(255,255,255,.98), rgba(106,146,255,.24) 40%, transparent 70%)}
.liveFx{margin-top:14px;border-radius:18px;border:1px solid rgba(255,255,255,.08);padding:14px;background:#070b12;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#9dd1ff;font-size:12px;min-height:94px;white-space:pre-line;line-height:1.55}
.listWrap{display:grid;gap:10px}.listItem{padding:13px 14px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}.listItem .k{font-weight:700}
.footer{margin-top:12px;text-align:center}.homeActions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:12px}
@media (max-width:860px){.authShell{grid-template-columns:1fr}.authHero{min-height:auto}.authFeatureRow{grid-template-columns:1fr}.loginPanel{padding:18px}}
@media (max-width:560px){.actionRow,.grid2{grid-template-columns:1fr}.contactCard,.row{display:block}.contactMeta{margin-bottom:12px}.topLine{align-items:flex-start;flex-direction:column}.card{width:min(96vw,560px)}.authScreen{padding:16px}.authHero,.loginPanel{border-radius:24px}.authBigTitle{font-size:32px}}
`;
}

function loadTemplate(name) {
  return fs.readFileSync(path.join(__dirname, 'templates', name), 'utf8');
}
function commonScriptVars() {
  return `<script>const FACEBOOK_URL=${JSON.stringify(FACEBOOK_URL)};const ZALO_URL=${JSON.stringify(ZALO_URL)};const TIKTOK_URL=${JSON.stringify(TIKTOK_URL)};</script>`;
}
function renderHomeHtml() {
  const body = loadTemplate('home.html')
    .replaceAll('{{LOGO}}', renderLogo(74,22));
  return pageShell('AimTrickHead', body + commonScriptVars());
}
function renderPanelHtml() {
  const body = loadTemplate('panel.html')
    .replaceAll('{{LOGO}}', renderLogo(74,22))
    .replaceAll('{{ZALO_ICON}}', iconZalo())
    .replaceAll('{{FACEBOOK_ICON}}', iconFacebook())
    .replaceAll('{{FACEBOOK_URL}}', esc(FACEBOOK_URL))
    .replaceAll('{{TIKTOK_URL}}', esc(TIKTOK_URL));
  return pageShell('AimTrickHead VIP', body + commonScriptVars());
}
function renderAdminHtml() {
  const body = loadTemplate('admin.html').replaceAll('{{LOGO}}', renderLogo(74,22));
  return pageShell('Admin', body + commonScriptVars());
}

app.get('/healthz', (req,res) => res.json({ok:true, mode: hasGithubStore() ? 'github' : 'local'}));
app.get('/', (req,res) => res.type('html').send(renderHomeHtml()));
app.get('/panel', (req,res) => res.type('html').send(renderPanelHtml()));
app.get('/huytan', (req,res) => res.type('html').send(renderAdminHtml()));

app.post('/api/create', async (req,res) => {
  if (!isAdmin(req)) return res.status(401).json({ok:false, msg:'Sai admin key'});
  const customKey = String(req.body.key || '').trim();
  const key = customKey || genKey();
  const uses = Math.max(1, Number(req.body.uses || 1));
  const days = Math.max(0, Number(req.body.days || 0));
  const now = Date.now();
  const expireAt = days > 0 ? now + days * 86400000 : 0;
  if (keys[key]) return res.status(400).json({ok:false, msg:'Key đã tồn tại'});
  keys[key] = { devices: [], usesLeft: uses, totalDevices: uses, expireAt, createdAt: now };
  await saveStore();
  return res.json({ok:true, key, expireText: formatVNTime(expireAt), usesLeft: keys[key].usesLeft, totalDevices: keys[key].totalDevices});
});
app.post('/api/check', async (req,res) => {
  const key = String(req.body.key || '').trim();
  const device = String(req.body.device || '').trim();
  if (!key || !device) return res.status(400).json({ok:false, msg:'Thiếu key hoặc thiết bị'});
  const item = normalizeKeyItem(keys[key]);
  if (!item) return res.status(404).json({ok:false, msg:'Key không tồn tại'});
  if (item.expireAt && Date.now() > item.expireAt) return res.status(403).json({ok:false, msg:'Key đã hết hạn'});
  let changed = false;
  if (!item.devices.includes(device)) {
    if (item.usesLeft <= 0) return res.status(403).json({ok:false, msg:'Key đã hết lượt thiết bị'});
    item.devices.push(device);
    item.usesLeft -= 1;
    changed = true;
  }
  keys[key] = item;
  if (changed) await saveStore();
  return res.json({ok:true, token:createSessionToken(key, device, item.expireAt), usesLeft:item.usesLeft, totalDevices:item.totalDevices, expireText:formatVNTime(item.expireAt)});
});
app.post('/api/status', async (req,res) => {
  const token = String(req.body.token || '').trim();
  const device = String(req.body.device || '').trim();
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ok:false, msg:'Token không hợp lệ'});
  if (device && session.device !== device) return res.status(403).json({ok:false, msg:'Sai thiết bị'});
  const item = normalizeKeyItem(keys[session.key]);
  if (!item) return res.status(404).json({ok:false, msg:'Key không tồn tại'});
  if (!item.devices.includes(session.device)) return res.status(403).json({ok:false, msg:'Thiết bị chưa được cấp quyền'});
  if (item.expireAt && Date.now() > item.expireAt) return res.status(403).json({ok:false, msg:'Key đã hết hạn'});
  keys[session.key] = item;
  return res.json({ok:true, usesLeft:item.usesLeft, totalDevices:item.totalDevices, expireText:formatVNTime(item.expireAt)});
});
app.get('/api/list', async (req,res) => {
  if (!isAdmin(req)) return res.status(401).json({ok:false, msg:'Sai admin key'});
  const out = Object.keys(keys).sort().map((key) => {
    const item = normalizeKeyItem(keys[key]);
    return { key, usesLeft:item.usesLeft, totalDevices:item.totalDevices, devices:item.devices, expireText:formatVNTime(item.expireAt), createdText:formatVNTime(item.createdAt) };
  });
  return res.json({ok:true, items:out});
});
app.post('/api/delete', async (req,res) => {
  if (!isAdmin(req)) return res.status(401).json({ok:false, msg:'Sai admin key'});
  const key = String(req.body.key || '').trim();
  if (!key || !keys[key]) return res.status(404).json({ok:false, msg:'Không tìm thấy key'});
  delete keys[key];
  await saveStore();
  return res.json({ok:true});
});

initStore().then(() => {
  if (!ADMIN_KEY) console.warn("ADMIN_PASSWORD chưa được cấu hình qua ENV.");
  if (!process.env.SESSION_SECRET) console.warn("SESSION_SECRET chưa được cấu hình qua ENV, đang dùng secret tạm thời.");
  app.listen(PORT, () => console.log(`AimTrickHead listening on ${PORT}`));
});
