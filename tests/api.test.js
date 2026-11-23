import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { createGuestsHandlers, GET as defaultGuestsGET } from '../api/guests.js';
import { createRsvpsHandlers, GET as defaultGET } from '../api/rsvps.js';
import { ensureSchema } from '../lib/db.js';
import {
  ALL_STOP_INDICES,
  QUEST_STOPS,
  LAST_STOP,
  buildBachSchedule,
  buildBachScheduleFromStops,
  resolveSelectedStops
} from '../lib/quest-stops.js';
import { INITIAL_GUESTS } from '../lib/seed-guests.js';
import { ValidationError, normalizeGuestPayload, normalizeRsvpPayload, slugifyGuestName } from '../lib/validation.js';

function createInMemorySql(initialRows = [], initialGuests = []) {
  let nextId = initialRows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  let nextGuestId = initialGuests.reduce((max, g) => Math.max(max, g.id), 0) + 1;
  const rows = initialRows.map((r) => ({ ...r }));
  const guestRows = initialGuests.map((g) => ({ ...g }));
  const meta = new Map();

  function sql(strings, ...values) {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();

    if (
      query.startsWith('CREATE TABLE IF NOT EXISTS rsvps') ||
      query.startsWith('ALTER TABLE rsvps') ||
      query.startsWith('CREATE TABLE IF NOT EXISTS guests') ||
      query.startsWith('CREATE TABLE IF NOT EXISTS app_meta')
    ) {
      return Promise.resolve([]);
    }

    if (query.startsWith("SELECT value FROM app_meta WHERE key = 'guests_seeded_v1'")) {
      const val = meta.get('guests_seeded_v1');
      return Promise.resolve(val !== undefined ? [{ value: val }] : []);
    }

    if (query.startsWith('SELECT COUNT(*)::int AS count FROM guests')) {
      return Promise.resolve([{ count: guestRows.length }]);
    }

    if (query.includes('FROM jsonb_to_recordset(?::jsonb)')) {
      const records = JSON.parse(values[0]);
      const now = new Date().toISOString();
      for (const rec of records) {
        if (!guestRows.some((g) => g.slug === rec.slug)) {
          guestRows.push({
            id: nextGuestId++,
            slug: rec.slug,
            name: rec.name,
            email: '',
            phone: '',
            party_group: '',
            wedding_invited: Boolean(rec.wedding_invited),
            wedding_plus_one: Boolean(rec.wedding_plus_one),
            bach_invited: Boolean(rec.bach_invited),
            bach_plus_one: Boolean(rec.bach_plus_one),
            notes: '',
            created_at: now,
            updated_at: now
          });
        }
      }
      return Promise.resolve([]);
    }

    if (query.startsWith('INSERT INTO app_meta')) {
      if (!meta.has('guests_seeded_v1')) {
        meta.set('guests_seeded_v1', 'true');
      }
      return Promise.resolve([]);
    }

    if (query.startsWith('SELECT') && query.includes('FROM rsvps')) {
      let result = [...rows];
      if (query.includes('WHERE event = ?')) {
        const event = values[0];
        result = result.filter((r) => r.event === event);
      }
      result.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at) || b.id - a.id);
      return Promise.resolve(result.map((r) => ({ ...r })));
    }

    if (query.startsWith('INSERT INTO rsvps')) {
      const [
        event,
        guest_slug,
        name,
        email,
        attending,
        plus_one,
        plus_one_name,
        solo_ack,
        arrive_idx,
        depart_idx,
        selected_stops,
        arrive_at,
        depart_after,
        schedule,
        notes,
        source
      ] = values;

      const now = new Date().toISOString();
      const existing = rows.find((r) => r.event === event && r.guest_slug === guest_slug);
      if (existing) {
        Object.assign(existing, {
          name,
          email,
          attending,
          plus_one,
          plus_one_name,
          solo_ack,
          arrive_idx,
          depart_idx,
          selected_stops,
          arrive_at,
          depart_after,
          schedule,
          notes,
          source,
          updated_at: now
        });
        return Promise.resolve([{ ...existing }]);
      }

      const created = {
        id: nextId++,
        event,
        guest_slug,
        name,
        email,
        attending,
        plus_one,
        plus_one_name,
        solo_ack,
        arrive_idx,
        depart_idx,
        selected_stops,
        arrive_at,
        depart_after,
        schedule,
        notes,
        source,
        submitted_at: now,
        updated_at: now
      };
      rows.push(created);
      return Promise.resolve([{ ...created }]);
    }

    if (query.startsWith('UPDATE rsvps r SET guest_slug = ?')) {
      const [newSlug, oldSlug, checkSlug] = values;
      const now = new Date().toISOString();
      for (const r of rows) {
        if (r.guest_slug === oldSlug) {
          const collision = rows.some((r2) => r2.event === r.event && r2.guest_slug === checkSlug);
          if (!collision) {
            r.guest_slug = newSlug;
            r.updated_at = now;
          }
        }
      }
      return Promise.resolve([]);
    }

    if (query.startsWith('UPDATE rsvps')) {
      const [
        event,
        guest_slug,
        name,
        email,
        attending,
        plus_one,
        plus_one_name,
        solo_ack,
        arrive_idx,
        depart_idx,
        selected_stops,
        arrive_at,
        depart_after,
        schedule,
        notes,
        source,
        id
      ] = values;

      const target = rows.find((r) => r.id === id);
      if (!target) return Promise.resolve([]);

      const duplicate = rows.find((r) => r.id !== id && r.event === event && r.guest_slug === guest_slug);
      if (duplicate) {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        return Promise.reject(err);
      }

      Object.assign(target, {
        event,
        guest_slug,
        name,
        email,
        attending,
        plus_one,
        plus_one_name,
        solo_ack,
        arrive_idx,
        depart_idx,
        selected_stops,
        arrive_at,
        depart_after,
        schedule,
        notes,
        source,
        updated_at: new Date().toISOString()
      });
      return Promise.resolve([{ ...target }]);
    }

    if (query.startsWith('DELETE FROM rsvps')) {
      if (query.includes('WHERE guest_slug = ?')) {
        const guest_slug = values[0];
        const removed = [];
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].guest_slug === guest_slug) {
            const [item] = rows.splice(i, 1);
            removed.push({ id: item.id });
          }
        }
        return Promise.resolve(removed.reverse());
      }

      let idx = -1;
      if (query.includes('WHERE id = ?')) {
        const id = values[0];
        idx = rows.findIndex((r) => r.id === id);
      } else if (query.includes('WHERE event = ? AND guest_slug = ?')) {
        const [event, guest_slug] = values;
        idx = rows.findIndex((r) => r.event === event && r.guest_slug === guest_slug);
      }
      if (idx === -1) return Promise.resolve([]);
      const [removed] = rows.splice(idx, 1);
      return Promise.resolve([{ id: removed.id }]);
    }

    if (query.startsWith('SELECT') && query.includes('FROM guests')) {
      let result = [...guestRows];
      if (query.includes('WHERE id = ?')) {
        result = result.filter((g) => g.id === values[0]);
      } else if (query.includes('WHERE slug = ? AND wedding_invited = TRUE')) {
        result = result.filter((g) => g.slug === values[0] && g.wedding_invited);
      } else if (query.includes('WHERE slug = ? AND bach_invited = TRUE')) {
        result = result.filter((g) => g.slug === values[0] && g.bach_invited);
      } else if (query.includes('WHERE slug = ?')) {
        result = result.filter((g) => g.slug === values[0]);
      } else if (query.includes('WHERE wedding_invited = TRUE')) {
        result = result.filter((g) => g.wedding_invited);
      } else if (query.includes('WHERE bach_invited = TRUE')) {
        result = result.filter((g) => g.bach_invited);
      }
      result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id);
      return Promise.resolve(result.map((g) => ({ ...g })));
    }

    if (query.startsWith('INSERT INTO guests')) {
      const [
        slug,
        name,
        email,
        phone,
        party_group,
        wedding_invited,
        wedding_plus_one,
        bach_invited,
        bach_plus_one,
        notes
      ] = values;

      if (guestRows.some((g) => g.slug === slug)) {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        return Promise.reject(err);
      }

      const now = new Date().toISOString();
      const created = {
        id: nextGuestId++,
        slug,
        name,
        email,
        phone,
        party_group,
        wedding_invited,
        wedding_plus_one,
        bach_invited,
        bach_plus_one,
        notes,
        created_at: now,
        updated_at: now
      };
      guestRows.push(created);
      return Promise.resolve([{ ...created }]);
    }

    if (query.startsWith('UPDATE guests')) {
      const [
        slug,
        name,
        email,
        phone,
        party_group,
        wedding_invited,
        wedding_plus_one,
        bach_invited,
        bach_plus_one,
        notes,
        id
      ] = values;

      const target = guestRows.find((g) => g.id === id);
      if (!target) return Promise.resolve([]);

      if (guestRows.some((g) => g.id !== id && g.slug === slug)) {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        return Promise.reject(err);
      }

      Object.assign(target, {
        slug,
        name,
        email,
        phone,
        party_group,
        wedding_invited,
        wedding_plus_one,
        bach_invited,
        bach_plus_one,
        notes,
        updated_at: new Date().toISOString()
      });
      return Promise.resolve([{ ...target }]);
    }

    if (query.startsWith('DELETE FROM guests')) {
      let idx = -1;
      if (query.includes('WHERE id = ?')) {
        idx = guestRows.findIndex((g) => g.id === values[0]);
      } else if (query.includes('WHERE slug = ?')) {
        idx = guestRows.findIndex((g) => g.slug === values[0]);
      }
      if (idx === -1) return Promise.resolve([]);
      const [removed] = guestRows.splice(idx, 1);
      return Promise.resolve([{ id: removed.id, slug: removed.slug, name: removed.name }]);
    }

    return Promise.reject(new Error(`Unsupported test SQL query: ${query}`));
  }

  return sql;
}

