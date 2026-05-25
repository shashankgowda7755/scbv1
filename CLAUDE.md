# SCB Event Platform — Project Memory

Single source of truth for this repo. Read this first whenever resuming work.

---

## 1. Project Overview

**Product:** Event registration + attendance platform for Standard Chartered Bank (SCB) internal CSR events.

**Built by:** Communitree (Shashank Gowda, shashank@tndwwt.org).

**First event:** `CSR Activity Chennai - Quiz Calendar Creation` · 09 May 2026 · DLF Downtown.

**Client meeting:** 12:00 IST. Audience: Pinaki + Eswar (SCB), Mohan / Roshney / Das (Communitree).

**Why this exists (from the call transcript):**
- SCB compliance forbids personal data leaving the Google ecosystem.
- Existing Google Form + Sheet workflow lacks: duplicate prevention, live ops dashboard, automated retention purge.
- Communitree closes those three gaps without leaving the Google data path.

---

## 2. Current State

### Working (V1, ready for the 12 PM demo)
- Real Firebase project `scb-event-registration` live in Mumbai region.
- Field-level AES-256-GCM encryption on `fullName`, `employeeId`, `email`, `phone`. Operator holds the key.
- Sidebar shell with 9 nav items (5 working + 4 stub pages).
- Event creation, QR generation, participant registration, live count, masked dashboard, CSV export with on-the-fly decrypt, manual purge, key rotation demo.
- Participant view at `?mode=register` (clean form, no admin chrome).
- Firestore rules shape-validate writes (rejects non-ciphertext shapes).
- Firestore TTL on `expiresAt` for automatic retention purge.

### Stubbed (V2, roadmap cards live in sidebar)
- **Form Builder** — no-code per-event form editor.
- **Check-In** — venue desk single-field form with walk-in capture.
- **Checkout** — exit form + attendance status engine.
- **Reports** — post-event report with status flags, CSV + PDF.

### Blocked
- **GitHub push** — local git auth is `artforawarenessofficial-blip`, no write perm on `shashankgowda7755/scbv1`. Branch `codex/setup-onboarding` has 1 unpushed commit.
- **Vercel deploys** — 3 deployments stuck in `BLOCKED` state (hobby tier daily limit). Demo runs from `localhost:3000`. Push to GitHub when shashankgowda creds available — Vercel auto-builds from `main`.

---

## 3. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, CRA + craco, TailwindCSS, shadcn/ui, Lucide icons |
| QR | `qrcode` npm package |
| Storage | Cloud Firestore, `asia-south1` (Mumbai) |
| Encryption | Web Crypto API (`crypto.subtle`) — no third-party crypto lib |
| Realtime | Firestore `onSnapshot` |
| Hosting | Vercel static deploy |
| Local fallback | `localStorage` when Firebase env vars missing |

No third-party SaaS in the data path. Stack is React in browser + Firestore on Google Cloud + Vercel static hosting.

---

## 4. Design System

### Palette (white / black / orange)
| Token | Value | Use |
|---|---|---|
| `--ink` | `#0A0A0A` | Primary text, default CTA |
| `--paper` | `#FFFFFF` | All backgrounds |
| `--orange` | `#FF6B1A` | Accent, hover CTA, primary action buttons |
| `--orange-soft` | `#FFF1E8` | Status pill bg, helper banner, soft chip bg |
| `--orange-deep` | `#E5570A` | Accent text on soft bg, CTA hover |
| `--gray-200` | `#E5E5E5` | Borders |
| `--gray-500` | `#71717A` | Secondary text |
| `--gray-700` | `#3F3F46` | Labels |

### Layout
- 248px fixed left sidebar + flex-grow main.
- Single-column page stack (no 2-col grids — each page does one job).
- Cards: white bg + 1px gray border + subtle hover (border darkens).
- Buttons: black default → orange on hover (with lift); orange for primary actions on insight pages.
- Inputs: white bg, orange focus ring `rgba(255,107,26,0.18)`.

### Typography
- Display: 1.5rem H1, 1.05rem card titles, -0.02em letter-spacing on headings.
- Body: 0.88-0.95rem, line-height 1.5.
- Code/mono: ui-monospace, SF Mono.

