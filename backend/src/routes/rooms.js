'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { pool } = require('../db/database');

const SALT_ROUNDS = 12;
const getErr = e => e.issues?.[0]?.message || 'Invalid request';

const roomSchema = z.object({
  slug:     z.string().min(3).max(32).regex(/^[a-z0-9]+$/),
  password: z.string().min(4).max(128),
});

// ── CREATE permanent room ─────────────────────────────────────────────────────
router.post('/create', async (req, res) => {
  const { username, token } = req.query;
  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { slug, password } = roomSchema.parse(req.body);
    const auth = await pool.query(`SELECT 1 FROM users WHERE username=$1 AND session_token=$2`, [username.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: 'Unauthorized' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(
      `INSERT INTO rooms (room_name, password_hash, owner_username) VALUES ($1, $2, $3)`,
      [slug, hash, username.toLowerCase()]
    );
    res.json({ success: true, slug });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getErr(e) });
    if (e.code === '23505') return res.status(409).json({ error: 'Room ID already taken' });
    console.error('Create room error:', e.message);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// ── VERIFY room password ──────────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const r = await pool.query(`SELECT password_hash, owner_username FROM rooms WHERE room_name=$1`, [slug.toLowerCase()]);
    if (!r.rows.length) return res.status(404).json({ error: 'Room not found' });

    const valid = await bcrypt.compare(password, r.rows[0].password_hash);
    res.json({ valid, owner: r.rows[0].owner_username });
  } catch (e) {
    console.error('Verify room error:', e.message);
    res.status(500).json({ error: 'Verification error' });
  }
});

// ── GET user's owned rooms ────────────────────────────────────────────────────
router.get('/mine', async (req, res) => {
  const { username, token } = req.query;
  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });

  const auth = await pool.query(`SELECT 1 FROM users WHERE username=$1 AND session_token=$2`, [username.toLowerCase(), token]);
  if (!auth.rows.length) return res.status(401).json({ error: 'Unauthorized' });

  const r = await pool.query(`SELECT room_name AS slug, created_at FROM rooms WHERE owner_username=$1 ORDER BY created_at DESC`, [username.toLowerCase()]);
  res.json({ rooms: r.rows });
});

// ── DELETE room (owner only) ──────────────────────────────────────────────────
router.delete('/:slug', async (req, res) => {
  const { username, token } = req.query;
  const { slug } = req.params;
  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const auth = await pool.query(`SELECT 1 FROM users WHERE username=$1 AND session_token=$2`, [username.toLowerCase(), token]);
    if (!auth.rows.length) return res.status(401).json({ error: 'Unauthorized' });

    const r = await pool.query(`DELETE FROM rooms WHERE room_name=$1 AND owner_username=$2 RETURNING room_name`, [slug, username.toLowerCase()]);
    if (!r.rows.length) return res.status(403).json({ error: 'Not found or not owner' });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete room error:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
