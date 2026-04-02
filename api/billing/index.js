const { getToken, fetchBilling, loadRegistry, kvGet } = require("../shared/azure");

const CONCURRENCY = 8; // fetch 8 accounts at a time to avoid rate limits

async function fetchOne(account) {
  try {
    const credsRaw = await kvGet(account.secretName);
    if (!credsRaw) return { ...account, error: "Credentials not found in Key Vault", total: 0, services: [] };

    const { tenantId, clientId, clientSecret } = JSON.parse(credsRaw);
    const token = await getToken(tenantId, clientId, clientSecret);
    const { services, total } = await fetchBilling(token, account.subscriptionId);
    return { ...account, total, services, error: null };
  } catch (e) {
    return { ...account, total: 0, services: [], error: e.message };
  }
}

async function batchFetch(accounts, concurrency) {
  const results = [];
  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fetchOne));
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
        body: JSON.stringify({ month: new Date().toISOString().slice(0, 7), accounts: [], message: "No accounts configured yet." }),
      };
      return;
    }

    // Optional: filter by single subscriptionId query param
    const filterSub = req.query.sub || null;
    const toFetch = filterSub ? registry.filter((a) => a.subscriptionId === filterSub) : registry;

    const results = await batchFetch(toFetch, CONCURRENCY);

    // Sort by total spend descending
    results.sort((a, b) => b.total - a.total);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
      body: JSON.stringify({
        month: new Date().toISOString().slice(0, 7),
        fetchedAt: new Date().toISOString(),
        accounts: results.map(({ id, label, subscriptionId, subName, budgetUsd, total, services, error }) => ({
          id, label, subscriptionId, subName, budgetUsd, total, services, error,
        })),
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
