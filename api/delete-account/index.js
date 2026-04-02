const { loadRegistry, saveRegistry, kvDelete } = require("../shared/azure");

module.exports = async function (context, req) {
  const { subscriptionId } = req.params;
  try {
    const registry = await loadRegistry();
    const idx = registry.findIndex((a) => a.subscriptionId === subscriptionId);
    if (idx === -1) {
      context.res = { status: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Account not found" }) };
      return;
    }
    const { secretName } = registry[idx];
    registry.splice(idx, 1);
    await saveRegistry(registry);
    try { await kvDelete(secretName); } catch { /* best-effort */ }
    context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    context.res = { status: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
};
