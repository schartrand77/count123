const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 80);
const ROOT = __dirname;
const SESSION_COOKIE_NAME = "count123_sid";
const SESSION_TTL_MS = 60 * 60 * 1000;
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true";
const ALLOW_INSECURE_BANK_URLS = process.env.ALLOW_INSECURE_BANK_URLS === "true";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

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

const sessions = new Map();
const loginAttempts = new Map();

function now() {
  return Date.now();
}

function pruneLoginAttempts() {
  const cutoff = now() - LOGIN_WINDOW_MS;

  for (const [key, attempt] of loginAttempts.entries()) {
    if (attempt.windowStartedAt < cutoff) {
      loginAttempts.delete(key);
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCookies(req) {
  const header = req.headers.cookie;

  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");

    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join("=") || "");
    return cookies;
  }, {});
}

function sign(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

function buildSessionCookie(sessionId, req) {
  const isSecure = isSecureRequest(req);
  const signedValue = `${sessionId}.${sign(sessionId)}`;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];

  if (isSecure || FORCE_HTTPS) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildExpiredCookie(req) {
  const isSecure = isSecureRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isSecure || FORCE_HTTPS) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createSession() {
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    createdAt: now(),
    updatedAt: now(),
    adminAuthenticated: false,
    adminUsername: null,
    adminEmail: null,
    oauthState: null,
    codeVerifier: null,
    accessToken: null,
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    accounts: [],
    lastSyncAt: null,
  };

  sessions.set(sessionId, session);
  return session;
}

function getSessionFromRequest(req) {
  const cookieValue = parseCookies(req)[SESSION_COOKIE_NAME];

  if (!cookieValue) {
    return null;
  }

  const [sessionId, signature] = cookieValue.split(".");

  if (!sessionId || !signature || sign(sessionId) !== signature) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  if (now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }

  session.updatedAt = now();
  return session;
}

function ensureSession(req, res) {
  const existing = getSessionFromRequest(req);

  if (existing) {
    res.setHeader("Set-Cookie", buildSessionCookie(existing.id, req));
    return existing;
  }

  const session = createSession();
  res.setHeader("Set-Cookie", buildSessionCookie(session.id, req));
  return session;
}

function clearSession(req, res) {
  const existing = getSessionFromRequest(req);

  if (existing) {
    sessions.delete(existing.id);
  }

  res.setHeader("Set-Cookie", buildExpiredCookie(req));
}

function cleanupSessions() {
  const cutoff = now() - SESSION_TTL_MS;

  for (const [id, session] of sessions.entries()) {
    if (session.updatedAt < cutoff) {
      sessions.delete(id);
    }
  }
}

function getClientAddress(req) {
  if (TRUST_PROXY) {
    const forwardedFor = req.headers["x-forwarded-for"];

    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0].trim();
    }
  }

  return req.socket.remoteAddress || "unknown";
}

function isSecureRequest(req) {
  if (TRUST_PROXY) {
    const forwardedProto = req.headers["x-forwarded-proto"];

    if (typeof forwardedProto === "string") {
      return forwardedProto.split(",")[0].trim() === "https";
    }
  }

  return Boolean(req.socket.encrypted);
}

function getRequestOrigin(req) {
  const protocol = isSecureRequest(req) ? "https" : "http";
  return `${protocol}://${req.headers.host}`;
}

function assertHttpsForSensitiveRoutes(req) {
  if (FORCE_HTTPS && !isSecureRequest(req)) {
    throw new Error("HTTPS is required for this route.");
  }
}

function validateUrlEnv(name, allowHttp = false) {
  const value = process.env[name];

  if (!value) {
    return null;
  }

  const parsed = new URL(value);

  if (!allowHttp && parsed.protocol !== "https:" && !ALLOW_INSECURE_BANK_URLS) {
    throw new Error(`${name} must use HTTPS.`);
  }

  return parsed.toString();
}

function getAdminConfig() {
  return {
    email: process.env.ADMIN_EMAIL || "",
    username: process.env.ADMIN_USERNAME || "",
    passwordHash: process.env.ADMIN_PASSWORD_HASH || "",
  };
}

function hasAdminConfig() {
  const config = getAdminConfig();
  return Boolean(config.email && config.username && config.passwordHash);
}

function parsePasswordHash(serialized) {
  const parts = serialized.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("ADMIN_PASSWORD_HASH must use scrypt format.");
  }

  return {
    algorithm: parts[0],
    n: Number(parts[1]),
    r: Number(parts[2]),
    p: Number(parts[3]),
    salt: parts[4],
    hash: parts[5],
  };
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, serializedHash) {
  const parsed = parsePasswordHash(serializedHash);
  const derivedKey = crypto.scryptSync(password, parsed.salt, 64, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
  });
  const expectedKey = Buffer.from(parsed.hash, "base64url");

  if (derivedKey.length !== expectedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedKey);
}

