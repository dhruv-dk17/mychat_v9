'use strict';
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { initDB, pool } = require('./db/database');
const attachSocketHandlers = require('./socket-handlers');

const app = express();
const server = http.createServer(app);

// ── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  'https://mychat-v9.web.app',
  'https://mychat-v9.firebaseapp.com',
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
};

app.use(cors(corsOptions));

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, { cors: corsOptions });
attachSocketHandlers(io);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '4mb' }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', version: '9' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/users',    require('./routes/users'));
app.use('/rooms',    require('./routes/rooms'));
app.use('/messages', require('./routes/messages'));
app.use('/admin',    require('./routes/admin'));

// ── Cron: purge accounts inactive > 180 days ─────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const r = await pool.query(
      `DELETE FROM users WHERE last_seen < $1 RETURNING username`,
      [cutoff]
    );
    if (r.rows.length > 0) {
      console.log(`Cron: purged ${r.rows.length} inactive accounts`);
    }
  } catch (err) {
    console.error('Cron purge error:', err.message);
  }
});

// ── Cron: purge expired rooms and delivered dead-drops ────────────────────────
cron.schedule('0 4 * * *', async () => {
  try {
    await pool.query(`DELETE FROM rooms WHERE expires_at IS NOT NULL AND expires_at < NOW()`);
    await pool.query(`DELETE FROM dead_drops WHERE delivered = TRUE OR expires_at < NOW()`);
  } catch (err) {
    console.error('Cron cleanup error:', err.message);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
initDB()
  .then(() => server.listen(PORT, () => console.log(`✓ v9 server on :${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
