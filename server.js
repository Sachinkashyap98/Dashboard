const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

// Adapter: converts Express req/res to Azure Functions context/req style
function adapt(handler) {
  return async (req, res) => {
    const context = {
      log: { error: console.error, warn: console.warn, info: console.log },
      res: {}
    };
    const azReq = {
      body: req.body,
      query: req.query,
      params: req.params,
      headers: req.headers,
      method: req.method
    };
    try {
      await handler(context, azReq);
      const r = context.res;
      res.status(r.status || 200);
      if (r.headers) Object.entries(r.headers).forEach(([k, v]) => res.set(k, v));
      res.send(r.body);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  };
}

app.get('/api/accounts',          adapt(require('./api/accounts/index')));
app.post('/api/accounts/save',    adapt(require('./api/save-account/index')));
app.delete('/api/accounts/:subscriptionId', adapt(require('./api/delete-account/index')));
app.get('/api/billing',           adapt(require('./api/billing/index')));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
