const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

const app = express();
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

// --- OIDCクライアント管理 ---
// Vaultのsecret/data/oidc/serverにclients_json(配列)として保存し、
// oidc-server側のVault Agentがconfig.yamlとして自動レンダリングする。
// レンダリング後にoidc-serverを再起動させることで変更を反映する。
const fs = require("fs");
const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault.mgmt-vault.svc:8200";
const VAULT_SECRET_PATH = "secret/data/oidc/server";

function readVaultToken() {
  return fs.readFileSync("/vault/secrets/token", "utf8").trim();
}

async function vaultReadSecret() {
  const res = await fetch(`${VAULT_ADDR}/v1/${VAULT_SECRET_PATH}`, {
    headers: { "X-Vault-Token": readVaultToken() },
  });
  if (!res.ok) throw new Error(`vault read failed: ${res.status}`);
  const body = await res.json();
  return body.data.data || {};
}

async function vaultWriteSecret(mergedData) {
  const res = await fetch(`${VAULT_ADDR}/v1/${VAULT_SECRET_PATH}`, {
    method: "POST",
    headers: {
      "X-Vault-Token": readVaultToken(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: mergedData }),
  });
  if (!res.ok) throw new Error(`vault write failed: ${res.status}`);
}

async function getClients() {
  const data = await vaultReadSecret();
  try {
    return JSON.parse(data.clients_json || "[]");
  } catch {
    return [];
  }
}

async function saveClients(clients) {
  const current = await vaultReadSecret();
  await vaultWriteSecret({ ...current, clients_json: JSON.stringify(clients) });
}

// k8sの in-cluster API を使って oidc-server Deployment をローリング再起動する
async function restartOidcServer() {
  const token = fs.readFileSync(
    "/var/run/secrets/kubernetes.io/serviceaccount/token",
    "utf8"
  );
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || "443";
  const url = `https://${host}:${port}/apis/apps/v1/namespaces/oidc/deployments/oidc-server`;
  const patch = {
    spec: {
      template: {
        metadata: {
          annotations: { "reeldev.jp/restartedAt": new Date().toISOString() },
        },
      },
    },
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/strategic-merge-patch+json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`k8s restart failed: ${res.status} ${await res.text()}`);
}

app.get("/api/oidc/clients", requireAdmin, async (_req, res) => {
  try {
    res.json(await getClients());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to read clients" });
  }
});

app.post("/api/oidc/clients", requireAdmin, async (req, res) => {
  try {
    const { name, redirectURIs } = req.body;
    if (!name || !Array.isArray(redirectURIs) || redirectURIs.length === 0) {
      return res.status(400).json({ error: "name and redirectURIs are required" });
    }
    const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    const secret = crypto.randomBytes(32).toString("hex");
    const clients = await getClients();
    if (clients.some((c) => c.id === id)) {
      return res.status(409).json({ error: `client id "${id}" already exists` });
    }
    const client = { id, name, secret, redirectURIs };
    clients.push(client);
    await saveClients(clients);
    await restartOidcServer();
    res.status(201).json(client); // secretはこの1回しか平文で返さない
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to create client" });
  }
});

app.delete("/api/oidc/clients/:id", requireAdmin, async (req, res) => {
  try {
    const clients = (await getClients()).filter((c) => c.id !== req.params.id);
    await saveClients(clients);
    await restartOidcServer();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to delete client" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`console listening on :${port}`));
