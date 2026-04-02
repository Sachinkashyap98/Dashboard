const { getToken, getSubscriptionName, loadRegistry, saveRegistry, kvSet } = require("../shared/azure");

const json = (res, status, body) => {
  res.status = status;
  res.headers = { "Content-Type": "application/json" };
  res.body = JSON.stringify(body);
};

module.exports = async function (context, req) {
  const { id, label, tenantId, clientId, clientSecret, subscriptionId, budgetUsd } = req.body || {};

  if (!label || !tenantId || !clientId || !clientSecret || !subscriptionId) {
    return json(context.res, 400, { error: "label, tenantId, clientId, clientSecret, subscriptionId are required." });
  }

  try {
    // 1. Verify credentials work
    const token = await getToken(tenantId, clientId, clientSecret);
    const subName = await getSubscriptionName(token, subscriptionId);

    // 2. Store credentials securely in Key Vault
    const secretName = `cred-${subscriptionId.replace(/-/g, "")}`;
    await kvSet(secretName, JSON.stringify({ tenantId, clientId, clientSecret }));

    // 3. Update registry (no secrets stored here — only metadata)
    const registry = await loadRegistry();
    const accountId = id || subscriptionId;
    const existing = registry.findIndex((a) => a.subscriptionId === subscriptionId);
    const entry = {
      id: accountId,
      label,
      subscriptionId,
      subName,
      secretName,
      budgetUsd: budgetUsd ? parseInt(budgetUsd) : null,
      addedAt: existing >= 0 ? registry[existing].addedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existing >= 0) registry[existing] = entry;
    else registry.push(entry);

    await saveRegistry(registry);

    return json(context.res, 200, { ok: true, account: { id: accountId, label, subName, subscriptionId } });
  } catch (e) {
    context.log.error("save-account error:", e.message);
    return json(context.res, 500, { error: e.message });
  }
};