test('quest-stops exports 7 stops and builds schedules accurately', () => {
  assert.equal(QUEST_STOPS.length, 7);
  assert.equal(LAST_STOP, 6);
  assert.equal(buildBachSchedule(0, 6).schedule, 'Full Weekend');
  assert.deepEqual(buildBachSchedule(2, 5), {
    arriveIdx: 2,
    departIdx: 5,
    arriveAt: 'Fri 6 PM · Tournament of Kings',
    departAfter: 'Sat Night · Club Crawl',
    schedule: 'Fri 6 PM · Tournament of Kings to Sat Night · Club Crawl'
  });
});

test('quest-stops builds à la carte schedules and resolves legacy records', () => {
  assert.deepEqual(ALL_STOP_INDICES, [0, 1, 2, 3, 4, 5, 6]);

  assert.deepEqual(buildBachScheduleFromStops(ALL_STOP_INDICES), {
    selectedStops: [0, 1, 2, 3, 4, 5, 6],
    arriveIdx: 0,
    departIdx: 6,
    arriveAt: 'Fri 2 PM · Arrival & Crowns',
    departAfter: 'Sun AM · Café & Farewells',
    schedule: 'Full Weekend'
  });

  assert.deepEqual(buildBachScheduleFromStops([5, 0, 2, 2]), {
    selectedStops: [0, 2, 5],
    arriveIdx: 0,
    departIdx: 5,
    arriveAt: 'Fri 2 PM · Arrival & Crowns',
    departAfter: 'Sat Night · Club Crawl',
    schedule: 'Arrival & Crowns, Tournament of Kings, Club Crawl'
  });

  assert.deepEqual(buildBachScheduleFromStops([3]), {
    selectedStops: [3],
    arriveIdx: 3,
    departIdx: 3,
    arriveAt: 'Sat Day · D&D One-Shot',
    departAfter: 'Sat Day · D&D One-Shot',
    schedule: 'D&D One-Shot'
  });

  assert.deepEqual(resolveSelectedStops({ attending: 'yes', selected_stops: [5, 1, 3, 1] }), [1, 3, 5]);
  assert.deepEqual(resolveSelectedStops({ attending: 'yes', selected_stops: null, arrive_idx: 2, depart_idx: 4 }), [2, 3, 4]);
  assert.deepEqual(resolveSelectedStops({ attending: 'yes', selected_stops: null }), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(resolveSelectedStops({ attending: 'no', selected_stops: [0, 1] }), []);
});

test('slugifyGuestName handles apostrophes, diacritics, and spacing', () => {
  assert.equal(slugifyGuestName("A'Mari Metoyer"), 'amari-metoyer');
  assert.equal(slugifyGuestName('  José Álvarez  '), 'jose-alvarez');
});

test('normalizeRsvpPayload validates wedding +1, soloAck, and declined cleanup', () => {
  const plusOne = normalizeRsvpPayload({
    event: 'wedding',
    guest: 'Tori-Watson',
    name: 'Tori Watson',
    email: 'tori@example.com',
    attending: 'yes',
    plusOne: 'yes',
    plusOneName: 'Marcus Reed',
    soloAck: true,
    notes: 'Vegetarian for Marcus'
  });
  assert.equal(plusOne.guest_slug, 'tori-watson');
  assert.equal(plusOne.plus_one, true);
  assert.equal(plusOne.plus_one_name, 'Marcus Reed');
  assert.equal(plusOne.solo_ack, false);

  const solo = normalizeRsvpPayload({
    guest: 'olivia-el-bard',
    name: 'Olivia El Bard',
    email: 'olivia@example.com',
    attending: 'yes',
    plusOne: 'no',
    soloAck: true
  });
  assert.equal(solo.event, 'wedding');
  assert.equal(solo.plus_one, false);
  assert.equal(solo.solo_ack, true);

  const declined = normalizeRsvpPayload({
    event: 'wedding',
    guest: 'joel-ruud',
    name: 'Joel Ruud',
    email: 'joel@example.com',
    attending: 'no',
    plusOne: 'yes',
    plusOneName: 'Guest',
    soloAck: true
  });
  assert.equal(declined.plus_one, false);
  assert.equal(declined.plus_one_name, '');
  assert.equal(declined.solo_ack, false);
});

test('normalizeRsvpPayload validates bach à la carte events, legacy ranges, and defaults', () => {
  const full = normalizeRsvpPayload({
    event: 'bach',
    guest: 'tug',
    name: 'Tug',
    email: 'tug@example.com',
    attending: 'yes'
  });
  assert.deepEqual(full.selected_stops, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(full.arrive_idx, 0);
  assert.equal(full.depart_idx, 6);
  assert.equal(full.schedule, 'Full Weekend');

  const alaCarte = normalizeRsvpPayload({
    event: 'bach',
    guest: 'patrick-egbert',
    name: 'Patrick Egbert',
    email: 'patrick@example.com',
    attending: 'yes',
    selectedStops: [6, 0, 4, 2, 4]
  });
  assert.deepEqual(alaCarte.selected_stops, [0, 2, 4, 6]);
  assert.equal(alaCarte.arrive_idx, 0);
  assert.equal(alaCarte.depart_idx, 6);
  assert.equal(alaCarte.schedule, 'Arrival & Crowns, Tournament of Kings, Group Dinner, Café & Farewells');

  const partial = normalizeRsvpPayload({
    event: 'bach',
    guest: 'victoria-yu',
    name: 'Victoria Yu',
    email: 'victoria@example.com',
    attending: 'yes',
    arriveIdx: 2,
    departIdx: 5
  });
  assert.deepEqual(partial.selected_stops, [2, 3, 4, 5]);
  assert.equal(partial.arrive_idx, 2);
  assert.equal(partial.depart_idx, 5);
  assert.equal(partial.arrive_at, 'Fri 6 PM · Tournament of Kings');
  assert.equal(partial.depart_after, 'Sat Night · Club Crawl');

  for (const badStops of [[], [7], [-1], 'all', [true], ['']]) {
    assert.throws(
      () =>
        normalizeRsvpPayload({
          event: 'bach',
          guest: 'victoria-yu',
          name: 'Victoria Yu',
          email: 'victoria@example.com',
          attending: 'yes',
          selectedStops: badStops
        }),
      ValidationError
    );
  }

  assert.throws(
    () =>
      normalizeRsvpPayload({
        event: 'bach',
        guest: 'victoria-yu',
        name: 'Victoria Yu',
        email: 'victoria@example.com',
        attending: 'yes',
        arriveIdx: 5,
        departIdx: 2
      }),
    ValidationError
  );

  assert.throws(
    () =>
      normalizeRsvpPayload({
        event: 'bach',
        guest: 'victoria-yu',
        name: 'Victoria Yu',
        email: 'victoria@example.com',
        attending: 'yes',
        arriveIdx: 0,
        departIdx: 7
      }),
    ValidationError
  );

  const declinedBach = normalizeRsvpPayload({
    event: 'bach',
    guest: 'jeremy',
    name: 'Jeremy',
    email: 'jeremy@example.com',
    attending: 'no',
    selectedStops: [0, 2, 5],
    arriveIdx: 1,
    departIdx: 4
  });
  assert.equal(declinedBach.selected_stops, null);
  assert.equal(declinedBach.arrive_idx, null);
  assert.equal(declinedBach.depart_idx, null);
  assert.equal(declinedBach.schedule, '');

  const weddingRsvp = normalizeRsvpPayload({
    event: 'wedding',
    guest: 'tori-watson',
    name: 'Tori Watson',
    email: 'tori@example.com',
    attending: 'yes',
    selectedStops: [0, 1]
  });
  assert.equal(weddingRsvp.selected_stops, null);
});

test('normalizeRsvpPayload allows optional email and auto-slug for admin source', () => {
  assert.throws(
    () =>
      normalizeRsvpPayload({
        event: 'wedding',
        guest: 'grandma-randel',
        name: 'Grandma Randel',
        email: '',
        attending: 'yes',
        source: 'form'
      }),
    ValidationError
  );

  const adminRecord = normalizeRsvpPayload({
    event: 'wedding',
    name: 'Uncle Bob',
    email: '',
    attending: 'yes',
    source: 'admin'
  });
  assert.equal(adminRecord.guest_slug, 'uncle-bob');
  assert.equal(adminRecord.email, '');
  assert.equal(adminRecord.source, 'admin');

  assert.throws(
    () =>
      normalizeRsvpPayload({
        event: 'wedding',
        name: 'Uncle Bob',
        email: 'not-an-email',
        attending: 'yes',
        source: 'admin'
      }),
    ValidationError
  );
});

test('API handlers support full CRUD, upsert deduplication, conflict 409, and filtering', async () => {
  const sql = createInMemorySql();
  const { GET, POST, PUT, DELETE } = createRsvpsHandlers({
    getSql: () => sql,
    ensureSchema: async () => {}
  });

  // 1. Empty GET
  const emptyRes = await GET(new Request('http://localhost/api/rsvps'));
  assert.equal(emptyRes.status, 200);
  const emptyData = await emptyRes.json();
  assert.equal(emptyData.ok, true);
  assert.deepEqual(emptyData.rsvps, []);

  // 2. POST Wedding RSVP
  const postWedding = await POST(
    new Request('http://localhost/api/rsvps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'wedding',
        guest: 'tori-watson',
        name: 'Tori Watson',
        email: 'tori@example.com',
        attending: 'yes',
        plusOne: 'yes',
        plusOneName: 'Marcus',
        notes: 'Veg'
      })
    })
  );
  assert.equal(postWedding.status, 200);
  const weddingCreated = (await postWedding.json()).rsvp;
  assert.equal(weddingCreated.id, 1);

  // 3. Duplicate POST upserts in place
  const postUpsert = await POST(
    new Request('http://localhost/api/rsvps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'wedding',
        guest: 'tori-watson',
        name: 'Tori Watson',
        email: 'tori@example.com',
        attending: 'yes',
        plusOne: 'yes',
        plusOneName: 'Marcus Reed',
        notes: 'Vegan'
      })
    })
  );
  const upserted = (await postUpsert.json()).rsvp;
  assert.equal(upserted.id, 1);
  assert.equal(upserted.plus_one_name, 'Marcus Reed');

  // 4. POST Bach RSVP with non-contiguous à la carte events
  const postBach = await POST(
    new Request('http://localhost/api/rsvps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'bach',
        guest: 'victoria-yu',
        name: 'Victoria Yu',
        email: 'victoria@example.com',
        attending: 'yes',
        selectedStops: [0, 2, 4, 6]
      })
    })
  );
  assert.equal(postBach.status, 200);
  const bachCreated = (await postBach.json()).rsvp;
  assert.equal(bachCreated.id, 2);
  assert.deepEqual(bachCreated.selected_stops, [0, 2, 4, 6]);

  // 5. Filtered GET
  const bachListRes = await GET(new Request('http://localhost/api/rsvps?event=bach'));
  const bachList = (await bachListRes.json()).rsvps;
  assert.equal(bachList.length, 1);
  assert.equal(bachList[0].guest_slug, 'victoria-yu');
  assert.deepEqual(bachList[0].selected_stops, [0, 2, 4, 6]);

  // 6. Invalid event query
  const badEventRes = await GET(new Request('http://localhost/api/rsvps?event=rehearsal'));
  assert.equal(badEventRes.status, 400);

  // 7. PUT update with non-contiguous selectedStops
  const putRes = await PUT(
    new Request('http://localhost/api/rsvps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 2,
        event: 'bach',
        guest: 'victoria-yu',
        name: 'Victoria Yu',
        email: 'victoria@example.com',
        attending: 'yes',
        selectedStops: [1, 3, 5],
        notes: 'Updated events!'
      })
    })
  );
  assert.equal(putRes.status, 200);
  const updated = (await putRes.json()).rsvp;
  assert.deepEqual(updated.selected_stops, [1, 3, 5]);
  assert.equal(updated.arrive_idx, 1);
  assert.equal(updated.depart_idx, 5);
  assert.equal(updated.notes, 'Updated events!');

  // 8. PUT 409 conflict when colliding with existing (event, guest_slug)
  const conflictRes = await PUT(
    new Request('http://localhost/api/rsvps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 2,
        event: 'wedding',
        guest: 'tori-watson',
        name: 'Tori Watson',
        attending: 'yes'
      })
    })
  );
  assert.equal(conflictRes.status, 409);

  // 9. PUT 404 missing
  const missingPut = await PUT(
    new Request('http://localhost/api/rsvps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 999,
        event: 'wedding',
        guest: 'nobody',
        name: 'Nobody',
        attending: 'no'
      })
    })
  );
  assert.equal(missingPut.status, 404);

  // 10. DELETE by query id + 404 on second delete
  const delRes = await DELETE(new Request('http://localhost/api/rsvps?id=1', { method: 'DELETE' }));
  assert.equal(delRes.status, 200);
  assert.equal((await delRes.json()).deletedId, 1);

  const delMissing = await DELETE(new Request('http://localhost/api/rsvps?id=1', { method: 'DELETE' }));
  assert.equal(delMissing.status, 404);
});

