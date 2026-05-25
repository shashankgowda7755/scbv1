# SCB Event Registration Demo

Firebase-first event registration demo for Standard Chartered-style internal campaigns. The current app focuses on the demo story raised in the meeting: QR-based entry, Google-backed storage, duplicate prevention, dashboard visibility, export handoff, and post-event purge.

## Current Architecture

```text
scbv1/
├── frontend/
│   ├── src/App.js              # Registration, dashboard, and security walkthrough UI
│   ├── src/lib/firebase.js     # Firebase bootstrapping and runtime mode detection
│   ├── src/lib/event-store.js  # Firestore/local demo data layer
│   ├── public/index.html       # Client-facing shell and CSP
│   └── vercel.json             # Static Vercel deployment config
├── frontend/api/               # Legacy FastAPI proof-of-concept, no longer primary
└── README.md
```

## What The Demo Shows

- Event creation with client name, location, retention window, and duplicate rule
- QR code generation for event-specific registration links
- Registration flow with duplicate detection and explicit replace confirmation
- Live dashboard with masked sensitive fields by default
- CSV export for final handoff to the client
- Post-event purge flow and `expiresAt` retention tracking for Firestore TTL readiness

## Data Model

### `events/{eventId}`

- Client and event metadata
- Duplicate control field
- Retention window in days
- `createdAt`
- `expiresAt`

### `registrations/{eventId__hash}`

- Event linkage
- Participant details
- Masked field variants for dashboard-safe display
- Revision history for replaced registrations
- `createdAt`
- `updatedAt`
- `expiresAt`

## Storage Modes

### Firebase mode

If the Firebase environment variables are configured, the app writes directly to Cloud Firestore from the browser.

### Demo mode

If the Firebase environment variables are missing, the app uses local browser storage so the team can still demo the entire flow without blocking on credentials.

## Local Development

```bash
cd frontend
npm exec --yes yarn@1.22.22 -- install
yarn start
```

Open `http://localhost:3000`.

## Firebase Configuration

Add the values from a Firebase web app to `frontend/.env`:

```bash
REACT_APP_FIREBASE_API_KEY=...
REACT_APP_FIREBASE_AUTH_DOMAIN=...
REACT_APP_FIREBASE_PROJECT_ID=...
REACT_APP_FIREBASE_STORAGE_BUCKET=...
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
REACT_APP_FIREBASE_APP_ID=...
```

Once these are present, the app switches from demo mode to real Firestore mode automatically.

## Deployment

Deploy the `frontend/` app as a static Vercel project or serve the built output from the client-approved domain. The current implementation no longer depends on the old FastAPI endpoint for the main flow.
