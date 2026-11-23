import { DbNotConfiguredError, ensureSchema as defaultEnsureSchema, getSql as defaultGetSql } from '../lib/db.js';
import {
  createGuest,
  deleteGuest,
  getGuestById,
  getGuestBySlug,
  listGuests,
  updateGuest
} from '../lib/guests-service.js';
import { ValidationError, normalizeGuestPayload } from '../lib/validation.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function parseJsonBody(request, { allowEmpty = false } = {}) {
  const text = await request.text();
  if (!text.trim()) {
    if (allowEmpty) return null;
    throw new ValidationError('Request body must be valid JSON.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Request body contains malformed JSON.');
  }
}

function parsePositiveId(raw) {
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError('A valid positive integer id is required.');
  }
  return num;
}

function handleError(err) {
  if (err instanceof ValidationError) {
    return jsonResponse({ ok: false, error: err.message, code: err.code }, 400);
  }
  if (err instanceof DbNotConfiguredError) {
    return jsonResponse({ ok: false, error: err.message, code: err.code }, 503);
  }
  if (err && err.code === '23505') {
    return jsonResponse(
      { ok: false, error: 'A guest with this link slug already exists.', code: 'CONFLICT' },
      409
    );
  }
  console.error('Guest API error:', err);
  return jsonResponse({ ok: false, error: 'Internal server error' }, 500);
}

function mergeGuestPatch(existing, body) {
  const merged = {
    slug: existing.slug,
    name: existing.name,
    email: existing.email,
    phone: existing.phone,
    party_group: existing.party_group,
    wedding_invited: Boolean(existing.wedding_invited),
    wedding_plus_one: Boolean(existing.wedding_plus_one),
    bach_invited: Boolean(existing.bach_invited),
    bach_plus_one: Boolean(existing.bach_plus_one),
    notes: existing.notes
  };

  if (Object.hasOwn(body, 'name')) merged.name = body.name;

  if (Object.hasOwn(body, 'slug')) merged.slug = body.slug;
  else if (Object.hasOwn(body, 'guest_slug')) merged.slug = body.guest_slug;
  else if (Object.hasOwn(body, 'guestSlug')) merged.slug = body.guestSlug;

  if (Object.hasOwn(body, 'email')) merged.email = body.email;
  if (Object.hasOwn(body, 'phone')) merged.phone = body.phone;

  if (Object.hasOwn(body, 'party_group')) merged.party_group = body.party_group;
  else if (Object.hasOwn(body, 'partyGroup')) merged.party_group = body.partyGroup;

  if (Object.hasOwn(body, 'wedding_invited')) merged.wedding_invited = body.wedding_invited;
  else if (Object.hasOwn(body, 'weddingInvited')) merged.wedding_invited = body.weddingInvited;

  if (Object.hasOwn(body, 'wedding_plus_one')) merged.wedding_plus_one = body.wedding_plus_one;
  else if (Object.hasOwn(body, 'weddingPlusOne')) merged.wedding_plus_one = body.weddingPlusOne;

  const hasBachInvited = Object.hasOwn(body, 'bach_invited') || Object.hasOwn(body, 'bachInvited');
  if (Object.hasOwn(body, 'bach_invited')) merged.bach_invited = body.bach_invited;
  else if (Object.hasOwn(body, 'bachInvited')) merged.bach_invited = body.bachInvited;

  const hasBachPlusOne = Object.hasOwn(body, 'bach_plus_one') || Object.hasOwn(body, 'bachPlusOne');
  if (Object.hasOwn(body, 'bach_plus_one')) merged.bach_plus_one = body.bach_plus_one;
  else if (Object.hasOwn(body, 'bachPlusOne')) merged.bach_plus_one = body.bachPlusOne;

  if (Object.hasOwn(body, 'notes')) merged.notes = body.notes;

  const normalized = normalizeGuestPayload(merged);

  // Default Bach +1 to true when newly inviting a guest to Bach without explicitly specifying bach_plus_one.
  if (hasBachInvited && !existing.bach_invited && normalized.bach_invited && !hasBachPlusOne) {
    normalized.bach_plus_one = true;
  }

  return normalized;
}

