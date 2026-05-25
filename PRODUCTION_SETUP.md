# SCB Event Registration — Production Setup

Three things to land before tomorrow's 12:00 IST call:

1. **Real Firebase project** (no more localStorage demo mode).
2. **Shared encryption key** (so every operator decrypts the same data).
3. **Vercel deploy** on a stable URL the SCB team can scan.

---

## 1. Create the Firebase project (10 min)

1. Open https://console.firebase.google.com → **Add project**.
2. Project name: `scb-event-registration` (or whatever the client prefers).
3. Disable Google Analytics for the project (avoids extra data sharing — keeps the compliance story clean).
4. Once created, in the project home click the **Web** icon (`</>`) to register a web app.
   - App nickname: `scb-event-registration-web`.
   - Skip Firebase Hosting.
   - **Copy the config block.** You need: apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId.
5. Sidebar → **Build → Firestore Database → Create database**.
   - Start in **production mode**.
   - Location: `asia-south1` (Mumbai) for SCB India data residency.
6. **Rules** tab → paste the contents of `firestore.rules` from this repo → **Publish**.
7. **Indexes** tab → no composite indexes needed for v1.
8. **TTL** tab → Add policy → Collection: `registrations`, Field: `expiresAt`. Enable.
   - This is the automatic post-event purge the client asked about. Cleanup runs within 24h of `expiresAt`.

---

## 2. Generate the encryption key (1 min)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Save the output. This is the single key that decrypts every record. Treat it like a password.

Put it in `frontend/.env`:

```
REACT_APP_DATA_KEY=<paste-here>
```

> If the key is lost, all encrypted records become unreadable. Stash a copy in 1Password / shared vault.

---

## 3. Wire env locally (2 min)

In `frontend/`:

```bash
cp .env.example .env
```

Edit `.env` and paste from the Firebase console:

```
REACT_APP_FIREBASE_API_KEY=AIzaSy...
REACT_APP_FIREBASE_AUTH_DOMAIN=scb-event-registration.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=scb-event-registration
REACT_APP_FIREBASE_STORAGE_BUCKET=scb-event-registration.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=1234567890
REACT_APP_FIREBASE_APP_ID=1:1234567890:web:abcdef
REACT_APP_DATA_KEY=<paste-from-step-2>
```

Restart the dev server:

```bash
cd frontend
yarn start
```

The hero badge should flip from `Demo mode, Firebase-ready` to `Connected to Firestore`.

Create an event, submit a registration, then check the Firebase console → Firestore Database → `registrations` collection. Confirm:
- Document ID looks like `<eventId>__<24-hex-chars>` (SHA-256 hash, not the raw Bank ID).
- `fullName`, `employeeId`, `email`, `phone` start with `enc:v1:`.
- `participation`, `photoConsent`, `department`, `city` are in clear.
- `expiresAt` is a Firestore Timestamp.

---

## 4. Deploy to Vercel (5 min)

```bash
cd frontend
npx vercel              # first time: link or create project
npx vercel env add REACT_APP_FIREBASE_API_KEY production
npx vercel env add REACT_APP_FIREBASE_AUTH_DOMAIN production
npx vercel env add REACT_APP_FIREBASE_PROJECT_ID production
npx vercel env add REACT_APP_FIREBASE_STORAGE_BUCKET production
npx vercel env add REACT_APP_FIREBASE_MESSAGING_SENDER_ID production
npx vercel env add REACT_APP_FIREBASE_APP_ID production
npx vercel env add REACT_APP_DATA_KEY production
npx vercel --prod
```

You get a URL like `https://scb-event-registration.vercel.app`. Use that in the demo.

Optional: point a custom domain (e.g. `scb-events.communitree.co.in`) at the Vercel deployment under **Project Settings → Domains**.

---

## 5. Authorise the deploy URL in Firebase (1 min)

Firebase blocks API key usage from unknown referrers by default.

1. Console → **Project Settings → General → Your apps → Web → SDK setup and config**.
2. Already fine for the API key — no allowlist needed for web SDK with Firestore-only.
3. If you later add Firebase Auth: **Authentication → Settings → Authorized domains** → add the Vercel URL + any custom domain.

---

## 6. Smoke test on the production URL

1. Open `https://<deploy-url>/` on a laptop → operator view. Confirm "Connected to Firestore" badge.
2. Create the Quiz Calendar event.
3. Phone scan the QR. Should land at `https://<deploy-url>/?event=...&mode=register` showing only the participant form.
4. Submit a registration. Check the operator window → count ticks up. Check Firebase console → record exists, ciphertext intact.
5. Run through `DEMO_SCRIPT.md` once end-to-end so there are no surprises in the call.

---

## V2 hardening (after the client says yes)

- **Firebase Auth + custom claims.** Add Google sign-in for operators. Update `firestore.rules` to require `request.auth.token.operator == true` on `/registrations` reads, `/events` writes, and any delete.
- **Cloud Functions trigger** on `registrations` create to push a row into a Google Sheet in the SCB-approved drive — closes the loop on Pinaki's "data must stay inside Google" ask.
- **Operator passphrase gate** in the React shell so the dashboard doesn't render unless the user types the right phrase. Stops casual access if the URL leaks.
- **Audit log collection** (`audit/{autoId}`) that records every reveal/decrypt/export action with the operator's auth UID.