test('Default GET returns 503 DB_NOT_CONFIGURED when DATABASE_URL is missing', async () => {
  const prevDbUrl = process.env.DATABASE_URL;
  const prevPgUrl = process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;

  try {
    const res = await defaultGET(new Request('http://localhost/api/rsvps'));
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.code, 'DB_NOT_CONFIGURED');
  } finally {
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
    if (prevPgUrl !== undefined) process.env.POSTGRES_URL = prevPgUrl;
  }
});

test('INITIAL_GUESTS defines 42 unique valid wedding and 17 bach seed records', () => {
  assert.equal(INITIAL_GUESTS.length, 42);

  const seenSlugs = new Set();
  for (const guest of INITIAL_GUESTS) {
    assert.equal(seenSlugs.has(guest.slug), false, `Duplicate seed slug: ${guest.slug}`);
    seenSlugs.add(guest.slug);

    const normalized = normalizeGuestPayload(guest);
    assert.equal(normalized.slug, guest.slug);
    assert.equal(normalized.name, guest.name);
    assert.equal(normalized.wedding_invited, true);
    assert.equal(normalized.wedding_plus_one, guest.wedding_plus_one);
    assert.equal(normalized.bach_invited, guest.bach_invited);
    assert.equal(normalized.bach_plus_one, guest.bach_plus_one);
  }

  const bachGuests = INITIAL_GUESTS.filter((g) => g.bach_invited);
  assert.equal(bachGuests.length, 17);
  assert.equal(bachGuests.every((g) => g.bach_plus_one === true), true);
});