CSS file: `frontend/src/App.css`. Tokens are declared at `:root`.

---

## 5. Sidebar Navigation (drives `activeTab` state)

```
SCB Event Platform
└── Setup
    ├── Events ✓             (Create Event form)
    └── Form Builder (Soon)
└── Operate
    ├── Registrations ✓      (Capture Registration form)
    ├── Check-In (Soon)
    ├── Checkout (Soon)
    └── QR & Share ✓         (QR code + share link, full page)
└── Insights
    ├── Dashboard ✓          (Live summary + Export/Reveal/Purge + table)
    └── Reports (Soon)
└── Trust
    └── Security ✓           (Encryption narrative + key fingerprint + rotate)
```

`navSections` array in `App.js` is the single source of truth. To add a new page: push an item, add a `<TabsContent value="X">` block.

---

## 6. Data Flow (V1)

```
1. Operator → Events page → fills Create Event form → submit.
2. App generates eventId + QR encoding URL:
     https://<deploy>/?event=<id>&mode=register#register
3. Operator auto-routed to QR & Share page.
4. Employee scans QR on phone → participant view loads (clean, no admin).
5. Employee fills Full Name + Bank ID + Participation + Photo Consent → submit.
6. Browser: AES-256-GCM encrypts (fullName, employeeId, email, phone).
   Bank ID is SHA-256 hashed with per-event salt → Firestore docId.
7. Encrypted record written to /registrations/{eventId}__{hash}.
8. Dashboard page (Firestore onSnapshot) ticks count up live.
9. Operator clicks Reveal → in-browser decrypt → plaintext.
10. CSV Export → decrypt → download.
11. Manual Purge OR Firestore TTL on expiresAt removes records.
```

---

## 7. Encryption Details

- Cipher: AES-GCM, 256-bit key, 96-bit IV per record.
- Key source order: `REACT_APP_DATA_KEY` env var → `SCB_DATA_KEY_V1` localStorage (auto-generated on first run).
- Key fingerprint: `kid-<6 hex>` = first 6 bytes of SHA-256(key). Safe to share.
- Rotation: `Rotate Key (Demo)` button. Prior records become `[decrypt failed]`. Proof "data useless without key".
- Encrypted fields stored as: `enc:v1:<base64-iv>.<base64-ciphertext>`.
- Dedupe: `docId = ${eventId}__${sha256(${eventId}::${normalize(bankId)}).slice(0, 24)}` — server never sees plain ID.

Code: `frontend/src/lib/crypto.js`.

---

## 8. Data Model

### `events/{eventId}`
```
{
  id, clientName, title, location, eventDate,
  duplicateField: "employeeId" | "email" | "phone",
  retentionDays: number,
  notes, status: "active",
  createdAt: Timestamp, expiresAt: Timestamp
}
```

### `registrations/{eventId}__{sha256-hash}`
```
{
  id, eventId, eventTitle, clientName,
  duplicateField, dedupeHash,
  fullName:    "enc:v1:<iv>.<ct>",   // encrypted
  employeeId:  "enc:v1:<iv>.<ct>",   // encrypted
  email:       "enc:v1:<iv>.<ct>",   // encrypted (may be "" if blank)
  phone:       "enc:v1:<iv>.<ct>",   // encrypted (may be "" if blank)
  department, city,                  // clear
  participation: "Yes" | "No",       // clear
  photoConsent: bool,
  consent: bool,
  maskedFullName, maskedEmail, maskedPhone, maskedEmployeeId,
  createdAt, updatedAt, expiresAt,
  revision, history: [...]
}
```

---

## 9. Firebase Project

| Item | Value |
|---|---|
| Project ID | `scb-event-registration` |
| Project number | `730938451394` |
| Auth Domain | `scb-event-registration.firebaseapp.com` |
| Storage Bucket | `scb-event-registration.firebasestorage.app` |
| Web App ID | `1:730938451394:web:3cfb2a87566bf5224f625b` |
| Firestore region | `asia-south1` (Mumbai) |
| Plan | Spark (free) |
| Owner | shashankgowda7755 Google account |

