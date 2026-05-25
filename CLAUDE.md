# Project Instructions

## Overview
- This repo is now a Firebase-first event registration demo for Standard Chartered-style internal campaigns.
- The main experience lives entirely in `frontend/`.
- The product story is: create event, share QR/private link, capture registrations, prevent duplicates, export final data, and purge after the event.

## Build And Run
- Install deps: `cd frontend && npm exec --yes yarn@1.22.22 -- install`
- Start dev server: `cd frontend && yarn start`
- Production build: `cd frontend && yarn build`

## Firebase Runtime
- `frontend/src/lib/firebase.js` enables Firestore mode only when the required `REACT_APP_FIREBASE_*` variables are set.
- Without Firebase keys, the app runs in local demo mode using browser storage so the end-to-end flow is still reviewable.

## Project Structure
- `frontend/src/App.js`: primary demo UI for registration, dashboard, and storage/security explanation
- `frontend/src/lib/event-store.js`: event creation, duplicate-safe registration writes, purge logic, and demo fallback store
- `frontend/public/index.html`: metadata, CSP, and branding shell
- `frontend/vercel.json`: static deployment config
- `frontend/api/`: legacy FastAPI + Mongo proof-of-concept kept only for reference

## Conventions
- Frontend imports use the `@` alias for `frontend/src`.
- Sensitive fields are masked in the dashboard by default.
- Each registration stores an `expiresAt` value so the data model is Firestore TTL-ready.
- Duplicate prevention is event-specific and driven by the event's configured duplicate field.

## Testing
- Minimum manual checks:
  - create an event
  - generate/copy the QR registration link
  - submit a registration
  - submit the same duplicate key again and verify replace confirmation
  - export CSV
  - purge an event and confirm the registrations disappear
