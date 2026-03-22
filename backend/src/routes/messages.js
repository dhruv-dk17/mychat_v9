'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');

// ── GET /messages/:roomId ─────────────────────────────────────────────────────
// Returns the last N encrypted messages for a room. Server cannot decrypt them.
router.get('/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const { username, token, before, limit } = req.query;

  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Verify session
    const auth = await pool.query(
      'SELECT username FROM users WHERE username = $1 AND session_token = $2',
      [username.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: 'Unauthorized' });

    const pageSize = Math.min(parseInt(limit) || 50, 100);
    const beforeId = parseInt(before) || null;

    let query, params;
    if (beforeId) {
      query = `SELECT id, sender, encrypted_payload, msg_type, reply_to_id, deleted, edited, read_by, timestamp
               FROM messages WHERE room_id = $1 AND id < $2
               ORDER BY id DESC LIMIT $3`;
      params = [roomId, beforeId, pageSize];
    } else {
      query = `SELECT id, sender, encrypted_payload, msg_type, reply_to_id, deleted, edited, read_by, timestamp
               FROM messages WHERE room_id = $1
               ORDER BY id DESC LIMIT $2`;
      params = [roomId, pageSize];
    }

    const r = await pool.query(query, params);
    res.json({ messages: r.rows.reverse() });
  } catch (err) {
    console.error('Messages fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ── GET /messages/prekey/:username ───────────────────────────────────────────
// Fetch one available one-time pre-key for E2EE session setup
router.get('/prekey/:targetUsername', async (req, res) => {
  const { targetUsername } = req.params;
  const { username, token } = req.query;

  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const auth = await pool.query(
      'SELECT username FROM users WHERE username = $1 AND session_token = $2',
      [username.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: 'Unauthorized' });

    // Fetch target user's public identity key + one unconsumed one-time prekey
    const userInfo = await pool.query(
      'SELECT identity_public_key, signed_prekey FROM users WHERE username = $1',
      [targetUsername.toLowerCase()]
    );
    if (!userInfo.rows.length) return res.status(404).json({ error: 'User not found' });

    const prekey = await pool.query(
      `SELECT id, key_id, public_key FROM one_time_prekeys
       WHERE username = $1 AND consumed = FALSE
       ORDER BY created_at ASC LIMIT 1`,
      [targetUsername.toLowerCase()]
    );

    // Mark consumed
    if (prekey.rows.length) {
      await pool.query('UPDATE one_time_prekeys SET consumed = TRUE WHERE id = $1', [prekey.rows[0].id]);
    }

    res.json({
      identityPublicKey: userInfo.rows[0].identity_public_key,
      signedPrekey: userInfo.rows[0].signed_prekey,
      oneTimePrekey: prekey.rows[0] || null,
    });
  } catch (err) {
    console.error('Prekey fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch prekey bundle' });
  }
});

// ── POST /messages/prekeys ────────────────────────────────────────────────────
// Upload a batch of new one-time pre-keys
router.post('/prekeys', async (req, res) => {
  const { username, token } = req.query;
  const { prekeys } = req.body; // [{ keyId, publicKey }, ...]

  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });
  if (!Array.isArray(prekeys) || !prekeys.length) return res.status(400).json({ error: 'No prekeys provided' });

  try {
    const auth = await pool.query(
      'SELECT username FROM users WHERE username = $1 AND session_token = $2',
      [username.toLowerCase(), token]
    );
    if (!auth.rows.length) return res.status(401).json({ error: 'Unauthorized' });

    for (const pk of prekeys) {
      if (!pk.keyId || !pk.publicKey) continue;
      await pool.query(
        `INSERT INTO one_time_prekeys (username, key_id, public_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (username, key_id) DO NOTHING`,
        [username.toLowerCase(), pk.keyId, pk.publicKey]
      );
    }
    res.json({ success: true, uploaded: prekeys.length });
  } catch (err) {
    console.error('Prekey upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload prekeys' });
  }
});

module.exports = router;