test('static guest JSON files are removed and frontend pages use DB-only lookups', async () => {
  await assert.rejects(
    () => fs.access(new URL('../public/guests.json', import.meta.url)),
    { code: 'ENOENT' }
  );
  await assert.rejects(
    () => fs.access(new URL('../public/bach-guests.json', import.meta.url)),
    { code: 'ENOENT' }
  );

  const htmlFiles = ['../public/rsvp.html', '../public/bach.html', '../public/admin.html'];
  for (const relPath of htmlFiles) {
    const html = await fs.readFile(new URL(relPath, import.meta.url), 'utf8');
    assert.equal(html.includes('guests.json'), false, `${relPath} should not reference guests.json`);
    assert.equal(html.includes('bach-guests.json'), false, `${relPath} should not reference bach-guests.json`);
  }
});

test('vercel.json configures rewrites for /admin, /rsvp/:guest, and /bach/:guest', async () => {
  const raw = await fs.readFile(new URL('../vercel.json', import.meta.url), 'utf8');
  const config = JSON.parse(raw);

  assert.deepEqual(config.rewrites, [
    { source: '/admin', destination: '/admin.html' },
    { source: '/rsvp', destination: '/rsvp.html' },
    { source: '/rsvp/:guest', destination: '/rsvp.html' },
    { source: '/bach', destination: '/bach.html' },
    { source: '/bach/:guest', destination: '/bach.html' }
  ]);
});

