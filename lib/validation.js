import { LAST_STOP, buildBachSchedule } from './quest-stops.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.code = 'VALIDATION_ERROR';
  }
}

export function slugifyGuestName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function parseStopIndex(raw, fallback, label) {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 0 || num > LAST_STOP) {
    throw new ValidationError(`${label} stop index must be an integer between 0 and ${LAST_STOP}.`);
  }
  return num;
}

export function normalizeRsvpPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  let event;
  if (!body.event || body.event === 'wedding') {
    event = 'wedding';
  } else if (body.event === 'bach') {
    event = 'bach';
  } else {
    throw new ValidationError('Invalid event type. Expected "wedding" or "bach".');
  }

  const source = body.source === 'admin' ? 'admin' : 'form';

  const name = String(body.name ?? '').trim();
  if (!name) {
    throw new ValidationError('Guest name is required.');
  }
  if (name.length > 120) {
    throw new ValidationError('Guest name must be 120 characters or fewer.');
  }

  const rawSlug = String(body.guest_slug ?? body.guestSlug ?? body.guest ?? '')
    .trim()
    .toLowerCase();
  let guest_slug = rawSlug;
  if (!guest_slug && source === 'admin') {
    guest_slug = slugifyGuestName(name);
  }
  if (!guest_slug) {
    throw new ValidationError('Guest slug is required.');
  }
  if (guest_slug.length > 100) {
    throw new ValidationError('Guest slug must be 100 characters or fewer.');
  }

  const email = String(body.email ?? '').trim();
  if (email.length > 200) {
    throw new ValidationError('Email must be 200 characters or fewer.');
  }
  if (source === 'form' && !email) {
    throw new ValidationError('Email is required.');
  }
  if (email && (!email.includes('@') || /\s/.test(email) || email.startsWith('@') || email.endsWith('@'))) {
    throw new ValidationError('Please provide a valid email address.');
  }

  const attending = String(body.attending ?? '').trim().toLowerCase();
  if (attending !== 'yes' && attending !== 'no') {
    throw new ValidationError('Attending must be "yes" or "no".');
  }

  const rawPlusOne = body.plus_one ?? body.plusOne;
  const plus_one = attending === 'yes' && (
    rawPlusOne === true ||
    rawPlusOne === 'yes'
  );

  const plus_one_name = plus_one
    ? String(body.plus_one_name ?? body.plusOneName ?? '').trim().slice(0, 120)
    : '';

  const rawSoloAck = body.solo_ack ?? body.soloAck;
  const solo_ack = event === 'wedding' &&
    attending === 'yes' &&
    !plus_one &&
    (rawSoloAck === true || rawSoloAck === 'true' || rawSoloAck === 'yes');

  let arrive_idx = null;
  let depart_idx = null;
  let arrive_at = '';
  let depart_after = '';
  let schedule = '';

  if (event === 'bach' && attending === 'yes') {
    arrive_idx = parseStopIndex(body.arrive_idx ?? body.arriveIdx, 0, 'Arrival');
    depart_idx = parseStopIndex(body.depart_idx ?? body.departIdx, LAST_STOP, 'Departure');
    if (arrive_idx > depart_idx) {
      throw new ValidationError('Arrival stop cannot be after departure stop.');
    }
    const built = buildBachSchedule(arrive_idx, depart_idx);
    arrive_at = built.arriveAt;
    depart_after = built.departAfter;
    schedule = built.schedule;
  }

  const notes = String(body.notes ?? '').trim().slice(0, 2000);

  return {
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
  };
}
