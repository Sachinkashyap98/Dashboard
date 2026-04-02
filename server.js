const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

// API routes
app.use('/api/accounts', require('./api/accounts/index'));
app.use('/api/billing', require('./api/billing/index'));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
