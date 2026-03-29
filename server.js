const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 80);
const ROOT = __dirname;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const session = {
  state: null,
  accessToken: null,
  refreshToken: null,
  tokenType: "Bearer",
  expiresAt: null,
  accounts: [],
  lastSyncAt: null,
};

function hasRbcConfig() {
  return Boolean(
    process.env.RBC_CLIENT_ID &&
      process.env.RBC_CLIENT_SECRET &&
      process.env.RBC_AUTH_URL &&
      process.env.RBC_TOKEN_URL &&
      process.env.RBC_REDIRECT_URI
  );
}

function isConnected() {
  return Boolean(session.accessToken);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": CONTENT_TYPES[".json"] });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "Content-Type": CONTENT_TYPES[".html"] });
  res.end(html);
}

function readStaticFile(filePath) {
  const resolvedPath = path.resolve(ROOT, filePath);

  if (!resolvedPath.startsWith(ROOT)) {
    return null;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    return null;
  }

  return resolvedPath;
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = readStaticFile(`.${requestPath}`);

  if (!filePath) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function buildConnectUrl() {
  const state = crypto.randomUUID();
  session.state = state;

  const url = new URL(process.env.RBC_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.RBC_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.RBC_REDIRECT_URI);
  url.searchParams.set("scope", process.env.RBC_SCOPES || "accounts transactions");
  url.searchParams.set("state", state);

  return url.toString();
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.RBC_REDIRECT_URI,
    client_id: process.env.RBC_CLIENT_ID,
    client_secret: process.env.RBC_CLIENT_SECRET,
  });

  const response = await fetch(process.env.RBC_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Token exchange failed.");
  }

  session.accessToken = payload.access_token;
  session.refreshToken = payload.refresh_token || null;
  session.tokenType = payload.token_type || "Bearer";
  session.expiresAt = payload.expires_in
    ? Date.now() + Number(payload.expires_in) * 1000
    : null;
}

async function fetchRbcAccounts() {
  if (!process.env.RBC_ACCOUNTS_URL) {
    return [];
  }

  const response = await fetch(process.env.RBC_ACCOUNTS_URL, {
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Accounts sync failed.");
  }

  const accounts = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.accounts)
      ? payload.accounts
      : [];

  session.accounts = accounts.map((account) => ({
    id: account.id || account.accountId || account.number || null,
    name: account.name || account.nickname || account.productName || "Business account",
    type: account.type || account.accountType || account.category || "Business account",
    balance:
      account.balance?.current ||
      account.currentBalance ||
      account.ledgerBalance ||
      account.balance ||
      null,
    availableBalance: account.availableBalance || account.balance?.available || null,
    currency: account.currency || account.currencyCode || "CAD",
  }));
  session.lastSyncAt = new Date().toISOString();

  return session.accounts;
}

function getStatusPayload() {
  return {
    provider: "RBC",
    configured: hasRbcConfig(),
    connected: isConnected(),
    expiresAt: session.expiresAt,
    lastSyncAt: session.lastSyncAt,
    accounts: session.accounts,
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/rbc/status" && req.method === "GET") {
    sendJson(res, 200, getStatusPayload());
    return;
  }

  if (url.pathname === "/api/rbc/connect-url" && req.method === "GET") {
    if (!hasRbcConfig()) {
      sendJson(res, 400, {
        error: "RBC API is not configured. Set RBC_CLIENT_ID, RBC_CLIENT_SECRET, RBC_AUTH_URL, RBC_TOKEN_URL, and RBC_REDIRECT_URI.",
      });
      return;
    }

    sendJson(res, 200, { url: buildConnectUrl() });
    return;
  }

  if (url.pathname === "/api/rbc/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      sendHtml(
        res,
        400,
        `<h1>RBC connection failed</h1><p>${error}</p><p><a href="/">Return to Count123</a></p>`
      );
      return;
    }

    if (!code || !state || state !== session.state) {
      sendHtml(
        res,
        400,
        "<h1>Invalid RBC callback</h1><p>The OAuth state or authorization code was missing.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
      return;
    }

    try {
      await exchangeCodeForToken(code);
      await fetchRbcAccounts();
      sendHtml(
        res,
        200,
        "<h1>RBC connected</h1><p>Your business accounts have been synced into Count123.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
    } catch (callbackError) {
      sendHtml(
        res,
        502,
        `<h1>RBC sync failed</h1><p>${callbackError.message}</p><p><a href="/">Return to Count123</a></p>`
      );
    }

    return;
  }

  if (url.pathname === "/api/rbc/accounts" && req.method === "GET") {
    if (!isConnected()) {
      sendJson(res, 401, { error: "RBC is not connected." });
      return;
    }

    try {
      const accounts = await fetchRbcAccounts();
      sendJson(res, 200, { accounts, lastSyncAt: session.lastSyncAt });
    } catch (accountsError) {
      sendJson(res, 502, { error: accountsError.message });
    }

    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || "").startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Count123 listening on port ${PORT}`);
});
