# Frontend

This directory now contains the complete Firebase-first demo:

- `src/App.js` renders the registration desk, event dashboard, and security walkthrough
- `src/lib/firebase.js` decides whether the app is in Firestore mode or local demo mode
- `src/lib/event-store.js` handles event creation, duplicate-safe registrations, export-ready records, and purge actions
- `public/index.html` defines the app shell and CSP for Firebase connectivity

## Start The App

```bash
npm exec --yes yarn@1.22.22 -- install
yarn start
```

Open `http://localhost:3000`.

## Firebase Setup

Create `frontend/.env` from `.env.example` and add the Firebase web app values. If they are omitted, the UI runs in demo mode with local browser storage.

## Client Demo Flow

1. Create an event from the dashboard.
2. Copy the event link or show the generated QR code.
3. Submit a registration from the registration desk.
4. Re-submit the same duplicate key to show replace protection.
5. Open the dashboard to show masked live data and export CSV.
6. Use purge to demonstrate post-event data cleanup.

## Legacy Folder

`frontend/api/` contains the earlier FastAPI + Mongo proof-of-concept. It is kept for reference, but the main SCB demo flow now uses Firebase-oriented client storage.
