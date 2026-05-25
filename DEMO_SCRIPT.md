# SCB Client Demo Script (12:00 IST call)

**Audience:** Pinaki + Eswar (SCB), with Mohan / Roshney / Das on our side.
**Goal:** Show that registration → storage → dashboard → handoff → purge stays inside the Google ecosystem and that PII is encrypted at rest.

**Demo event:** `CSR Activity Chennai - Quiz Calendar Creation` · 09 May 2026 · DLF Downtown.
Mirrors the existing communitree.co.in Google Form: Full Name, Bank ID, Participation (Yes/No), Photo Consent.

---

## 0. Before the call

1. `cd /Users/mukesh/scbv1/frontend && yarn start`
2. Open `http://localhost:3000` in two windows:
   - **Operator** window (Dashboard tab visible).
   - **Participant** window (will open via QR after event is created).
3. Confirm hero badges show:
   - "Demo mode, Firebase-ready" (or "Connected to Firestore" if env keys are set)
   - "Field-level AES-256-GCM encryption"
4. Open **Security Flow** tab once. Note the **Key Fingerprint** (`kid-xxxxxx`). Mention it later.

---

## 1. Open with the data-flow story (90 sec)

Read off the **Security Flow** tab:

- **Website surface.** Hosted on the client-approved domain (Vercel today, swappable to GoDaddy / Google).
- **Storage path.** Cloud Firestore — a Google product. No third-party DB.
  - Collections: `events/{eventId}` and `registrations/{eventId}__sha256(dedupe)`.
- **Field-level encryption.** Name, employee ID, email, mobile are AES-256-GCM encrypted in the browser before they hit Firestore. Operator holds the key. Even if Firestore leaks, the rows look like `email: "enc:v1:<iv>.<ciphertext>"`.
- **Duplicate detection without decryption.** Dedupe key is SHA-256 hashed with a per-event salt. Server blocks duplicates without ever seeing plaintext.
- **Retention.** Every record has `expiresAt`. Manual purge from dashboard or automatic via Firestore TTL.

---

## 2. Create the event (60 sec)

1. Dashboard tab → form on the left.
2. Pre-filled: Client = `Standard Chartered Bank`, Title = `CSR Activity Chennai - Quiz Calendar Creation`, Location = `DLF Downtown`, Date = `2026-05-09`, Duplicate Key = `Bank ID`, Retention = `90` days.
3. Click **Create Event and QR Flow**.
4. App jumps to the Dashboard view showing the new event.

---

## 3. Show the QR + private link (60 sec)

1. Switch to **Registration Desk** tab.
2. Point to the QR panel on the right.
3. Say: "This QR is unique per event. SCB shares it only internally — it never gets indexed."
4. Click **Open participant view in a new tab →** (or scan the QR with a phone). The participant window opens.
5. Note that the participant page **has no admin controls** — just the registration form, branded for SCB.

---

## 4. Submit a registration (60 sec)

In the participant window (matches the existing Google Form fields):
- Full Name: `Roshney Mathew`
- Bank ID: `SCB-EMP-1042`
- Participation: `Yes`
- Photo consent: leave checked
- Click **Submit Registration**.

Switch back to the operator window. Dashboard count ticks up to 1 in real time (Firestore `onSnapshot`, no refresh).

---

## 5. Prove encryption at rest (90 sec)

This is the headline moment. In the **Selected Event Registrations** table:

1. Default view (Mask On) shows: `R. M.`, `SC**42`, plus Participation = `Yes`, Photo Consent = `Yes`. Say: "Operations only see masked previews by default."
2. Open Chrome DevTools → **Application → Local Storage → `scb-firebase-demo-store-v4`**. Expand the registration. Point at:
   - `fullName: "enc:v1:..."`
   - `employeeId: "enc:v1:..."`
   - `email: ""` (left blank — Quiz Calendar form doesn't collect it)
   - `id: "...__a3f2..."` (SHA-256 hashed dedupe, not the real ID).
3. Say: "That's exactly what Firestore would store. Even if someone exfiltrates it, the PII is unreadable."
4. Close DevTools. Click **Reveal (Decrypt)**. Table flips to plaintext. Say: "This decryption happens in-browser using the operator key. The key never travels with the data."

---

## 6. Duplicate prevention (45 sec)

In the participant window, submit again with the same employee ID but a different name.
- Operator window shows a modal: "Duplicate registration detected" with the existing record's masked fields and revision number.
- Click **Keep Existing** — record unchanged.
- Re-submit, click **Replace Registration** — revision bumps to 2, history kept.

---

## 7. Key rotation (30 sec) — only if they ask hard security questions

1. Security Flow tab → **Encryption Key** card → **Rotate Key (Demo)**.
2. Confirm. Fingerprint changes.
3. Switch back to Dashboard, hit Reveal — the table shows `[decrypt failed]`.
4. Say: "Without the original key, the data is useless. This is the same posture as customer-managed keys in any Google Cloud service."

> Skip this in the first run unless Pinaki/Eswar push on "what if Mukesh leaves / key compromised". If you rotate the key, the rest of the demo can't reveal those records — refresh + re-seed if needed.

---

## 8. CSV handoff + purge (45 sec)

1. **Export CSV.** Decryption happens in-browser, file downloads with full PII. "This is the final handoff format for the SCB ops team."
2. **Purge Event.** Confirm dialog. Event + registrations removed. Dashboard count drops to zero.
3. Note: in production this is the manual trigger; the same `expiresAt` field powers Firestore TTL for automatic cleanup.

---

## 9. Close

- "Everything you saw lives in your Google tenant — Firestore + Firebase Auth + Cloud Functions if you need server-side rules. No third-party SaaS in the data path."
- "The encryption key is operator-held today. If your IT prefers KMS / customer-managed keys, we wire it to `REACT_APP_DATA_KEY` from your secret manager — no code change."

---

## Recovery if something breaks

- **QR doesn't generate.** Hard refresh (Cmd+Shift+R). The `qrcode` library is bundled, no network needed.
- **Participant submit hangs.** Demo mode writes to `localStorage`. Make sure both windows are on the same origin.
- **Reveal shows `[decrypt failed]`.** You rotated the key after data was written. Hit `Reload SCB Demo Event` (or wipe `scb-firebase-demo-store-v4` + `SCB_DATA_KEY_V1` in DevTools).
- **Tab UI looks broken.** Window too narrow. Use a real laptop, not a phone, for the operator view.
