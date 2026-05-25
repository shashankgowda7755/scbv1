# SCB Event Registration — Technical Report

**Project:** Standard Chartered internal event registration platform.
**First event:** CSR Activity Chennai — Quiz Calendar Creation · 09 May 2026 · DLF Downtown.
**Built for:** Pinaki, Eswar (SCB), with Mohan, Roshney, Das (Communitree).
**Authors:** Shashank Gowda + Communitree engineering.

---

## 1. The brief, in one paragraph

Standard Chartered runs internal events where employees register on the day. Today the registration lives in a Google Form, drops into a Google Sheet, and the sheet is shared back to the SCB ops team after the event. The bank's compliance posture says the data must stay inside the Google ecosystem and must be deletable after the event. The current Google Sheet workflow misses three things: there is no duplicate prevention if an employee submits twice, there is no live count for ops during the event, and the deletion is manual. The Communitree ask is to keep the compliance story intact (Google-only data path) while adding duplicate prevention, a live ops dashboard, an export-on-demand CSV, and an automated retention purge.

## 2. What we are showing on the call

A working web app that runs on a private URL, generates one QR code per event, captures registrations into Cloud Firestore (a Google product), encrypts personal fields before they leave the browser, and gives the ops team a live dashboard with a one-click CSV export and an explicit purge. Every byte of personal data in the database is ciphertext until the operator's browser decrypts it with a key that is held by us, never written next to the data.

## 3. Why Firestore and not "some other website"

The exact concern raised by Roshney on the call: SCB cannot accept a third-party data store. Cloud Firestore is part of Google Cloud, billed under the same Google account, and the data physically lives in the Mumbai region (`asia-south1`) for the demo project. From SCB's compliance perspective, this is the same surface area as a Google Sheet — there is no extra vendor in the data path. From an engineering perspective, Firestore gives us live updates, a documented retention TTL, and per-document security rules that a sheet does not.

## 4. Data flow

```
1. Operator creates event in the dashboard.
2. App generates an event-specific URL + QR code:
     https://<deploy>/?event=<id>&mode=register
3. Employee scans the QR on their phone.
4. The registration form opens in participant mode (no admin chrome).
5. Employee fills Full Name, Bank ID, Participation (Yes/No), Photo Consent.
6. Browser encrypts Full Name, Bank ID, Email, Phone with AES-256-GCM
   using the operator-held key. The dedupe value (Bank ID) is hashed with
   SHA-256 and a per-event salt; that hash becomes the Firestore doc ID.
7. Browser writes the encrypted document to Firestore.
8. The operator dashboard subscribes to the registrations collection via
   Firestore onSnapshot and reflects the new record live.
9. The dashboard renders MASKED values by default. Operator clicks
   "Reveal (Decrypt)" to see plaintext.
10. CSV export decrypts everything in-browser and downloads the file.
11. At end-of-event, operator clicks "Purge Event" OR Firestore TTL
    removes the records on the agreed retention date.
```

## 5. Field-level encryption — the security headline

Every sensitive field stored in Firestore looks like this:

```
email:      "enc:v1:<base64-iv>.<base64-ciphertext>"
phone:      "enc:v1:<base64-iv>.<base64-ciphertext>"
employeeId: "enc:v1:<base64-iv>.<base64-ciphertext>"
fullName:   "enc:v1:<base64-iv>.<base64-ciphertext>"
```

Algorithm details:
- **Cipher:** AES-GCM (authenticated encryption — tampering is detectable).
- **Key size:** 256 bits.
- **IV:** 96 bits, freshly generated per record via `window.crypto.getRandomValues`.
- **Key custody:** held by the operator. Source order: (1) `REACT_APP_DATA_KEY` env var, (2) `SCB_DATA_KEY_V1` in browser `localStorage` (auto-generated on first run if env var is missing). The key is never written to Firestore alongside the data.
- **Key fingerprint:** the dashboard shows a `kid-<6 hex>` derived from `SHA-256(key)`. The fingerprint is safe to share — it identifies which key was used without revealing it.
- **Rotation:** the dashboard has a "Rotate Key (Demo)" button. Pressing it generates a new key, and the previous encrypted records are now unreadable. This is the proof that the data is meaningless without the key.