function validateRequestOrigin(req) {
  const origin = req.headers.origin;

  if (!origin) {
    return true;
  }

  return origin === getRequestOrigin(req);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > 16 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error("Expected application/json.");
  }

  const body = await readRequestBody(req);

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function getLoginAttemptState(req) {
  pruneLoginAttempts();
  const key = getClientAddress(req);
  const existing = loginAttempts.get(key);

  if (!existing || now() - existing.windowStartedAt > LOGIN_WINDOW_MS) {
    const fresh = { count: 0, windowStartedAt: now() };
    loginAttempts.set(key, fresh);
    return fresh;
  }

  return existing;
}

function recordFailedLogin(req) {
  const state = getLoginAttemptState(req);
  state.count += 1;
}

function clearFailedLogins(req) {
  loginAttempts.delete(getClientAddress(req));
}

function isLoginBlocked(req) {
  return getLoginAttemptState(req).count >= MAX_LOGIN_ATTEMPTS;
}

function hasRbcConfig() {
  return Boolean(
    process.env.RBC_CLIENT_ID &&
      process.env.RBC_CLIENT_SECRET &&
      process.env.RBC_AUTH_URL &&
      process.env.RBC_TOKEN_URL &&
      process.env.RBC_REDIRECT_URI
  );
}

function isConnected(session) {
  return Boolean(
    session.accessToken && (!session.expiresAt || session.expiresAt > now())
  );
}

function buildSecurityHeaders(req, contentType, cacheControl = "no-store") {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; upgrade-insecure-requests",
  };

  if (isSecureRequest(req) || FORCE_HTTPS) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }

  return headers;
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, buildSecurityHeaders(req, CONTENT_TYPES[".json"]));
  res.end(JSON.stringify(payload));
}

