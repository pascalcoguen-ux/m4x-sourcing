-- M4X Sourcing 2.0 — schéma de la base Cloudflare D1
-- Exécuter une fois : npx wrangler d1 execute m4x-sourcing-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  pass        TEXT NOT NULL,
  salt        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',
  fails       INTEGER NOT NULL DEFAULT 0,
  lock_until  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  expires     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  expires     INTEGER NOT NULL
);

-- Documents de l'application (profils, entreprises, offres, intérêts, messages, paiements, réglages, fichiers)
CREATE TABLE IF NOT EXISTS docs (
  col         TEXT NOT NULL,
  id          TEXT NOT NULL,
  owner       TEXT,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (col, id)
);
CREATE INDEX IF NOT EXISTS docs_owner ON docs(owner);
