# Renaissance Faire Wedding Website

A whimsical, medieval-inspired, and romantic wedding website built with pure HTML, CSS, and custom Google Fonts (*Cinzel Decorative*, *MedievalSharp*, *Cormorant Garamond*, and *IM Fell English*), paired with an RSVP database and desktop Admin Dashboard powered by Neon Postgres and Vercel Functions.

---

## 📂 Project Structure

```text
bard-wedding-2027/
├── api/
│   ├── guests.js            # Vercel serverless Guest Setup API (GET/POST/PUT/PATCH/DELETE)
│   └── rsvps.js             # Vercel serverless REST API (GET/POST/PUT/DELETE)
├── db/
│   └── schema.sql           # Neon Postgres table DDL (auto-created on first request)
├── lib/
│   ├── db.js                # Neon serverless client, schema initializer & one-time guest seeder
│   ├── guests-service.js    # Parameterized Postgres guest setup CRUD queries
│   ├── quest-stops.js       # Shared Bach Weekend 7-stop schedule metadata
│   ├── rsvps-service.js     # Parameterized Postgres RSVP CRUD queries
│   ├── seed-guests.js       # Initial 42 wedding + 17 bach guest records
│   └── validation.js        # Payload normalization & validation
├── public/
│   ├── index.html           # Main landing page & all sections
│   ├── rsvp.html            # Wedding RSVP page
│   ├── bach.html            # Bach Weekend RSVP & Quest Timeline page
│   ├── admin.html           # Desktop Admin Dashboard ("The Royal Ledger")
│   └── Engagement Picture   # Couple photo asset
├── scripts/
│   └── dev.mjs              # Local static + API dev server (reads .env.local)
├── tests/
│   └── api.test.js          # Node unit & API handler tests
├── package.json
└── vercel.json              # Static output directory + /admin, /rsvp/:guest & /bach/:guest rewrites & noindex header
```

---

## 📊 Admin Dashboard & Free Neon Postgres Setup

The desktop Admin Dashboard is available directly at **`/admin`** (or `/admin.html`) with no login wall (`noindex, nofollow` enabled).

### Connecting Free Neon Postgres on Vercel (No Credit Card Required)

1. Open your project in the **[Vercel Dashboard](https://vercel.com)** and go to **Storage → Create Database → Neon (Serverless Postgres)**.
2. Select the **Free** plan and link it to your project (Vercel automatically adds `DATABASE_URL` to your project's environment variables).
3. Trigger a **Redeploy** in Vercel. The `rsvps` table in [db/schema.sql](db/schema.sql) initializes automatically on the first request.

*(Alternatively, you can create a free database directly at [neon.tech](https://neon.tech), copy its pooled `DATABASE_URL` connection string into **Vercel → Settings → Environment Variables**, and redeploy.)*

---

## 🧪 Local Development & Testing

Run the site locally against `.env.local` (`DATABASE_URL`):

```sh
npm run dev
```

Then open `http://localhost:3000/admin` for the dashboard.

Run the automated test suite:

```sh
npm test
```

---

## 🎨 Customizing for Your Own Wedding

1. **Update Couple Names & Dates**:
   Open `public/index.html` and look for the Hero section (`<h1>Ethan & Holly</h1>`) and date headers (`March 25, 2027`).
2. **Edit Your Story & Event Details**:
   Modify `#story` and `#events` in `public/index.html`, or edit the Bach Weekend itinerary in `public/bach.html`.
3. **Manage Guest Lists & Setup**:
   Manage all guests, invite link slugs, group tags, Wedding/Bach invitations, and `+1` eligibility directly from the **Guest Setup** tab in `/admin`. Guests live exclusively in Neon Postgres (`guests` table via `/api/guests`). On initial database setup, the 42 guests in `lib/seed-guests.js` are seeded automatically once. Invite links use `/rsvp/<slug>` and `/bach/<slug>` (legacy `?guest=<slug>` links remain supported).
