const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function initDB() {
  const client = await pool.connect();
  try {
    // ── Users ────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                       SERIAL PRIMARY KEY,
        username                 VARCHAR(32) UNIQUE NOT NULL,
        password_hash            TEXT NOT NULL,
        recovery_phrase_hash     TEXT NOT NULL,
        identity_public_key      TEXT,
        signed_prekey            TEXT,
        session_token            VARCHAR(128),
        contacts                 JSONB DEFAULT '[]'::jsonb,
        contact_requests         JSONB DEFAULT '[]'::jsonb,
        outgoing_contact_requests JSONB DEFAULT '[]'::jsonb,
        last_seen                TIMESTAMP DEFAULT NOW(),
        created_at               TIMESTAMP DEFAULT NOW()
      )
    `);

    // Backward-safe column additions for existing DBs
    const safeAlter = async (sql) => { try { await client.query(sql); } catch (_) {} };
    await safeAlter(`ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_public_key TEXT`);
    await safeAlter(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signed_prekey TEXT`);
    await safeAlter(`ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_requests JSONB DEFAULT '[]'::jsonb`);
    await safeAlter(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outgoing_contact_requests JSONB DEFAULT '[]'::jsonb`);
    await safeAlter(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW()`);

    // ── One-Time Pre-Keys (for X3DH E2EE) ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS one_time_prekeys (
        id         SERIAL PRIMARY KEY,
        username   VARCHAR(32) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        key_id     INTEGER NOT NULL,
        public_key TEXT NOT NULL,
        consumed   BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (username, key_id)
      )
    `);

    // ── Rooms (permanent) ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id        SERIAL PRIMARY KEY,
        room_name      VARCHAR(64) UNIQUE NOT NULL,
        password_hash  TEXT NOT NULL,
        owner_username VARCHAR(32) REFERENCES users(username) ON DELETE CASCADE,
        expires_at     TIMESTAMP,
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Messages ─────────────────────────────────────────────────────────────
    // encrypted_payload: the E2EE cipher text — server cannot read it
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id                SERIAL PRIMARY KEY,
        room_id           VARCHAR(128) NOT NULL,
        sender            VARCHAR(32)  NOT NULL,
        encrypted_payload TEXT         NOT NULL,
        msg_type          VARCHAR(32)  NOT NULL DEFAULT 'text',
        reply_to_id       INTEGER      REFERENCES messages(id) ON DELETE SET NULL,
        deleted           BOOLEAN      DEFAULT FALSE,
        edited            BOOLEAN      DEFAULT FALSE,
        read_by           JSONB        DEFAULT '[]'::jsonb,
        timestamp         TIMESTAMP    DEFAULT NOW()
      )
    `);

    // ── Dead Drops (offline delivery) ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS dead_drops (
        id                SERIAL PRIMARY KEY,
        receiver_username VARCHAR(32) NOT NULL,
        encrypted_payload TEXT NOT NULL,
        sender_public_key TEXT NOT NULL,
        expires_at        TIMESTAMP NOT NULL,
        delivered         BOOLEAN DEFAULT FALSE,
        created_at        TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✓ v9 Database ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