export function createGuestsHandlers({
  getSql = defaultGetSql,
  ensureSchema = defaultEnsureSchema
} = {}) {
  async function getReadySql() {
    const sql = getSql();
    await ensureSchema(sql);
    return sql;
  }

  async function GET(request) {
    try {
      const url = new URL(request.url);
      const eventParam = url.searchParams.get('event');
      if (eventParam && eventParam !== 'wedding' && eventParam !== 'bach') {
        throw new ValidationError('Invalid event query parameter. Expected "wedding" or "bach".');
      }

      const rawSlug = url.searchParams.get('guest') ?? url.searchParams.get('slug') ?? '';
      const slug = rawSlug.trim().toLowerCase();

      const sql = await getReadySql();

      if (slug) {
        const row = await getGuestBySlug(sql, slug, { event: eventParam || undefined });
        if (!row) {
          return jsonResponse({ ok: false, error: 'Guest not found.', code: 'NOT_FOUND' }, 404);
        }

        if (eventParam) {
          return jsonResponse({
            ok: true,
            guest: {
              slug: row.slug,
              name: row.name,
              plusOne: eventParam === 'bach' ? Boolean(row.bach_plus_one) : Boolean(row.wedding_plus_one)
            }
          });
        }

        return jsonResponse({ ok: true, guest: row });
      }

      const guests = await listGuests(sql, { event: eventParam || undefined });
      return jsonResponse({
        ok: true,
        guests,
        serverTime: new Date().toISOString()
      });
    } catch (err) {
      return handleError(err);
    }
  }

  async function POST(request) {
    try {
      const body = await parseJsonBody(request);
      const record = normalizeGuestPayload(body);
      const sql = await getReadySql();
      const guest = await createGuest(sql, record);
      return jsonResponse({ ok: true, guest }, 201);
    } catch (err) {
      return handleError(err);
    }
  }

  async function PUT(request) {
    try {
      const url = new URL(request.url);
      const queryId = url.searchParams.get('id');
      const body = await parseJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('Request body must be a JSON object.');
      }

      const id = parsePositiveId(queryId ?? body.id);
      const record = normalizeGuestPayload(body);
      const sql = await getReadySql();
      const result = await updateGuest(sql, id, record);
      if (!result) {
        return jsonResponse({ ok: false, error: 'Guest not found.', code: 'NOT_FOUND' }, 404);
      }
      return jsonResponse({ ok: true, guest: result.guest, slugChanged: result.slugChanged });
    } catch (err) {
      return handleError(err);
    }
  }

  async function PATCH(request) {
    try {
      const url = new URL(request.url);
      const queryId = url.searchParams.get('id');
      const body = await parseJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('Request body must be a JSON object.');
      }

      const id = parsePositiveId(queryId ?? body.id);
      const sql = await getReadySql();
      const existing = await getGuestById(sql, id);
      if (!existing) {
        return jsonResponse({ ok: false, error: 'Guest not found.', code: 'NOT_FOUND' }, 404);
      }

      const record = mergeGuestPatch(existing, body);
      const result = await updateGuest(sql, id, record);
      if (!result) {
        return jsonResponse({ ok: false, error: 'Guest not found.', code: 'NOT_FOUND' }, 404);
      }
      return jsonResponse({ ok: true, guest: result.guest, slugChanged: result.slugChanged });
    } catch (err) {
      return handleError(err);
    }
  }

  async function DELETE(request) {
    try {
      const url = new URL(request.url);
      const queryId = url.searchParams.get('id');
      const querySlug = url.searchParams.get('slug') ?? url.searchParams.get('guest');
      const queryDeleteRsvps = url.searchParams.get('deleteRsvps');
      const body = await parseJsonBody(request, { allowEmpty: true });

      if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
        throw new ValidationError('Request body must be a JSON object.');
      }

      const rawId = queryId ?? body?.id;
      const slug = String(querySlug ?? body?.slug ?? body?.guest_slug ?? body?.guestSlug ?? body?.guest ?? '')
        .trim()
        .toLowerCase();
      const deleteRsvps = queryDeleteRsvps === 'true' || body?.deleteRsvps === true || body?.delete_rsvps === true;

      let criteria;
      if (rawId !== undefined && rawId !== null && rawId !== '') {
        criteria = { id: parsePositiveId(rawId) };
      } else if (slug) {
        criteria = { slug };
      } else {
        throw new ValidationError('Provide an id or slug to delete.');
      }

      const sql = await getReadySql();
      const result = await deleteGuest(sql, { ...criteria, deleteRsvps });
      if (!result) {
        return jsonResponse({ ok: false, error: 'Guest not found.', code: 'NOT_FOUND' }, 404);
      }
      return jsonResponse({
        ok: true,
        deletedId: result.deleted.id,
        deletedSlug: result.deleted.slug,
        deletedRsvpIds: result.deletedRsvpIds
      });
    } catch (err) {
      return handleError(err);
    }
  }

  return { GET, POST, PUT, PATCH, DELETE };
}

const handlers = createGuestsHandlers();
export const { GET, POST, PUT, PATCH, DELETE } = handlers;
