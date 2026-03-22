'use strict';
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../db/database');

const SALT_ROUNDS = 12;
const getErr = e => e.issues?.[0]?.message || 'Invalid request';

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts.' } });

const registerSchema = z.object({
  username:           z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password:           z.string().min(8).max(128),
  recoveryPhraseHash: z.string().min(10),         // client already hashed it
  identityPublicKey:  z.string().optional(),
  signedPrekey:       z.string().optional(),
});

const loginSchema = z.object({
  username:          z.string(),
  password:          z.string(),
  identityPublicKey: z.string().optional(),
  signedPrekey:      z.string().optional(),
});

const recoverySchema = z.object({
  username:           z.string(),
  recoveryPhraseHash: z.string().min(10),  // client sends hash
  newPasswordHash:    z.string().min(10),  // client sends hash — we store as-is (already bcrypt)
});

function normalizeList(val) {
  if (!Array.isArray(val)) return [];
  return Array.from(new Set(val.map(v => String(v || '').trim().toLowerCase()).filter(Boolean))).sort();
}

// ── REGISTER ──────────────────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password, recoveryPhraseHash, identityPublicKey, signedPrekey } = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const token = crypto.randomBytes(48).toString('hex');

    await pool.query(
      `INSERT INTO users (username, password_hash, recovery_phrase_hash, identity_public_key, signed_prekey, session_token)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [username.toLowerCase(), passwordHash, recoveryPhraseHash, identityPublicKey || null, signedPrekey || null, token]
    );
    await pool.query(`UPDATE users SET last_seen = NOW() WHERE username = $1`, [username.toLowerCase()]);

    res.json({ success: true, username: username.toLowerCase(), token });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getErr(e) });
    if (e.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password, identityPublicKey, signedPrekey } = loginSchema.parse(req.body);
    const r = await pool.query(`SELECT password_hash FROM users WHERE username = $1`, [username.toLowerCase()]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = crypto.randomBytes(48).toString('hex');

    await pool.query(
      `UPDATE users SET session_token = $1, last_seen = NOW()
         ${identityPublicKey ? ', identity_public_key = $3' : ''}
         ${signedPrekey ? `, signed_prekey = $${identityPublicKey ? 4 : 3}` : ''}
       WHERE username = $2`,
      [token, username.toLowerCase(),
        ...(identityPublicKey ? [identityPublicKey] : []),
        ...(signedPrekey ? [signedPrekey] : [])
      ]
    );

    res.json({ success: true, username: username.toLowerCase(), token });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getErr(e) });
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── RECOVER PASSWORD ──────────────────────────────────────────────────────────
// Client hashes the recovery phrase (bcrypt) before sending. Server compares hash.
// newPasswordHash is also bcrypt-hashed client-side.
router.post('/recover', authLimiter, async (req, res) => {
  try {
    const { username, recoveryPhraseHash, newPasswordHash } = recoverySchema.parse(req.body);
    const r = await pool.query(
      `SELECT recovery_phrase_hash FROM users WHERE username = $1`,
      [username.toLowerCase()]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Invalid username or recovery phrase' });

    // The client sends bcrypt(recoveryPhrase), server stored the same hash on registration
    const match = recoveryPhraseHash === r.rows[0].recovery_phrase_hash;
    if (!match) return res.status(400).json({ error: 'Invalid username or recovery phrase' });

    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE username = $2`,
      [newPasswordHash, username.toLowerCase()]
    );
    res.json({ success: true });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getErr(e) });
    console.error('Recovery error:', e.message);
    res.status(500).json({ error: 'Recovery failed' });
  }
});

// ── DELETE ACCOUNT ────────────────────────────────────────────────────────────
router.delete('/account', authLimiter, async (req, res) => {
  try {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const r = await pool.query(`SELECT password_hash FROM users WHERE username = $1`, [username.toLowerCase()]);
    if (!r.rows.length) return res.status(401).json({ error: 'Unauthorized' });

    const match = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Unauthorized' });

    // Tombstone: mark their messages as deleted but keep the shell for other users' history
    await pool.query(`UPDATE messages SET deleted = TRUE, encrypted_payload = 'DELETED', sender = 'deleted_user' WHERE sender = $1`, [username.toLowerCase()]);
    await pool.query(`DELETE FROM users WHERE username = $1`, [username.toLowerCase()]);

    res.json({ success: true });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getErr(e) });
    console.error('Delete account error:', e.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ── GET PUBLIC KEY ────────────────────────────────────────────────────────────
router.get('/pubkey/:target', async (req, res) => {
  const { username, token } = req.query;
  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });

  const auth = await pool.query(`SELECT 1 FROM users WHERE username = $1 AND session_token = $2`, [username.toLowerCase(), token]);
  if (!auth.rows.length) return res.status(401).json({ error: 'Unauthorized' });

  const r = await pool.query(`SELECT identity_public_key, signed_prekey FROM users WHERE username = $1`, [req.params.target.toLowerCase()]);
  if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(r.rows[0]);
});

