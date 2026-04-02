const { getToken, fetchBilling, loadRegistry, kvGet } = require("../shared/azure");

const CONCURRENCY = 8;

function monthLabel(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

async function fetchOne(account, monthOffset) {
  try {
    const credsRaw = await kvGet(account.secretName);
    if (!credsRaw) return { ...account, error: "Credentials not found in Key Vault", total: 0, services: [] };
    const { tenantId, clientId, clientSecret } = JSON.parse(credsRaw);
    const token = await getToken(tenantId, clientId, clientSecret);
    const { services, total, currency } = await fetchBilling(token, account.subscriptionId, monthOffset);
    return { ...account, total, services, currency, error: null };
  } catch (e) {
    return { ...account, total: 0, services: [], error: e.message };
  }
}

async function batchFetch(accounts, concurrency, monthOffset) {
  const results = [];
  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((a) => fetchOne(a, monthOffset)));
    results.push(...batchResults);
  }
  return results;
}

module.exports = async function (context, req) {
  try {
    const registry = await loadRegistry();
    if (registry.length === 0) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ months: [], accounts: [], message: "No accounts configured yet." }),
      };
      return;
    }

    const filterSub = req.query.sub || null;
    const toFetch = filterSub ? registry.filter((a) => a.subscriptionId === filterSub) : registry;

    // Fetch last 3 months in parallel
    const [m0, m1, m2] = await Promise.all([
      batchFetch(toFetch, CONCURRENCY, 0),
      batchFetch(toFetch, CONCURRENCY, -1),
      batchFetch(toFetch, CONCURRENCY, -2),
    ]);

    const months = [
      { month: monthLabel(-2), accounts: m2.sort((a, b) => b.total - a.total) },
      { month: monthLabel(-1), accounts: m1.sort((a, b) => b.total - a.total) },
      { month: monthLabel(0),  accounts: m0.sort((a, b) => b.total - a.total) },
    ];

    // Also expose flat "accounts" for current month (backward compat)
    const accounts = m0.sort((a, b) => b.total - a.total).map(
      ({ id, label, subscriptionId, subName, budgetUsd, total, services, currency, error }) =>
        ({ id, label, subscriptionId, subName, budgetUsd, total, services, currency, error })
    );

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
      body: JSON.stringify({ month: monthLabel(0), fetchedAt: new Date().toISOString(), months, accounts }),
    };
  } catch (e) {
    context.log.error("billing error:", e.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
