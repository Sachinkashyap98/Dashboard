# Azure Multi-Tenant Billing Dashboard

40 alag-alag tenants ki billing ek dashboard pe. Credentials Azure Key Vault mein securely store hote hain.

## Architecture

```
Browser (index.html)
  │
  ├── GET  /api/accounts          → Registry load (metadata only)
  ├── POST /api/accounts/save     → Credentials save to Key Vault
  ├── DEL  /api/accounts/{subId}  → Account remove
  └── GET  /api/billing           → All 40 tenants fetch in parallel (8 at a time)
                                      ↳ Key Vault se credentials → AAD token → Cost API
```

## One-time Azure Setup (30 min)

### 1. Azure Key Vault banayein

```bash
az group create --name billing-dashboard-rg --location eastus
az keyvault create --name billing-kv-YOUR_UNIQUE_NAME \
  --resource-group billing-dashboard-rg --location eastus
```

### 2. Static Web App banayein

Azure Portal → Static Web Apps → Create:
- Resource group: `billing-dashboard-rg`
- Name: `azure-billing-dashboard`
- Deployment source: **GitHub**
- App location: `src` | API location: `api` | Output: (blank)

After creation, copy the **deployment token**.

### 3. Managed Identity enable karein

```bash
# SWA ka resource ID nikaalein
SWA_ID=$(az staticwebapp show --name azure-billing-dashboard \
  --resource-group billing-dashboard-rg --query id -o tsv)

# System-assigned identity enable
az staticwebapp identity assign --name azure-billing-dashboard \
  --resource-group billing-dashboard-rg

# Principal ID nikaalein
PRINCIPAL=$(az staticwebapp show --name azure-billing-dashboard \
  --resource-group billing-dashboard-rg \
  --query "identity.principalId" -o tsv)

# Key Vault access dein
az keyvault set-policy --name billing-kv-YOUR_UNIQUE_NAME \
  --object-id $PRINCIPAL \
  --secret-permissions get set delete list
```

### 4. Environment variable set karein

Azure Portal → Static Web Apps → Configuration → Application settings:

| Name | Value |
|---|---|
| `KEY_VAULT_NAME` | `billing-kv-YOUR_UNIQUE_NAME` |

### 5. GitHub mein deploy karein

```bash
git init && git add . && git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

GitHub mein: Settings → Secrets → Actions → New:
- `AZURE_STATIC_WEB_APPS_API_TOKEN` = (step 2 se copied token)

### 6. Accounts add karein

Dashboard khulne ke baad **"Manage accounts"** tab mein jaayein.

**Option A — Manual:** Ek-ek karke Tenant ID, Client ID, Secret, Subscription ID bharen.

**Option B — CSV bulk import:** `sample-accounts.csv` ki tarah file banayein, sab 40 accounts ek saath import karein.

## Har client ke liye App Registration

Har alag tenant mein:
1. Azure Portal → Azure Active Directory → App registrations → New registration
2. `Tenant ID`, `Client ID` copy karein
3. Certificates & secrets → New client secret → value copy karein
4. Subscriptions → Access control (IAM) → Add role: **Cost Management Reader** → member: aapka app

## Cost

| Resource | Cost |
|---|---|
| Azure Static Web Apps (Free tier) | $0 |
| Azure Functions (included) | $0 |
| Azure Key Vault (< 10k ops/month) | ~$0.03 |
| Azure Cost Management API | Free |
| **Total** | **~$0/month** |
# Dashboard