test('normalizeGuestPayload validates slugs, emails, defaults, and +1 coupling', () => {
  const minimal = normalizeGuestPayload({ name: "A'Mari Metoyer" });
  assert.equal(minimal.slug, 'amari-metoyer');
  assert.equal(minimal.wedding_invited, true);
  assert.equal(minimal.wedding_plus_one, false);
  assert.equal(minimal.bach_invited, false);
  assert.equal(minimal.bach_plus_one, false);

  const clearedPlusOnes = normalizeGuestPayload({
    name: 'Test Guest',
    slug: 'test_guest-1',
    email: 'test@example.com',
    phone: '555-0100',
    partyGroup: 'Friends',
    weddingInvited: false,
    weddingPlusOne: true,
    bachInvited: false,
    bachPlusOne: true,
    notes: 'VIP'
  });
  assert.equal(clearedPlusOnes.wedding_invited, false);
  assert.equal(clearedPlusOnes.wedding_plus_one, false);
  assert.equal(clearedPlusOnes.bach_invited, false);
  assert.equal(clearedPlusOnes.bach_plus_one, false);
  assert.equal(clearedPlusOnes.party_group, 'Friends');

  const bachDefaultPlusOne = normalizeGuestPayload({
    name: 'Bach Pal',
    wedding_invited: false,
    bach_invited: true
  });
  assert.equal(bachDefaultPlusOne.bach_invited, true);
  assert.equal(bachDefaultPlusOne.bach_plus_one, true);

  assert.throws(
    () => normalizeGuestPayload({ name: 'Bad Slug', slug: 'bad slug!' }),
    ValidationError
  );
  assert.throws(
    () => normalizeGuestPayload({ name: 'Bad Email', email: 'invalid-email' }),
    ValidationError
  );
  assert.throws(
    () => normalizeGuestPayload({ name: 'Bad Flag', wedding_invited: 'maybe' }),
    ValidationError
  );
});