If Firestore were ever leaked, the attacker has ciphertext and IVs but no key, and AES-GCM with a random IV per record gives zero recoverable plaintext.

## 6. Duplicate prevention — without ever decrypting

A duplicate-check usually means reading the existing value and comparing. We do not want the server to ever see the plaintext Bank ID. So instead:

```
docId = `${eventId}__${sha256(`${eventId}::${normalize(bankId)}`).slice(0, 24)}`
```

Two registrations with the same Bank ID for the same event collide on `docId` and Firestore reports the document already exists. A second submission triggers our "Replace" confirmation dialog, where the operator (or the participant) can choose to keep the existing record or update it. The plaintext Bank ID never leaves the encrypted blob; only the SHA-256 hash is used as an index.

This also means the same Bank ID can register for different events — the hash is salted with the event ID.

## 7. Operator dashboard

Three sections today (we are simplifying these into separate pages next):

1. **Registration Desk.** The operator can also enter a registration on someone's behalf (kiosk scenario at the venue), and the QR + private link for the active event lives here.
2. **Event Dashboard.** Create new events, see the live count, export CSV, purge data. The registration table masks values until the operator clicks Reveal.
3. **Security Flow.** The exact talk track for the client — six steps explaining where the data sits, how it's encrypted, how duplicate detection works without decryption, and how retention is enforced. Includes the Encryption Key card (fingerprint + Rotate Key demo button).

The participant view (`?mode=register`) shows none of this — only the Quiz Calendar registration form branded for SCB.

## 8. Retention and deletion

Every registration document and every event document carries an `expiresAt` Firestore Timestamp. The retention window is configurable per event (default 90 days from the event date). Two paths to deletion:

- **Manual.** Operator clicks "Purge Event" in the dashboard. Event + all associated registrations are removed immediately.
- **Automatic.** Firestore TTL policy on `registrations.expiresAt` deletes documents within 24 hours of their expiry timestamp. The TTL policy is configured once in the Firebase console (Firestore → TTL → Add policy → field `expiresAt`).

In both cases the data is removed from Firestore. The encryption key, which lives outside Firestore, can also be rotated to make any old backups (if they ever existed) cryptographically useless.

## 9. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 (Create React App + craco), TailwindCSS, shadcn/ui, Lucide icons, Recharts |
| QR code | `qrcode` npm package, rendered to a data-URL `<img>` |
| Storage | Cloud Firestore (Google Cloud), location `asia-south1` (Mumbai) |
| Encryption | Web Crypto API (`crypto.subtle`) — no third-party crypto library |
| Auth (v1) | None at app layer; Firestore rules shape-validate writes. Operator dashboard is on a private URL. |
| Hosting | Vercel static deploy. Custom domain pluggable. |
| Realtime | Firestore `onSnapshot` for live dashboard count |
| CSV export | Synthesised in-browser, decrypts on demand |
| Local dev fallback | If Firebase env vars are missing, the app uses `localStorage` so the flow can be demoed offline |

No third-party SaaS in the data path. The entire stack is React in the browser + Firestore on Google Cloud + Vercel for static hosting.

## 10. Firestore security rules (v1)

```
service cloud.firestore {
  match /databases/{database}/documents {

    function hasEncryptedShape(field) {
      return field is string
        && (field.size() == 0 || field.matches('^enc:v1:.+\\..+'));
    }

    match /events/{eventId} {
      allow read: if true;
      allow create, update, delete: if true;  // V2: require operator claim.
    }

    match /registrations/{registrationId} {
      allow read: if true;
      allow create, update: if
        request.resource.data.eventId is string
        && exists(/databases/$(database)/documents/events/$(request.resource.data.eventId))
        && hasEncryptedShape(request.resource.data.fullName)
        && hasEncryptedShape(request.resource.data.employeeId)
        && hasEncryptedShape(request.resource.data.email)
        && hasEncryptedShape(request.resource.data.phone)
        && request.resource.data.participation in ['Yes', 'No']
        && request.resource.data.photoConsent is bool
        && request.resource.data.dedupeHash is string;
      allow delete: if true;
    }
  }
}
```