Rules + indexes + TTL config: `firestore.rules`, `firestore.indexes.json`, `firebase.json` at repo root.

---

## 10. Vercel Project

| Item | Value |
|---|---|
| Project | `scbv1-ehbx` |
| Team | `shashankgowda7755-5023s-projects` |
| Production URL (latest READY) | `https://scbv1-ehbx.vercel.app` (points to 53-day-old deploy) |
| Latest local-built deploy URL | `scbv1-ehbx-a5y94u5jp-...vercel.app` (BLOCKED) |
| GitHub link | `shashankgowda7755/scbv1` `main` branch (auto-deploy) |
| All 7 envs set | yes: `REACT_APP_FIREBASE_*` + `REACT_APP_DATA_KEY` |

To unblock prod deploy: push current branch via shashankgowda7755 GitHub creds, or wait for Vercel daily limit reset.

---

## 11. Environment Variables (frontend/.env)

```
REACT_APP_FIREBASE_API_KEY=AIzaSyCof00j3wvL5fqfycO0gEGmKP5y4AjxgjI
REACT_APP_FIREBASE_AUTH_DOMAIN=scb-event-registration.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=scb-event-registration
REACT_APP_FIREBASE_STORAGE_BUCKET=scb-event-registration.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=730938451394
REACT_APP_FIREBASE_APP_ID=1:730938451394:web:3cfb2a87566bf5224f625b
REACT_APP_DATA_KEY=SgLu4PZYORSHPxzYdGPAyGN6VLNViW9+Qz4Ey42OLl4=
```

> The `.env` file is in `.gitignore`. Same values are set as Vercel production env vars.
> The `REACT_APP_DATA_KEY` is the operator AES key. Without it, encrypted records cannot be decrypted. Stash a backup copy in 1Password or wherever the team keeps secrets.

---

## 12. Build / Run / Test

```bash
# Install
cd frontend && npm exec --yes yarn@1.22.22 -- install

# Dev server (default port 3000)
cd frontend && yarn start

# Production build
cd frontend && yarn build

# Vercel build (uses .vercel/project.json)
cd frontend && vercel build --prod && vercel deploy --prebuilt --prod --yes
```

Manual smoke test path:
1. Open `localhost:3000` → Events page.
2. Click `Load SCB Demo Event` if no events exist, or fill the Create Event form and submit.
3. Auto-routes to QR & Share. Scan QR with phone (or click `Open participant view in a new tab →`).
4. Submit a registration. Check Registrations / Dashboard pages — count ticks up.
5. Dashboard → click Reveal (Decrypt) → plaintext shows.
6. Dashboard → Export CSV → file downloads with decrypted data.
7. Submit same Bank ID again → duplicate modal.
8. Security page → Rotate Key (Demo) → prior records show `[decrypt failed]`.
9. Dashboard → Purge Event → count drops to zero, Firestore cleared.

---

## 13. File Structure

```
scbv1/
├── CLAUDE.md                          # this file
├── README.md                          # public-facing project summary
├── DEMO_SCRIPT.md                     # 12 PM call crib sheet, step-by-step
├── REPORT.md                          # technical report (13 sections)
├── SLIDES.html                        # self-contained reveal.js deck (open in browser)
├── TEXT_INVENTORY.md                  # every UI string for client copy review
├── PRODUCTION_SETUP.md                # operator runbook for Firebase + Vercel
├── firebase.json
├── firestore.rules                    # AES-shape validation on writes
├── firestore.indexes.json             # TTL config for registrations.expiresAt
└── frontend/
    ├── .env                           # gitignored — real Firebase + key values
    ├── .env.example                   # template
    ├── vercel.json                    # SPA rewrites + security headers
    ├── package.json
    ├── src/
    │   ├── App.js                     # sidebar shell + 9 TabsContent blocks
    │   ├── App.css                    # white/black/orange design tokens + layout
    │   ├── index.js
    │   ├── components/ui/             # shadcn primitives
    │   └── lib/
    │       ├── firebase.js            # Firestore bootstrap + demo mode detection
    │       ├── event-store.js         # CRUD + encryption + dedupe hash
    │       ├── crypto.js              # AES-256-GCM, fingerprint, rotate
    │       └── utils.js               # cn() helper
    └── public/
        ├── index.html
        └── favicon...
```

