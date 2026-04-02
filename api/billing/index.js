const { getToken, fetchBilling, loadRegistry, kvGet } = require("../shared/azure");

const CONCURRENCY = 4;

function monthLabel(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7);
}

async function fetchOne(account, monthOffset) {
  try {
    const credsRaw = await kvGet(account.secretName);
    if (!credsRaw) return { ...account, error: "Credentials not found in Key Vault", total: 0, services: [] };
    const { tenantId, clientId, clientSecret } = JSON.parse(credsRaw);
    const token = await getToken(tenantId, clientId, clientSecret);
    const { services, resources, total } = await fetchBilling(token, account.subscriptionId, monthOffset);
    return { ...account, total, services, resources, error: null };
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

    // Check if specific month requested (offset param)
    const offsetParam = req.query.offset;

    if (offsetParam !== undefined) {
      // Single month fetch on demand
      const offset = parseInt(offsetParam) || 0;
      const accounts = await batchFetch(toFetch, CONCURRENCY, offset);
      accounts.sort((a, b) => b.total - a.total);
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
        body: JSON.stringify({
          month: monthLabel(offset),
          fetchedAt: new Date().toISOString(),
          accounts: accounts.map(({ id, label, subscriptionId, subName, budgetUsd, total, services, resources, error }) =>
            ({ id, label, subscriptionId, subName, budgetUsd, total, services, resources, error }))
        }),
      };
      return;
    }

    // Default: fetch only current month
    const m0 = await batchFetch(toFetch, CONCURRENCY, 0);
    m0.sort((a, b) => b.total - a.total);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
      body: JSON.stringify({
        month: monthLabel(0),
        fetchedAt: new Date().toISOString(),
        accounts: m0.map(({ id, label, subscriptionId, subName, budgetUsd, total, services, resources, error }) =>
          ({ id, label, subscriptionId, subName, budgetUsd, total, services, resources, error }))
      }),
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
