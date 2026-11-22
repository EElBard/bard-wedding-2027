import { DbNotConfiguredError, ensureSchema as defaultEnsureSchema, getSql as defaultGetSql } from '../lib/db.js';
import { deleteRsvp, listRsvps, updateRsvp, upsertRsvp } from '../lib/rsvps-service.js';
import { ValidationError, normalizeRsvpPayload } from '../lib/validation.js';

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
      { ok: false, error: 'An RSVP already exists for this guest and event.', code: 'CONFLICT' },
      409
    );
  }
  console.error('RSVP API error:', err);
  return jsonResponse({ ok: false, error: 'Internal server error' }, 500);
}

export function createRsvpsHandlers({
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

      const sql = await getReadySql();
      const rsvps = await listRsvps(sql, { event: eventParam || undefined });
      return jsonResponse({
        ok: true,
        rsvps,
        serverTime: new Date().toISOString()
      });
    } catch (err) {
      return handleError(err);
    }
  }

  async function POST(request) {
    try {
      const body = await parseJsonBody(request);
      const record = normalizeRsvpPayload(body);
      const sql = await getReadySql();
      const rsvp = await upsertRsvp(sql, record);
      return jsonResponse({ ok: true, rsvp });
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

      const rawId = queryId ?? body.id;
      const id = parsePositiveId(rawId);
      const record = normalizeRsvpPayload({ ...body, source: body.source || 'admin' });
      const sql = await getReadySql();
      const rsvp = await updateRsvp(sql, id, record);
      if (!rsvp) {
        return jsonResponse({ ok: false, error: 'RSVP not found.', code: 'NOT_FOUND' }, 404);
      }
      return jsonResponse({ ok: true, rsvp });
    } catch (err) {
      return handleError(err);
    }
  }

  async function DELETE(request) {
    try {
      const url = new URL(request.url);
      const queryId = url.searchParams.get('id');
      const queryEvent = url.searchParams.get('event');
      const querySlug = url.searchParams.get('guest_slug') ?? url.searchParams.get('guest');
      const body = await parseJsonBody(request, { allowEmpty: true });

      const rawId = queryId ?? body?.id;
      const event = queryEvent ?? body?.event;
      const guestSlug = (querySlug ?? body?.guest_slug ?? body?.guestSlug ?? body?.guest ?? '').trim().toLowerCase();

      let criteria;
      if (rawId !== undefined && rawId !== null && rawId !== '') {
        criteria = { id: parsePositiveId(rawId) };
      } else if (event && guestSlug) {
        if (event !== 'wedding' && event !== 'bach') {
          throw new ValidationError('Invalid event type. Expected "wedding" or "bach".');
        }
        criteria = { event, guest_slug: guestSlug };
      } else {
        throw new ValidationError('Provide an id or event and guest_slug to delete.');
      }

      const sql = await getReadySql();
      const deleted = await deleteRsvp(sql, criteria);
      if (!deleted) {
        return jsonResponse({ ok: false, error: 'RSVP not found.', code: 'NOT_FOUND' }, 404);
      }
      return jsonResponse({ ok: true, deletedId: deleted.id });
    } catch (err) {
      return handleError(err);
    }
  }

  return { GET, POST, PUT, DELETE };
}

const handlers = createRsvpsHandlers();
export const { GET, POST, PUT, DELETE } = handlers;
