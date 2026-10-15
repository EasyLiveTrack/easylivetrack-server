const express = require('express');
const cors = require('cors');
const path = require('path');
const { apiLimiter } = require('./middleware/rateLimiter');
const { router: ingestionRouter } = require('./routes/ingestion');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const sessionsRouter = require('./routes/sessions');
const viewsRouter = require('./routes/views');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting on API routes
app.use('/api/', apiLimiter);

// Serve static assets
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

// Mount routers
app.use('/', ingestionRouter);
app.use('/', authRouter);
app.use('/', adminRouter);
app.use('/', sessionsRouter);
app.use('/', viewsRouter);

module.exports = app;