test('ensureSchema seeds 42 guests once and does not re-seed after deletion', async () => {
  const sql = createInMemorySql();
  await ensureSchema(sql);

  const afterFirst = await sql`SELECT * FROM guests`;
  assert.equal(afterFirst.length, 42);

  // Delete all guests and call ensureSchema with a fresh sql wrapper sharing the same underlying store?
  // Note: schemaPromises caches per sql function reference, so test both deleting all guests and bypassing cache:
  for (const row of afterFirst) {
    await sql`DELETE FROM guests WHERE id = ${row.id}`;
  }
  assert.equal((await sql`SELECT * FROM guests`).length, 0);

  // Simulate a new serverless cold start against the same database (new sql function sharing meta/guestRows is tested via flag):
  const metaRows = await sql`SELECT value FROM app_meta WHERE key = 'guests_seeded_v1'`;
  assert.deepEqual(metaRows, [{ value: 'true' }]);
});

test('ensureSchema skips re-seeding on a new cold-start client once guests_seeded_v1 is recorded', async () => {
  const backingSql = createInMemorySql();
  const coldStart1 = (strings, ...values) => backingSql(strings, ...values);
  const coldStart2 = (strings, ...values) => backingSql(strings, ...values);

  await ensureSchema(coldStart1);
  const seeded = await backingSql`SELECT * FROM guests`;
  assert.equal(seeded.length, 42);

  for (const g of seeded) {
    await backingSql`DELETE FROM guests WHERE id = ${g.id}`;
  }
  assert.equal((await backingSql`SELECT * FROM guests`).length, 0);

  await ensureSchema(coldStart2);
  assert.equal((await backingSql`SELECT * FROM guests`).length, 0);
});