function sendHtml(req, res, statusCode, html) {
  res.writeHead(statusCode, buildSecurityHeaders(req, CONTENT_TYPES[".html"]));
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
    sendJson(req, res, 404, { error: "Not found" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
  const cacheControl =
    extension === ".html"
      ? "no-store"
      : "public, max-age=300, stale-while-revalidate=300";

  res.writeHead(200, buildSecurityHeaders(req, contentType, cacheControl));
  fs.createReadStream(filePath).pipe(res);
}

function base64UrlSha256(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function buildConnectUrl(session) {
  validateUrlEnv("RBC_AUTH_URL");
  validateUrlEnv("RBC_REDIRECT_URI", true);

  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = base64UrlSha256(codeVerifier);

  session.oauthState = state;
  session.codeVerifier = codeVerifier;

  const url = new URL(process.env.RBC_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.RBC_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.RBC_REDIRECT_URI);
  url.searchParams.set("scope", process.env.RBC_SCOPES || "accounts transactions");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

async function exchangeCodeForToken(session, code) {
  validateUrlEnv("RBC_TOKEN_URL");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.RBC_REDIRECT_URI,
    client_id: process.env.RBC_CLIENT_ID,
    client_secret: process.env.RBC_CLIENT_SECRET,
    code_verifier: session.codeVerifier,
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
    throw new Error("Token exchange failed.");
  }

  if (!payload.access_token) {
    throw new Error("RBC did not return an access token.");
  }

  session.accessToken = payload.access_token;
  session.refreshToken = payload.refresh_token || null;
  session.tokenType = payload.token_type || "Bearer";
  session.expiresAt = payload.expires_in
    ? now() + Number(payload.expires_in) * 1000
    : null;
  session.oauthState = null;
  session.codeVerifier = null;
}

async function fetchRbcAccounts(session) {
  if (!process.env.RBC_ACCOUNTS_URL) {
    return [];
  }

  validateUrlEnv("RBC_ACCOUNTS_URL");

  const response = await fetch(process.env.RBC_ACCOUNTS_URL, {
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error("Accounts sync failed.");
  }

  const accounts = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.accounts)
      ? payload.accounts
      : [];

  session.accounts = accounts.map((account) => {
    const rawId = account.id || account.accountId || account.number || null;

    return {
      id: rawId ? `****${String(rawId).slice(-4)}` : null,
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
    };
  });
  session.lastSyncAt = new Date().toISOString();
  session.updatedAt = now();

  return session.accounts;
}

function getStatusPayload(session) {
  return {
    provider: "RBC",
    configured: hasRbcConfig(),
    connected: isConnected(session),
    expiresAt: session.expiresAt,
    lastSyncAt: session.lastSyncAt,
    accounts: session.accounts,
  };
}

function getAdminStatusPayload(session) {
  return {
    configured: hasAdminConfig(),
    authenticated: Boolean(session.adminAuthenticated),
    username: session.adminAuthenticated ? session.adminUsername : null,
    email: session.adminAuthenticated ? session.adminEmail : null,
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, getRequestOrigin(req));
  const session = ensureSession(req, res);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) {
    if (!validateRequestOrigin(req)) {
      sendJson(req, res, 403, { error: "Invalid request origin." });
      return;
    }
  }

  if (url.pathname === "/api/admin/status" && req.method === "GET") {
    sendJson(req, res, 200, getAdminStatusPayload(session));
    return;
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    assertHttpsForSensitiveRoutes(req);

    if (!hasAdminConfig()) {
      sendJson(req, res, 400, {
        error:
          "Admin login is not configured. Set ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, and SESSION_SECRET.",
      });
      return;
    }

    if (isLoginBlocked(req)) {
      sendJson(req, res, 429, {
        error: "Too many failed login attempts. Try again later.",
      });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const email = String(payload.email || "").trim().toLowerCase();
      const username = String(payload.username || "").trim();
      const password = String(payload.password || "");
      const config = getAdminConfig();
      const emailMatches = safeEqualString(email, config.email.trim().toLowerCase());
      const usernameMatches = safeEqualString(username, config.username.trim());
      const passwordMatches = verifyPassword(password, config.passwordHash.trim());

      if (!emailMatches || !usernameMatches || !passwordMatches) {
        recordFailedLogin(req);
        sendJson(req, res, 401, { error: "Invalid credentials." });
        return;
      }

      clearFailedLogins(req);
      session.adminAuthenticated = true;
      session.adminUsername = config.username.trim();
      session.adminEmail = config.email.trim().toLowerCase();
      session.updatedAt = now();

      sendJson(req, res, 200, getAdminStatusPayload(session));
    } catch {
      sendJson(req, res, 400, { error: "Invalid login payload." });
    }

    return;
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    session.adminAuthenticated = false;
    session.adminUsername = null;
    session.adminEmail = null;
    session.updatedAt = now();
    sendJson(req, res, 200, getAdminStatusPayload(session));
    return;
  }

  if (url.pathname === "/api/rbc/status" && req.method === "GET") {
    sendJson(req, res, 200, getStatusPayload(session));
    return;
  }

  if (url.pathname === "/api/rbc/disconnect" && req.method === "POST") {
    clearSession(req, res);
    sendJson(req, res, 200, { disconnected: true });
    return;
  }

  if (url.pathname === "/api/rbc/connect-url" && req.method === "GET") {
    assertHttpsForSensitiveRoutes(req);

    if (!hasRbcConfig()) {
      sendJson(req, res, 400, {
        error:
          "RBC API is not configured. Set RBC_CLIENT_ID, RBC_CLIENT_SECRET, RBC_AUTH_URL, RBC_TOKEN_URL, RBC_REDIRECT_URI, and SESSION_SECRET.",
      });
      return;
    }

    sendJson(req, res, 200, { url: buildConnectUrl(session) });
    return;
  }

  if (url.pathname === "/api/rbc/callback" && req.method === "GET") {
    assertHttpsForSensitiveRoutes(req);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      sendHtml(
        req,
        res,
        400,
        `<h1>RBC connection failed</h1><p>The bank returned an error.</p><p><a href="/">Return to Count123</a></p>`
      );
      return;
    }

    if (!code || !state || state !== session.oauthState || !session.codeVerifier) {
      sendHtml(
        req,
        res,
        400,
        "<h1>Invalid RBC callback</h1><p>The OAuth state, PKCE verifier, or authorization code was invalid.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
      return;
    }

    try {
      await exchangeCodeForToken(session, code);
      await fetchRbcAccounts(session);
      sendHtml(
        req,
        res,
        200,
        "<h1>RBC connected</h1><p>Your business accounts were synced successfully.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
    } catch {
      sendHtml(
        req,
        res,
        502,
        "<h1>RBC sync failed</h1><p>The bank token exchange or account sync did not complete successfully.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
    }

    return;
  }

  if (url.pathname === "/api/rbc/accounts" && req.method === "GET") {
    assertHttpsForSensitiveRoutes(req);

    if (!isConnected(session)) {
      sendJson(req, res, 401, { error: "RBC is not connected." });
      return;
    }

    try {
      const accounts = await fetchRbcAccounts(session);
      sendJson(req, res, 200, { accounts, lastSyncAt: session.lastSyncAt });
    } catch {
      sendJson(req, res, 502, { error: "Account sync failed." });
    }

    return;
  }

  sendJson(req, res, 404, { error: "Unknown API route" });
}

const server = http.createServer(async (req, res) => {
  cleanupSessions();

  try {
    if ((req.url || "").startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    const message =
      error instanceof Error ? escapeHtml(error.message) : "Internal server error";
    sendJson(req, res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Count123 listening on port ${PORT}`);
});
