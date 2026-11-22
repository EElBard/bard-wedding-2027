import assert from 'node:assert/strict';
import test from 'node:test';

import { createRsvpsHandlers, GET as defaultGET } from '../api/rsvps.js';
import { QUEST_STOPS, LAST_STOP, buildBachSchedule } from '../lib/quest-stops.js';
import { ValidationError, normalizeRsvpPayload, slugifyGuestName } from '../lib/validation.js';

function createInMemorySql(initialRows = []) {
  let nextId = initialRows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const rows = initialRows.map((r) => ({ ...r }));

  function sql(strings, ...values) {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();

    if (query.startsWith('CREATE TABLE IF NOT EXISTS rsvps')) {
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

test('normalizeRsvpPayload validates bach schedule ranges and defaults', () => {
  const full = normalizeRsvpPayload({
    event: 'bach',
    guest: 'tug',
    name: 'Tug',
    email: 'tug@example.com',
    attending: 'yes'
  });
  assert.equal(full.arrive_idx, 0);
  assert.equal(full.depart_idx, 6);
  assert.equal(full.schedule, 'Full Weekend');

  const partial = normalizeRsvpPayload({
    event: 'bach',
    guest: 'victoria-yu',
    name: 'Victoria Yu',
    email: 'victoria@example.com',
    attending: 'yes',
    arriveIdx: 2,
    departIdx: 5
  });
  assert.equal(partial.arrive_idx, 2);
  assert.equal(partial.depart_idx, 5);
  assert.equal(partial.arrive_at, 'Fri 6 PM · Tournament of Kings');
  assert.equal(partial.depart_after, 'Sat Night · Club Crawl');

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
    arriveIdx: 1,
    departIdx: 4
  });
  assert.equal(declinedBach.arrive_idx, null);
  assert.equal(declinedBach.depart_idx, null);
  assert.equal(declinedBach.schedule, '');
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

  // 4. POST Bach RSVP
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
        arriveIdx: 2,
        departIdx: 5
      })
    })
  );
  assert.equal(postBach.status, 200);
  const bachCreated = (await postBach.json()).rsvp;
  assert.equal(bachCreated.id, 2);

  // 5. Filtered GET
  const bachListRes = await GET(new Request('http://localhost/api/rsvps?event=bach'));
  const bachList = (await bachListRes.json()).rsvps;
  assert.equal(bachList.length, 1);
  assert.equal(bachList[0].guest_slug, 'victoria-yu');

  // 6. Invalid event query
  const badEventRes = await GET(new Request('http://localhost/api/rsvps?event=rehearsal'));
  assert.equal(badEventRes.status, 400);

  // 7. PUT update
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
        arriveIdx: 1,
        departIdx: 6,
        notes: 'Coming early!'
      })
    })
  );
  assert.equal(putRes.status, 200);
  const updated = (await putRes.json()).rsvp;
  assert.equal(updated.arrive_idx, 1);
  assert.equal(updated.notes, 'Coming early!');

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
