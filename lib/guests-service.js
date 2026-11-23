export async function listGuests(sql, { event } = {}) {
  if (event === 'wedding') {
    return sql`
      SELECT
        id,
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
        created_at,
        updated_at
      FROM guests
      WHERE wedding_invited = TRUE
      ORDER BY LOWER(name) ASC, id ASC
    `;
  }

  if (event === 'bach') {
    return sql`
      SELECT
        id,
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
        created_at,
        updated_at
      FROM guests
      WHERE bach_invited = TRUE
      ORDER BY LOWER(name) ASC, id ASC
    `;
  }

  return sql`
    SELECT
      id,
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
      created_at,
      updated_at
    FROM guests
    ORDER BY LOWER(name) ASC, id ASC
  `;
}

export async function getGuestById(sql, id) {
  const rows = await sql`
    SELECT
      id,
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
      created_at,
      updated_at
    FROM guests
    WHERE id = ${id}
  `;
  return rows[0] || null;
}

export async function getGuestBySlug(sql, slug, { event } = {}) {
  if (event === 'wedding') {
    const rows = await sql`
      SELECT
        id,
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
        created_at,
        updated_at
      FROM guests
      WHERE slug = ${slug} AND wedding_invited = TRUE
    `;
    return rows[0] || null;
  }

  if (event === 'bach') {
    const rows = await sql`
      SELECT
        id,
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
        created_at,
        updated_at
      FROM guests
      WHERE slug = ${slug} AND bach_invited = TRUE
    `;
    return rows[0] || null;
  }

  const rows = await sql`
    SELECT
      id,
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
      created_at,
      updated_at
    FROM guests
    WHERE slug = ${slug}
  `;
  return rows[0] || null;
}

export async function createGuest(sql, record) {
  const rows = await sql`
    INSERT INTO guests (
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
    )
    VALUES (
      ${record.slug},
      ${record.name},
      ${record.email},
      ${record.phone},
      ${record.party_group},
      ${record.wedding_invited},
      ${record.wedding_plus_one},
      ${record.bach_invited},
      ${record.bach_plus_one},
      ${record.notes}
    )
    RETURNING
      id,
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
      created_at,
      updated_at
  `;
  return rows[0] || null;
}

export async function updateGuest(sql, id, record) {
  const existing = await getGuestById(sql, id);
  if (!existing) {
    return null;
  }

  const rows = await sql`
    UPDATE guests
    SET
      slug = ${record.slug},
      name = ${record.name},
      email = ${record.email},
      phone = ${record.phone},
      party_group = ${record.party_group},
      wedding_invited = ${record.wedding_invited},
      wedding_plus_one = ${record.wedding_plus_one},
      bach_invited = ${record.bach_invited},
      bach_plus_one = ${record.bach_plus_one},
      notes = ${record.notes},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id,
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
      created_at,
      updated_at
  `;
  const updated = rows[0] || null;
  if (!updated) {
    return null;
  }

  const slugChanged = existing.slug !== record.slug;
  if (slugChanged) {
    await sql`
      UPDATE rsvps r
      SET guest_slug = ${record.slug}, updated_at = NOW()
      WHERE r.guest_slug = ${existing.slug}
        AND NOT EXISTS (
          SELECT 1 FROM rsvps r2
          WHERE r2.event = r.event AND r2.guest_slug = ${record.slug}
        )
    `;
  }

  return {
    guest: updated,
    slugChanged,
    previousSlug: existing.slug
  };
}

export async function deleteGuest(sql, { id, slug, deleteRsvps = false } = {}) {
  let deleted = null;

  if (id !== undefined && id !== null) {
    const rows = await sql`
      DELETE FROM guests
      WHERE id = ${id}
      RETURNING id, slug, name
    `;
    deleted = rows[0] || null;
  } else if (slug) {
    const rows = await sql`
      DELETE FROM guests
      WHERE slug = ${slug}
      RETURNING id, slug, name
    `;
    deleted = rows[0] || null;
  }

  if (!deleted) {
    return null;
  }

  let deletedRsvpIds = [];
  if (deleteRsvps) {
    const rsvpRows = await sql`
      DELETE FROM rsvps
      WHERE guest_slug = ${deleted.slug}
      RETURNING id
    `;
    deletedRsvpIds = rsvpRows.map((r) => r.id);
  }

  return {
    deleted,
    deletedRsvpIds
  };
}
