const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

const app = express();

// ★ 追記: リバースプロキシ(NGINX Ingress/Cloudflare)からの X-Forwarded-Proto ヘッダーを信頼する
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.static("public"));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" },
  })
);

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  ADMIN_DISCORD_IDS = "",
  PUBLIC_URL = "https://console.reeldev.jp",
} = process.env;

const adminIds = new Set(
  ADMIN_DISCORD_IDS.split(",").map((s) => s.trim()).filter(Boolean)
);
const REDIRECT_URI = `${PUBLIC_URL}/api/auth/callback/discord`;

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --- Discord OAuth ---
app.get("/api/auth/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/api/auth/callback/discord", async (req, res) => {
  const { code, state } = req.query;
  if (!code || state !== req.session.oauthState) {
    return res.status(400).send("invalid oauth state");
  }
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) return res.status(401).send("discord auth failed");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const user = await userRes.json();

    req.session.user = { id: user.id, username: user.username };
    req.session.isAdmin = adminIds.has(user.id);
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("oauth error");
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null, isAdmin: !!req.session.isAdmin });
});

// Discordログイン済み、かつ管理人IDリストに含まれるユーザーのみ通す
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "login required" });
  if (!req.session.isAdmin) return res.status(403).json({ error: "not an admin" });
  next();
}

// --- お知らせ・リンク管理(TODO: 永続化はDB/ファイルに置き換える) ---
let announcements = [];
let links = [];

app.get("/api/announcements", (_req, res) => res.json(announcements));
app.post("/api/announcements", requireAdmin, (req, res) => {
  const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...req.body };
  announcements.unshift(item);
  res.status(201).json(item);
});
app.delete("/api/announcements/:id", requireAdmin, (req, res) => {
  announcements = announcements.filter((a) => a.id !== req.params.id);
  res.json({ ok: true });
});

app.get("/api/links", (_req, res) => res.json(links));
app.post("/api/links", requireAdmin, (req, res) => {
  const item = { id: crypto.randomUUID(), ...req.body };
  links.push(item);
  res.status(201).json(item);
});
app.delete("/api/links/:id", requireAdmin, (req, res) => {
  links = links.filter((l) => l.id !== req.params.id);
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`console listening on :${port}`));
