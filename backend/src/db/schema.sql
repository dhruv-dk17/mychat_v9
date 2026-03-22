-- =========================================================
-- Mychat v9 — Database Schema
-- Paste this into Supabase SQL Editor and click "Run"
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id                          SERIAL PRIMARY KEY,
  username                    VARCHAR(32) UNIQUE NOT NULL,
  password_hash               TEXT NOT NULL,
  recovery_phrase_hash        TEXT NOT NULL,
  identity_public_key         TEXT,
  signed_prekey               TEXT,
  session_token               VARCHAR(128),
  contacts                    JSONB DEFAULT '[]'::jsonb,
  contact_requests            JSONB DEFAULT '[]'::jsonb,
  outgoing_contact_requests   JSONB DEFAULT '[]'::jsonb,
  last_seen                   TIMESTAMP DEFAULT NOW(),
  created_at                  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS one_time_prekeys (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(32) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  key_id      INTEGER NOT NULL,
  public_key  TEXT NOT NULL,
  consumed    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (username, key_id)
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id         SERIAL PRIMARY KEY,
  room_name       VARCHAR(64) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  owner_username  VARCHAR(32) REFERENCES users(username) ON DELETE CASCADE,
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS dead_drops (
  id                SERIAL PRIMARY KEY,
  receiver_username VARCHAR(32) NOT NULL,
  encrypted_payload TEXT NOT NULL,
  sender_public_key TEXT NOT NULL,
  expires_at        TIMESTAMP NOT NULL,
  delivered         BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW()
);
