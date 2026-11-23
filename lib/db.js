import { neon } from '@neondatabase/serverless';
import { INITIAL_GUESTS } from './seed-guests.js';

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
    promise = (async () => {
      await sql`
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
          selected_stops SMALLINT[],
          arrive_at TEXT NOT NULL DEFAULT '',
          depart_after TEXT NOT NULL DEFAULT '',
          schedule TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'admin')),
          submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (event, guest_slug)
        )
      `;
      await sql`ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS selected_stops SMALLINT[]`;

      await sql`
        CREATE TABLE IF NOT EXISTS guests (
          id SERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          party_group TEXT NOT NULL DEFAULT '',
          wedding_invited BOOLEAN NOT NULL DEFAULT TRUE,
          wedding_plus_one BOOLEAN NOT NULL DEFAULT FALSE,
          bach_invited BOOLEAN NOT NULL DEFAULT FALSE,
          bach_plus_one BOOLEAN NOT NULL DEFAULT TRUE,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      const metaRows = await sql`
        SELECT value FROM app_meta WHERE key = 'guests_seeded_v1'
      `;

      if (metaRows.length === 0) {
        const countRows = await sql`
          SELECT COUNT(*)::int AS count FROM guests
        `;
        if (Number(countRows[0]?.count ?? 0) === 0) {
          await sql`
            INSERT INTO guests (slug, name, wedding_invited, wedding_plus_one, bach_invited, bach_plus_one)
            SELECT slug, name, wedding_invited, wedding_plus_one, bach_invited, bach_plus_one
            FROM jsonb_to_recordset(${JSON.stringify(INITIAL_GUESTS)}::jsonb) AS t(
              slug text,
              name text,
              wedding_invited boolean,
              wedding_plus_one boolean,
              bach_invited boolean,
              bach_plus_one boolean
            )
            ON CONFLICT (slug) DO NOTHING
          `;
        }

        await sql`
          INSERT INTO app_meta (key, value)
          VALUES ('guests_seeded_v1', 'true')
          ON CONFLICT (key) DO NOTHING
        `;
      }
    })().catch((err) => {
      schemaPromises.delete(sql);
      throw err;
    });
    schemaPromises.set(sql, promise);
  }
  return promise;
}
