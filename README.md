# Renaissance Faire Wedding Website Template

A whimsical, medieval-inspired, and romantic wedding website template built with pure HTML, CSS, and custom Google Fonts (*Cinzel Decorative*, *MedievalSharp*, *Cormorant Garamond*, and *IM Fell English*). 

Featuring a "Spring Faire" aesthetic complete with floating flower petals, custom corner flourishes, a fully responsive layout, and dedicated sections for your love story, event details, registry, travel info, and dress code.

---

## 📂 Project Structure

This is a pure static site deployed directly through Vercel with zero build steps required:

```text
bard-wedding-2027/
├── public/
│   ├── index.html         # Main landing page & all sections
│   ├── rsvp.html          # RSVP page
│   ├── guests.json        # Guest list data
│   └── Engagement Picture # Couple photo asset
└── vercel.json            # Vercel configuration (points to /public)
```

---

## 🎨 Customizing for Your Own Wedding

To adapt this template for your own celebration:

1. **Update Couple Names & Dates**:
   Open `public/index.html` and look for the Hero section (`<h1>Ethan & Holly</h1>`) and date headers (`March 25, 2027`) to replace with your own names and wedding date.
2. **Edit Your Story**:
   Modify the `#story` section in `public/index.html` to share your own tale.
3. **Update Event Details**:
   Change the ceremony and reception times, venues, and addresses under `#events` (The Faire).
4. **Registry & Travel**:
   Update your payment handles (Venmo, etc.), Zola/Honeyfund registry links, and hotel recommendations (`#registry` and `#travel`).
5. **Assets**:
   Replace or add photos in the `public/` directory.

---

## 🚀 Deployment (Vercel)

This project is configured for instant, zero-config deployment on Vercel:

1. Push your repository to GitHub.
2. Import the project into [Vercel](https://vercel.com).
3. Vercel automatically detects `vercel.json` (which points to the `/public` directory) and deploys your static site instantly.
