// api/shared/azure.js
// Shared helpers used by all Azure Functions

const https = require("https");
const http  = require("http");

function httpsRequest(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const isHttps = !hostname.startsWith("http://");
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: hostname.replace(/^https?:\/\//, ""),
        path,
        method,
        headers: data ? { ...headers, "Content-Length": data.length } : headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Get AAD bearer token for a specific tenant */
async function getToken(tenantId, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://management.azure.com/.default",
  }).toString();

  const r = await httpsRequest(
    "POST",
    "login.microsoftonline.com",
    `/${tenantId}/oauth2/v2.0/token`,
    { "Content-Type": "application/x-www-form-urlencoded" },
    body
  );

  if (!r.body.access_token)
    throw new Error(`Token fetch failed for tenant ${tenantId}: ${JSON.stringify(r.body)}`);

  return r.body.access_token;
}

/** Get display name of a subscription */
async function getSubscriptionName(token, subscriptionId) {
  try {
    const r = await httpsRequest(
      "GET",
      "management.azure.com",
      `/subscriptions/${subscriptionId}?api-version=2022-12-01`,
      { Authorization: `Bearer ${token}` }
    );
    return r.body.displayName || subscriptionId;
  } catch {
    return subscriptionId;
  }
}

/** Fetch cost grouped by ServiceName for a given month offset (0=current, -1=last, -2=two months ago) */
async function fetchBilling(token, subscriptionId, monthOffset = 0) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + monthOffset;
  const start = new Date(y, m, 1).toISOString().split("T")[0];
  const end = monthOffset === 0
    ? now.toISOString().split("T")[0]
    : new Date(y, m + 1, 0).toISOString().split("T")[0];

  const payload = JSON.stringify({
    type: "ActualCost",
    dataSet: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ServiceName" }],
    },
    timeframe: "Custom",
    timePeriod: { from: start, to: end },
  });

  const r = await httpsRequest(
    "POST",
    "management.azure.com",
    `/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-03-01`,
    { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    payload
  );

  if (r.status !== 200)
    throw new Error(`Cost API error ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);

  const cols = (r.body.properties?.columns || []).map((c) =>
    c.name.toLowerCase()
  );
  const rows = r.body.properties?.rows || [];
  const costIdx = cols.indexOf("cost");
  const svcIdx = cols.indexOf("servicename");

  const services = [];
  let total = 0;
  for (const row of rows) {
    const cost = parseFloat(row[costIdx] || 0);
    if (cost <= 0) continue;
    services.push({ name: row[svcIdx] || "Other", cost: Math.round(cost * 100) / 100 });
    total += cost;
  }
  services.sort((a, b) => b.cost - a.cost);
  return { services, total: Math.round(total * 100) / 100 };
}

// ── Key Vault helpers ─────────────────────────────────────────────────────────

/** Get a Key Vault token using Managed Identity (App Service) */
async function getKeyVaultToken() {
  const endpoint = process.env.IDENTITY_ENDPOINT;
  const header   = process.env.IDENTITY_HEADER;

  if (!endpoint || !header)
    throw new Error("Managed Identity not configured");

  const url = `${endpoint}?api-version=2019-08-01&resource=https://vault.azure.net`;
  const res = await fetch(url, { headers: { "X-IDENTITY-HEADER": header } });
  const data = await res.json();

  if (!data.access_token)
    throw new Error(`Managed Identity token failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

const KV_HOST = () => {
  const n = process.env.KEY_VAULT_NAME;
  if (!n) throw new Error("KEY_VAULT_NAME env var not set");
  return `${n}.vault.azure.net`;
};

async function kvGet(secretName) {
  const token = await getKeyVaultToken();
  const r = await httpsRequest(
    "GET",
    KV_HOST(),
    `/secrets/${secretName}?api-version=7.4`,
    { Authorization: `Bearer ${token}` }
  );
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`KV GET ${secretName}: ${r.status}`);
  return r.body.value;
}

async function kvSet(secretName, value) {
  const token = await getKeyVaultToken();
  const r = await httpsRequest(
    "PUT",
    KV_HOST(),
    `/secrets/${secretName}?api-version=7.4`,
    { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    JSON.stringify({ value })
  );
  if (r.status !== 200) throw new Error(`KV SET ${secretName}: ${r.status} ${JSON.stringify(r.body).slice(0,200)}`);
  return true;
}

async function kvDelete(secretName) {
  const token = await getKeyVaultToken();
  const r = await httpsRequest(
    "DELETE",
    KV_HOST(),
    `/secrets/${secretName}?api-version=7.4`,
    { Authorization: `Bearer ${token}` }
  );
  return r.status === 200 || r.status === 204;
}

/** List all secret names with a prefix */
async function kvList(prefix) {
  const token = await getKeyVaultToken();
  const r = await httpsRequest(
    "GET",
    KV_HOST(),
    `/secrets?api-version=7.4&maxresults=200`,
    { Authorization: `Bearer ${token}` }
  );
  if (r.status !== 200) throw new Error(`KV LIST: ${r.status}`);
  const items = r.body.value || [];
  return items
    .map((i) => {
      const parts = i.id.split("/secrets/");
      return parts[parts.length - 1];
    })
    .filter((n) => !prefix || n.startsWith(prefix));
}

// ── Account registry helpers ──────────────────────────────────────────────────
// Accounts are stored as one JSON blob in KV secret "account-registry"

async function loadRegistry() {
  const raw = await kvGet("account-registry");
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveRegistry(list) {
  await kvSet("account-registry", JSON.stringify(list));
}

module.exports = {
  getToken,
  getSubscriptionName,
  fetchBilling,
  kvGet,
  kvSet,
  kvDelete,
  kvList,
  loadRegistry,
  saveRegistry,
};
