const { loadRegistry } = require("../shared/azure");

module.exports = async function (context, req) {
  try {
    const registry = await loadRegistry();
    // Return metadata only — no secrets
    const safe = registry.map(({ id, label, subscriptionId, subName, budgetUsd, addedAt, updatedAt }) => ({
      id, label, subscriptionId, subName, budgetUsd, addedAt, updatedAt,
    }));
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts: safe }),
    };
  } catch (e) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