---

## 14. V2 Roadmap (stub pages have one-liner per item)

### Form Builder
- Pick event → drag fields (text, dropdown, radio, checkbox, date, file).
- Mark one field as Unique ID.
- Preview + publish. Generates 3 URLs per event: registration, check-in, checkout.
- Forms auto-close when event status → Closed.

### Check-In
- Single-field form for venue desk (tablet/laptop).
- Lookup on `Event Code` + `Unique ID`.
- Match → mark `Checked In` + timestamp + name confirmation.
- No match → walk-in capture with status `Walk-In, Check-In Only`.
- Duplicate guard: "Already checked in at HH:MM".

### Checkout
- Lookup against registrations + check-ins for the event.
- All 3 match → status `COMPLETE`.
- Registered + checkout no check-in → `REG_CHECKOUT`.
- Walk-in only at exit → `WALKIN_CHECKOUT`.
- Triggers attendance status engine on event close.

### Attendance Status Engine (computed at event close)
| Code | Meaning |
|---|---|
| `COMPLETE` | Registered + Checked In + Checked Out |
| `REG_CHECKIN` | Registered + Checked In, No Checkout |
| `REG_ONLY` | Registered, No Check-In, No Checkout |
| `REG_CHECKOUT` | Registered + Checked Out, No Check-In |
| `WALKIN_COMPLETE` | Not Registered + Checked In + Checked Out |
| `WALKIN_CHECKIN` | Not Registered + Checked In Only |
| `WALKIN_CHECKOUT` | Not Registered + Checked Out Only |
| `NO_SHOW` | Registered, Never Appeared |

### Reports
- Per-event summary: counts per status code, completion rate.
- Per-attendee detail table with all timestamps + status. Filter by status.
- Export: CSV + PDF.
- Global trend: last 6 events attendance rate.
- Auto-generated when event status → Closed.

### Roles (V2)
- **Admin** — creates events, builds forms, views dashboards + reports, exports.
- **Event Staff** — operates check-in / checkout forms at venue. Read-only attendee list.
- **Registrant** — fills forms. No login. Identified by Unique ID.

---

## 15. Hardening Path (post-client-greenlight)

- **Operator Firebase Auth.** Google sign-in + `request.auth.token.operator == true` custom claim. Lock dashboard reads/writes to staff.
- **Audit log.** `/audit/{autoId}` records every reveal / decrypt / export / purge action with operator UID and timestamp.
- **Google Sheet mirror.** Cloud Function on registration create pushes a decrypted row into an SCB-approved Google Sheet.
- **SSO with the bank.** Firebase Auth supports SAML/OIDC. Operators sign in with SCB credentials.
- **Per-client branding.** Logo + colors + retention defaults stored in `/settings/{clientId}`.

---

## 16. Conventions

- Frontend imports use the `@` alias for `frontend/src`.
- Sensitive fields are encrypted at the source — never logged, never sent in URLs.
- Masked previews stored in clear are deterministic (no plaintext leakage).
- Each registration carries `expiresAt` (Firestore TTL-ready).
- Duplicate prevention is per-event, driven by `duplicateField` choice.
- Old Railway / Mongo backend in `frontend/api/` is dead code — kept only for reference.

---

## 17. Open Threads

- [ ] Push `codex/setup-onboarding` to `shashankgowda7755/scbv1` (blocked on git auth).
- [ ] Promote latest local-built Vercel deploy to `scbv1-ehbx.vercel.app` alias (blocked on Vercel BLOCKED state).
- [ ] User to review `TEXT_INVENTORY.md` and provide copy edits.
- [ ] Wire Form Builder (V2).
- [ ] Wire Check-In + Checkout + Attendance Engine (V2).
- [ ] Wire Reports CSV + PDF (V2).
- [ ] Add Firebase Auth + operator claims (V2 hardening).
