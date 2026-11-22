import { neon } from '@neondatabase/serverless';

export class DbNotConfiguredError extends Error {
  constructor(message = 'Database not configured. Connect Neon Postgres in Vercel Storage or set DATABASE_URL.') {
    super(message);
    this.name = 'DbNotConfiguredError';
    this.status = 503;
    this.code = 'DB_NOT_CONFIGURED';
  }
}

const sqlCache = new Map();
const schemaPromises = new WeakMap();

export function getSql() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new DbNotConfiguredError();
  }
  let client = sqlCache.get(connectionString);
  if (!client) {
    client = neon(connectionString);
    sqlCache.set(connectionString, client);
  }
  return client;
}

export async function ensureSchema(sql) {
  let promise = schemaPromises.get(sql);
  if (!promise) {
    promise = sql`
      CREATE TABLE IF NOT EXISTS rsvps (
        id SERIAL PRIMARY KEY,
        event TEXT NOT NULL CHECK (event IN ('wedding', 'bach')),
        guest_slug TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        attending TEXT NOT NULL CHECK (attending IN ('yes', 'no')),
        plus_one BOOLEAN NOT NULL DEFAULT FALSE,
        plus_one_name TEXT NOT NULL DEFAULT '',
        solo_ack BOOLEAN NOT NULL DEFAULT FALSE,
        arrive_idx SMALLINT,
        depart_idx SMALLINT,
        arrive_at TEXT NOT NULL DEFAULT '',
        depart_after TEXT NOT NULL DEFAULT '',
        schedule TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'admin')),
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (event, guest_slug)
      )
    `.catch((err) => {
      schemaPromises.delete(sql);
      throw err;
    });
    schemaPromises.set(sql, promise);
  }
  return promise;
}
