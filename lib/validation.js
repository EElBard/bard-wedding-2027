import { ALL_STOP_INDICES, LAST_STOP, buildBachScheduleFromStops } from './quest-stops.js';

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

  let selected_stops = null;
  let arrive_idx = null;
  let depart_idx = null;
  let arrive_at = '';
  let depart_after = '';
  let schedule = '';

  if (event === 'bach' && attending === 'yes') {
    const rawSelectedStops = body.selected_stops ?? body.selectedStops;
    const rawArrive = body.arrive_idx ?? body.arriveIdx;
    const rawDepart = body.depart_idx ?? body.departIdx;
    const hasLegacyRange =
      (rawArrive !== undefined && rawArrive !== null && rawArrive !== '') ||
      (rawDepart !== undefined && rawDepart !== null && rawDepart !== '');

    let built;
    if (rawSelectedStops !== undefined && rawSelectedStops !== null) {
      if (!Array.isArray(rawSelectedStops)) {
        throw new ValidationError('Selected events must be an array of stop indices.');
      }
      const parsed = rawSelectedStops.map((raw) => {
        if (
          raw === '' ||
          raw === null ||
          raw === undefined ||
          typeof raw === 'boolean' ||
          (typeof raw === 'string' && raw.trim() === '')
        ) {
          throw new ValidationError(`Selected event index must be an integer between 0 and ${LAST_STOP}.`);
        }
        const num = Number(raw);
        if (!Number.isInteger(num) || num < 0 || num > LAST_STOP) {
          throw new ValidationError(`Selected event index must be an integer between 0 and ${LAST_STOP}.`);
        }
        return num;
      });
      const uniqueSorted = [...new Set(parsed)].sort((a, b) => a - b);
      if (uniqueSorted.length === 0) {
        throw new ValidationError('Please select at least one event to attend.');
      }
      built = buildBachScheduleFromStops(uniqueSorted);
    } else if (hasLegacyRange) {
      const a = parseStopIndex(rawArrive, 0, 'Arrival');
      const d = parseStopIndex(rawDepart, LAST_STOP, 'Departure');
      if (a > d) {
        throw new ValidationError('Arrival stop cannot be after departure stop.');
      }
      const rangeStops = [];
      for (let i = a; i <= d; i += 1) {
        rangeStops.push(i);
      }
      built = buildBachScheduleFromStops(rangeStops);
    } else {
      built = buildBachScheduleFromStops(ALL_STOP_INDICES);
    }

    selected_stops = built.selectedStops;
    arrive_idx = built.arriveIdx;
    depart_idx = built.departIdx;
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
    selected_stops,
    arrive_idx,
    depart_idx,
    arrive_at,
    depart_after,
    schedule,
    notes,
    source
  };
}

function parseBoolean(raw, fallback, label) {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  }
  throw new ValidationError(`${label} must be a boolean.`);
}

export function normalizeGuestPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  const name = String(body.name ?? '').trim();
  if (!name) {
    throw new ValidationError('Guest name is required.');
  }
  if (name.length > 120) {
    throw new ValidationError('Guest name must be 120 characters or fewer.');
  }

  const rawSlug = String(body.slug ?? body.guest_slug ?? body.guestSlug ?? '')
    .trim()
    .toLowerCase();
  const slug = rawSlug || slugifyGuestName(name);
  if (!slug) {
    throw new ValidationError('Guest link slug is required.');
  }
  if (slug.length > 100) {
    throw new ValidationError('Guest link slug must be 100 characters or fewer.');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug)) {
    throw new ValidationError('Guest link slug may only contain lowercase letters, numbers, hyphens, and underscores.');
  }

  const email = String(body.email ?? '').trim();
  if (email.length > 200) {
    throw new ValidationError('Email must be 200 characters or fewer.');
  }
  if (email && (!email.includes('@') || /\s/.test(email) || email.startsWith('@') || email.endsWith('@'))) {
    throw new ValidationError('Please provide a valid email address.');
  }

  const phone = String(body.phone ?? '').trim().slice(0, 40);
  const party_group = String(body.party_group ?? body.partyGroup ?? '').trim().slice(0, 80);

  const wedding_invited = parseBoolean(body.wedding_invited ?? body.weddingInvited, true, 'Wedding invite flag');
  const wedding_plus_one = wedding_invited
    ? parseBoolean(body.wedding_plus_one ?? body.weddingPlusOne, false, 'Wedding +1 flag')
    : false;

  const bach_invited = parseBoolean(body.bach_invited ?? body.bachInvited, false, 'Bach Weekend invite flag');
  const bach_plus_one = bach_invited
    ? parseBoolean(body.bach_plus_one ?? body.bachPlusOne, true, 'Bach Weekend +1 flag')
    : false;

  const notes = String(body.notes ?? '').trim().slice(0, 2000);

  return {
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
  };
}