The rules block any write that does not carry the encrypted shape, regardless of what auth state the client claims. A malicious client cannot put plaintext into Firestore by bypassing the React app.

## 11. Technical challenges and how we handled them

1. **"We can't use a non-Google database."** Resolved by picking Cloud Firestore — a Google Cloud product billed on the client's Google account — instead of a custom Postgres or Mongo. Same surface area as a Google Sheet, but with proper rules, indexes, TTL, and live updates.

2. **"We can't hold personal data even by accident."** Solved by encrypting personal fields in the browser with AES-256-GCM before they ever hit Firestore. Even an accidental data dump shows ciphertext only. The Rotate Key demo proves the data is useless without the key.

3. **Duplicate prevention without reading personal data.** Solved by SHA-256 hashing the dedupe value with a per-event salt and using that hash as the Firestore document ID. The server never sees plain Bank IDs and still blocks repeat registrations.

4. **Live ops dashboard without polling.** Solved by Firestore `onSnapshot`. The dashboard re-renders within ~1 second of any write.

5. **Retention enforcement that survives operator forgetfulness.** Solved by writing an `expiresAt` Timestamp on every document and turning on Firestore TTL. The bank does not have to trust us to remember to delete the data — Firestore deletes it.

6. **Free Vercel/Firebase tier limits.** During the demo build we hit Vercel's hobby-tier daily deploy limit. The mitigation: GitHub-linked auto-deploy from `main` (one deploy per merge instead of one per save), and for the live call we are running from `localhost:3000` against the real Firestore project to avoid touching Vercel during the call. Production hosting moves off the hobby tier once SCB greenlights the work.

7. **Voice-of-the-client UI complexity.** The current operator dashboard has three tabs and packs a lot into one view. The next iteration splits this into three small pages: Create Event, Live Registrations, Security & Export — each with one job. Documented in the SLIDES deck.

## 12. What's not in v1, but is one merge away

- **Operator Firebase Auth.** Replace "read/write: if true" on `/registrations` with a custom-claim check (`request.auth.token.operator == true`). Operators sign in with Google; admin issues the claim once.
- **Audit log.** A `/audit` collection that records every reveal / decrypt / export / purge action with the operator's UID and timestamp.
- **Google Sheet mirror.** A Cloud Function trigger on `registrations` create that pushes a decrypted row into an SCB-approved Google Sheet — closes the loop on the client's existing workflow.
- **SSO with the bank.** Firebase Auth supports SAML/OIDC. If SCB has a single sign-on for vendor tools, we add the IdP and operators log in with their bank credentials.
- **Multi-language registration.** The participant view is a few labels — Tamil/Hindi swap is trivial once we know the audience.

## 13. The 12 PM IST demo — order of operations

A separate `DEMO_SCRIPT.md` is the step-by-step crib sheet. The headline beats:

1. Open the Security Flow tab. Walk through the six-step narrative.
2. Create the Quiz Calendar event (pre-filled defaults).
3. Open the participant view. Scan the QR from a phone.
4. Submit a registration on the phone. Watch the count tick up on the laptop.
5. Open Firebase console → Firestore → `registrations` collection. Show the row: `enc:v1:...` ciphertext, masked previews, expiresAt timestamp, SHA-256 doc ID.
6. Back in the dashboard, click Reveal (Decrypt). Show plaintext appears.
7. Submit the same Bank ID again on the phone — show the "you are already registered" dialog.
8. Click Rotate Key on the Security tab. Demo that prior records become `[decrypt failed]`. Refresh to restore the original key.
9. Export CSV. Show the file.
10. Purge Event. Show the dashboard go to zero and the Firestore documents disappear.

Total runtime: ~12 minutes. Q&A budget: 18 minutes. Demo plus discussion fits the one-hour slot.
