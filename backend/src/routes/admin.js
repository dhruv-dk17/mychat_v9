'use strict';
// Admin dashboard — protected by ADMIN_SECRET env var
const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');

// Middleware: all admin routes require ADMIN_SECRET header
router.use((req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden — admin access required' });
  }
  next();
});

// ── GET /admin/stats ──────────────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  try {
    const [users, rooms, messages, deadDrops] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM rooms'),
      pool.query('SELECT COUNT(*) FROM messages'),
      pool.query('SELECT COUNT(*) FROM dead_drops WHERE delivered = FALSE'),
    ]);
    res.json({
      totalUsers:       parseInt(users.rows[0].count),
      totalRooms:       parseInt(rooms.rows[0].count),
      totalMessages:    parseInt(messages.rows[0].count),
      pendingDeadDrops: parseInt(deadDrops.rows[0].count),
    });
  } catch (e) {
    console.error('Admin stats error:', e.message);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── GET /admin/inactive ───────────────────────────────────────────────────────
// Lists accounts not seen in the past N days (default 180)
router.get('/inactive', async (req, res) => {
  const days = parseInt(req.query.days) || 180;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const r = await pool.query(
      `SELECT username, last_seen, created_at FROM users WHERE last_seen < $1 ORDER BY last_seen ASC`,
      [cutoff]
    );
    res.json({ inactive: r.rows, cutoffDays: days });
  } catch (e) {
    console.error('Admin inactive error:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ── DELETE /admin/purge-inactive ──────────────────────────────────────────────
// Permanently delete accounts inactive for more than N days
router.delete('/purge-inactive', async (req, res) => {
  const days = parseInt(req.query.days) || 180;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const r = await pool.query(
      `DELETE FROM users WHERE last_seen < $1 RETURNING username`,
      [cutoff]
    );
    res.json({ purged: r.rows.map(row => row.username), count: r.rows.length });
  } catch (e) {
    console.error('Admin purge error:', e.message);
    res.status(500).json({ error: 'Failed to purge' });
  }
});

// ── DELETE /admin/user/:username ──────────────────────────────────────────────
// Force-delete a specific user
router.delete('/user/:username', async (req, res) => {
  const { username } = req.params;
  try {
    await pool.query(`UPDATE messages SET deleted=TRUE, encrypted_payload='DELETED', sender='deleted_user' WHERE sender=$1`, [username.toLowerCase()]);
    const r = await pool.query(`DELETE FROM users WHERE username=$1 RETURNING username`, [username.toLowerCase()]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, deleted: username });
  } catch (e) {
    console.error('Admin delete user error:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  try {
    const r = await pool.query(
      `SELECT username, last_seen, created_at,
              jsonb_array_length(contacts) AS contact_count
       FROM users ORDER BY last_seen DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = await pool.query('SELECT COUNT(*) FROM users');
    res.json({ users: r.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (e) {
    console.error('Admin users list error:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