// ── CONTACTS ──────────────────────────────────────────────────────────────────
router.get('/contacts', async (req, res) => {
  const { username, token } = req.query;
  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });
  const u = await pool.query(
    `SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 AND session_token = $2`,
    [username.toLowerCase(), token]
  );
  if (!u.rows.length) return res.status(401).json({ error: 'Unauthorized' });
  const row = u.rows[0];
  res.json({
    contacts:         normalizeList(row.contacts),
    incomingRequests: normalizeList(row.contact_requests),
    outgoingRequests: normalizeList(row.outgoing_contact_requests),
  });
});

// ── SEND CONTACT REQUEST ──────────────────────────────────────────────────────
router.post('/contacts/request', async (req, res) => {
  const { username, token } = req.query;
  const { contactUsername } = req.body;
  if (!username || !token || !contactUsername) return res.status(400).json({ error: 'Missing fields' });

  const me = username.toLowerCase();
  const target = contactUsername.toLowerCase();
  if (me === target) return res.status(400).json({ error: 'Cannot add yourself' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const meRow = await client.query(`SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 AND session_token = $2 FOR UPDATE`, [me, token]);
    if (!meRow.rows.length) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'Unauthorized' }); }

    const targetRow = await client.query(`SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 FOR UPDATE`, [target]);
    if (!targetRow.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }

    let meC = normalizeList(meRow.rows[0].contacts), meIn = normalizeList(meRow.rows[0].contact_requests), meOut = normalizeList(meRow.rows[0].outgoing_contact_requests);
    let tC  = normalizeList(targetRow.rows[0].contacts), tIn  = normalizeList(targetRow.rows[0].contact_requests), tOut  = normalizeList(targetRow.rows[0].outgoing_contact_requests);

    let status = 'pending';
    if (meC.includes(target)) {
      status = 'already_contact';
    } else if (meIn.includes(target)) {
      // Auto-accept
      meIn = meIn.filter(x => x !== target); tOut = tOut.filter(x => x !== me);
      meC = normalizeList([...meC, target]); tC = normalizeList([...tC, me]);
      status = 'accepted';
    } else if (!meOut.includes(target)) {
      meOut = normalizeList([...meOut, target]); tIn = normalizeList([...tIn, me]);
    }

    const save = (u, c, i, o) => client.query(`UPDATE users SET contacts=$1::jsonb, contact_requests=$2::jsonb, outgoing_contact_requests=$3::jsonb WHERE username=$4`, [JSON.stringify(c), JSON.stringify(i), JSON.stringify(o), u]);
    await save(me, meC, meIn, meOut);
    await save(target, tC, tIn, tOut);
    await client.query('COMMIT');
    res.json({ success: true, status, contacts: meC, incomingRequests: meIn, outgoingRequests: meOut });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Contact request error:', e.message);
    res.status(500).json({ error: 'Failed' });
  } finally { client.release(); }
});

// ── RESPOND TO CONTACT REQUEST ────────────────────────────────────────────────
router.post('/contacts/respond', async (req, res) => {
  const { username, token } = req.query;
  const { fromUsername, action } = req.body; // action: 'accept' | 'reject'
  if (!username || !token || !fromUsername || !['accept', 'reject'].includes(action))
    return res.status(400).json({ error: 'Missing or invalid fields' });

  const me = username.toLowerCase(), from = fromUsername.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const meRow = await client.query(`SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username=$1 AND session_token=$2 FOR UPDATE`, [me, token]);
    if (!meRow.rows.length) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'Unauthorized' }); }

    const fromRow = await client.query(`SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username=$1 FOR UPDATE`, [from]);
    if (!fromRow.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }

    let meC = normalizeList(meRow.rows[0].contacts), meIn = normalizeList(meRow.rows[0].contact_requests), meOut = normalizeList(meRow.rows[0].outgoing_contact_requests);
    let fC  = normalizeList(fromRow.rows[0].contacts), fIn  = normalizeList(fromRow.rows[0].contact_requests), fOut  = normalizeList(fromRow.rows[0].outgoing_contact_requests);

    meIn = meIn.filter(x => x !== from); fOut = fOut.filter(x => x !== me);
    if (action === 'accept') {
      meC = normalizeList([...meC, from]); fC = normalizeList([...fC, me]);
    }

    const save = (u, c, i, o) => client.query(`UPDATE users SET contacts=$1::jsonb, contact_requests=$2::jsonb, outgoing_contact_requests=$3::jsonb WHERE username=$4`, [JSON.stringify(c), JSON.stringify(i), JSON.stringify(o), u]);
    await save(me, meC, meIn, meOut);
    await save(from, fC, fIn, fOut);
    await client.query('COMMIT');
    res.json({ success: true, status: action === 'accept' ? 'accepted' : 'rejected', contacts: meC, incomingRequests: meIn, outgoingRequests: meOut });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Respond error:', e.message);
    res.status(500).json({ error: 'Failed' });
  } finally { client.release(); }
});

module.exports = router;