test('Guests API supports full CRUD, event filtering, public privacy, PATCH defaults, slug cascade, and delete options', async () => {
  const sql = createInMemorySql(
    [
      {
        id: 1,
        event: 'wedding',
        guest_slug: 'alice-smith',
        name: 'Alice Smith',
        email: 'alice@example.com',
        attending: 'yes',
        plus_one: false,
        plus_one_name: '',
        solo_ack: true,
        arrive_idx: null,
        depart_idx: null,
        selected_stops: null,
        arrive_at: '',
        depart_after: '',
        schedule: '',
        notes: 'Vegan',
        source: 'form',
        submitted_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 2,
        event: 'wedding',
        guest_slug: 'alice-new',
        name: 'Colliding Record',
        email: 'collide@example.com',
        attending: 'no',
        plus_one: false,
        plus_one_name: '',
        solo_ack: false,
        arrive_idx: null,
        depart_idx: null,
        selected_stops: null,
        arrive_at: '',
        depart_after: '',
        schedule: '',
        notes: '',
        source: 'admin',
        submitted_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 3,
        event: 'bach',
        guest_slug: 'alice-smith',
        name: 'Alice Smith',
        email: 'alice@example.com',
        attending: 'yes',
        plus_one: false,
        plus_one_name: '',
        solo_ack: false,
        arrive_idx: 0,
        depart_idx: 6,
        selected_stops: [0, 1, 2, 3, 4, 5, 6],
        arrive_at: 'Fri 2 PM · Arrival & Crowns',
        depart_after: 'Sun AM · Café & Farewells',
        schedule: 'Full Weekend',
        notes: '',
        source: 'form',
        submitted_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    ],
    [
      {
        id: 10,
        slug: 'tori-watson',
        name: 'Tori Watson',
        email: 'tori-private@example.com',
        phone: '555-9999',
        party_group: 'College',
        wedding_invited: true,
        wedding_plus_one: true,
        bach_invited: true,
        bach_plus_one: true,
        notes: 'Private admin note',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 11,
        slug: 'olivia-el-bard',
        name: 'Olivia El Bard',
        email: 'olivia@example.com',
        phone: '',
        party_group: 'Family',
        wedding_invited: true,
        wedding_plus_one: false,
        bach_invited: false,
        bach_plus_one: false,
        notes: '',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    ]
  );

  const { GET, POST, PUT, PATCH, DELETE } = createGuestsHandlers({
    getSql: () => sql,
    ensureSchema: async () => {}
  });
  const rsvpHandlers = createRsvpsHandlers({
    getSql: () => sql,
    ensureSchema: async () => {}
  });

  // 1. List all and event-filtered guests
  const allRes = await GET(new Request('http://localhost/api/guests'));
  assert.equal(allRes.status, 200);
  assert.equal((await allRes.json()).guests.length, 2);

  const bachOnly = await GET(new Request('http://localhost/api/guests?event=bach'));
  assert.equal(bachOnly.status, 200);
  const bachList = (await bachOnly.json()).guests;
  assert.equal(bachList.length, 1);
  assert.equal(bachList[0].slug, 'tori-watson');

  const badEvent = await GET(new Request('http://localhost/api/guests?event=dinner'));
  assert.equal(badEvent.status, 400);

  // 2. Public invite lookup returns minimal payload and enforces event eligibility
  const publicLookup = await GET(new Request('http://localhost/api/guests?event=wedding&guest=tori-watson'));
  assert.equal(publicLookup.status, 200);
  const publicData = await publicLookup.json();
  assert.deepEqual(publicData.guest, { slug: 'tori-watson', name: 'Tori Watson', plusOne: true });
  assert.equal(publicData.guest.email, undefined);
  assert.equal(publicData.guest.phone, undefined);
  assert.equal(publicData.guest.notes, undefined);
  assert.equal(publicData.guest.party_group, undefined);

  const uninvitedLookup = await GET(new Request('http://localhost/api/guests?event=bach&guest=olivia-el-bard'));
  assert.equal(uninvitedLookup.status, 404);

  // 3. POST creates guest (201) and rejects duplicate slug (409)
  const createRes = await POST(
    new Request('http://localhost/api/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Smith',
        email: 'alice@example.com',
        phone: '555-1234',
        party_group: 'Friends',
        wedding_invited: true,
        wedding_plus_one: false,
        bach_invited: false,
        notes: 'Prefers vegetarian'
      })
    })
  );
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()).guest;
  assert.equal(created.slug, 'alice-smith');
  assert.equal(created.party_group, 'Friends');

  const dupRes = await POST(
    new Request('http://localhost/api/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Another Alice', slug: 'alice-smith' })
    })
  );
  assert.equal(dupRes.status, 409);

  // 4. PATCH toggles bach_invited -> auto-enables bach_plus_one unless specified
  const patchRes = await PATCH(
    new Request('http://localhost/api/guests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.id, bach_invited: true })
    })
  );
  assert.equal(patchRes.status, 200);
  const patched = (await patchRes.json()).guest;
  assert.equal(patched.bach_invited, true);
  assert.equal(patched.bach_plus_one, true);

  // 5. PUT updates guest + cascades slug rename safely (updates non-colliding bach RSVP, preserves colliding wedding RSVP)
  const putRes = await PUT(
    new Request('http://localhost/api/guests', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: created.id,
        slug: 'alice-new',
        name: 'Alice New',
        email: 'alice.new@example.com',
        phone: '555-5678',
        party_group: 'VIP',
        wedding_invited: true,
        wedding_plus_one: true,
        bach_invited: true,
        bach_plus_one: false,
        notes: 'Updated setup'
      })
    })
  );
  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.equal(putData.slugChanged, true);
  assert.equal(putData.guest.slug, 'alice-new');
  assert.equal(putData.guest.bach_plus_one, false);

  const rsvpsAfterRename = (await (await rsvpHandlers.GET(new Request('http://localhost/api/rsvps'))).json()).rsvps;
  assert.equal(rsvpsAfterRename.find((r) => r.id === 3).guest_slug, 'alice-new');
  assert.equal(rsvpsAfterRename.find((r) => r.id === 1).guest_slug, 'alice-smith');

  const putMissing = await PUT(
    new Request('http://localhost/api/guests', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 9999, name: 'Nobody', slug: 'nobody' })
    })
  );
  assert.equal(putMissing.status, 404);

  const putConflict = await PUT(
    new Request('http://localhost/api/guests', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.id, name: 'Tori', slug: 'tori-watson' })
    })
  );
  assert.equal(putConflict.status, 409);

  // 6. DELETE with deleteRsvps=false preserves RSVPs, deleteRsvps=true removes matching RSVPs
  const delPreserveRes = await DELETE(new Request('http://localhost/api/guests?id=11&deleteRsvps=false', { method: 'DELETE' }));
  assert.equal(delPreserveRes.status, 200);
  assert.deepEqual((await delPreserveRes.json()).deletedRsvpIds, []);

  const delCascadeRes = await DELETE(
    new Request(`http://localhost/api/guests?id=${created.id}&deleteRsvps=true`, { method: 'DELETE' })
  );
  assert.equal(delCascadeRes.status, 200);
  const delCascadeData = await delCascadeRes.json();
  assert.deepEqual(delCascadeData.deletedRsvpIds.sort((a, b) => a - b), [2, 3]);

  const delMissing = await DELETE(new Request(`http://localhost/api/guests?id=${created.id}`, { method: 'DELETE' }));
  assert.equal(delMissing.status, 404);
});

test('Default Guests GET returns 503 DB_NOT_CONFIGURED when DATABASE_URL is missing', async () => {
  const prevDbUrl = process.env.DATABASE_URL;
  const prevPgUrl = process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;

  try {
    const res = await defaultGuestsGET(new Request('http://localhost/api/guests'));
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.code, 'DB_NOT_CONFIGURED');
  } finally {
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
    if (prevPgUrl !== undefined) process.env.POSTGRES_URL = prevPgUrl;
  }
});
