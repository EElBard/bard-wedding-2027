export async function listRsvps(sql, { event } = {}) {
  if (event) {
    return sql`
      SELECT
        id,
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
        submitted_at,
        updated_at
      FROM rsvps
      WHERE event = ${event}
      ORDER BY updated_at DESC, id DESC
    `;
  }

  return sql`
    SELECT
      id,
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
      submitted_at,
      updated_at
    FROM rsvps
    ORDER BY updated_at DESC, id DESC
  `;
}

export async function upsertRsvp(sql, record) {
  const rows = await sql`
    INSERT INTO rsvps (
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
    )
    VALUES (
      ${record.event},
      ${record.guest_slug},
      ${record.name},
      ${record.email},
      ${record.attending},
      ${record.plus_one},
      ${record.plus_one_name},
      ${record.solo_ack},
      ${record.arrive_idx},
      ${record.depart_idx},
      ${record.selected_stops},
      ${record.arrive_at},
      ${record.depart_after},
      ${record.schedule},
      ${record.notes},
      ${record.source}
    )
    ON CONFLICT (event, guest_slug) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      attending = EXCLUDED.attending,
      plus_one = EXCLUDED.plus_one,
      plus_one_name = EXCLUDED.plus_one_name,
      solo_ack = EXCLUDED.solo_ack,
      arrive_idx = EXCLUDED.arrive_idx,
      depart_idx = EXCLUDED.depart_idx,
      selected_stops = EXCLUDED.selected_stops,
      arrive_at = EXCLUDED.arrive_at,
      depart_after = EXCLUDED.depart_after,
      schedule = EXCLUDED.schedule,
      notes = EXCLUDED.notes,
      source = EXCLUDED.source,
      updated_at = NOW()
    RETURNING
      id,
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
      submitted_at,
      updated_at
  `;
  return rows[0] || null;
}

export async function updateRsvp(sql, id, record) {
  const rows = await sql`
    UPDATE rsvps
    SET
      event = ${record.event},
      guest_slug = ${record.guest_slug},
      name = ${record.name},
      email = ${record.email},
      attending = ${record.attending},
      plus_one = ${record.plus_one},
      plus_one_name = ${record.plus_one_name},
      solo_ack = ${record.solo_ack},
      arrive_idx = ${record.arrive_idx},
      depart_idx = ${record.depart_idx},
      selected_stops = ${record.selected_stops},
      arrive_at = ${record.arrive_at},
      depart_after = ${record.depart_after},
      schedule = ${record.schedule},
      notes = ${record.notes},
      source = ${record.source},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id,
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
      submitted_at,
      updated_at
  `;
  return rows[0] || null;
}

export async function deleteRsvp(sql, { id, event, guest_slug } = {}) {
  if (id !== undefined && id !== null) {
    const rows = await sql`
      DELETE FROM rsvps
      WHERE id = ${id}
      RETURNING id
    `;
    return rows[0] || null;
  }

  if (event && guest_slug) {
    const rows = await sql`
      DELETE FROM rsvps
      WHERE event = ${event} AND guest_slug = ${guest_slug}
      RETURNING id
    `;
    return rows[0] || null;
  }

  return null;
}
