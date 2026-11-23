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
);

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
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS selected_stops SMALLINT[];
