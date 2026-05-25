# SCB Event Registration — Text Inventory

Every visible string in the app, grouped by screen. Edit any line and tell me which to swap in. We use this to finalize ONE version of the copy before splitting the UI.

Format per row: `key: "current text" → final: ___`. Leave `final: ___` blank to keep current.

---

## 0. Global defaults (event seed values)

These pre-fill the event creation form so the demo opens ready.

```
event.clientName:    "Standard Chartered Bank"
event.title:         "CSR Activity Chennai - Quiz Calendar Creation"
event.location:      "DLF Downtown"
event.eventDate:     "2026-05-09"
event.duplicateField: "Bank ID"  (options: Bank ID / Email Address / Mobile Number)
event.retentionDays: 90
event.notes:         "Volunteers design Quiz Calendars for students. Bank ID = duplicate key. Photo consent captured per participant."
```

---

## 1. Browser tab + meta

| Key | Current |
|---|---|
| `<title>` | SCB Event Registration Demo |
| meta description | Firebase-backed event registration and dashboard demo for Standard Chartered workflows. |

---

## 2. Operator shell — hero strip (top of dashboard)

| Key | Current |
|---|---|
| Badge label | Standard Chartered Demo Stack |
| H1 title | Firebase-based event registration, dashboard visibility, and client-safe data flow. |
| Intro paragraph | This demo is now aligned to the meeting: a Google-backed storage model, event-wise QR registration, duplicate control, a live dashboard, export handoff, and a clear post-event purge path. |
| Pill 1 (when Firestore live) | Connected to Firestore |
| Pill 1 (when in demo mode) | Demo mode, Firebase-ready |
| Pill 2 | Dashboard masks sensitive fields by default |
| Pill 3 | Field-level AES-256-GCM encryption |
| Pill 4 | Retention tracked per event |

### Metric cards

| Label | Value source |
|---|---|
| Active Events | count of events |
| Total Registrations | count of registrations |
| Selected Event | count of registrations for the currently-selected event (subtitle = event title, or "Create an event to begin" when none) |

---

## 3. Tabs

| Tab | Current label |
|---|---|
| Tab 1 | Registration Desk |
| Tab 2 | Event Dashboard |
| Tab 3 | Security Flow |

---

## 4. Tab 1 — Registration Desk

### Card: Capture Registration (left)

| Element | Current text |
|---|---|
| Title | Capture Registration |
| Description | Employees land on this form from the QR code or a private link. Duplicate prevention is event-specific. |
| Label `event` | Selected Event |
| Placeholder (event select) | Select an event |
| Label `Duplicate Control` | Duplicate Control |
| Empty-event hint | Create an event first |
| Label `fullName` | Participant Name |
| Placeholder | Roshney Mathew |
| Label `employeeId` | Bank ID |
| Placeholder | SCB-EMP-1042 |
| Label `participation` | Participation |
| Options | Yes / No |
| Label `email` | Email Address (optional) |
| Placeholder | name@sc.com |
| Label `phone` | Mobile Number (optional) |
| Placeholder | +91 98765 43210 |
| Label `department` | Department (optional) |
| Placeholder | Retail Banking |
| Photo consent checkbox | By registering for this event, the participant consents to processing and usage of their photos and videos for event management and internal communication purposes. |
| Retention consent checkbox | Capture this record for the selected event and retain it only for the event window. |
| Submit button (idle) | Submit Registration |
| Submit button (busy) | Processing... |

### Card: Event QR and Private Link (right top)

| Element | Current text |
|---|---|
| Title | Event QR and Private Link |
| Description | Generate one QR per event so the client can distribute the registration page internally. |
| QR fallback | QR preview unavailable |
| Label | Share Link |
| Copy button | Copy |
| Copy success | Registration link copied. |
| Copy failure | Copy failed. Use the link shown in the dashboard. |
| Open new tab link | Open participant view in a new tab → |
| Empty state | Create an event from the dashboard to generate the QR link. |

### Card: What the Client Sees (right bottom)

| Element | Current text |
|---|---|
| Title | What the Client Sees |
| Description | A plain-language walkthrough of how the data moves once the QR is scanned. |
| Step 1 title | 1. QR or private link |
| Step 1 desc | The client shares a single event-specific link or QR code only with the intended employees. |
| Step 2 title | 2. Registration page |
| Step 2 desc | Employees land on the event page, enter their details, and the form validates before save. |
| Step 3 title | 3. Google-backed storage |
| Step 3 desc | The data is written to Cloud Firestore in Firebase, inside the client's approved Google ecosystem. |
| Step 4 title | 4. Dashboard and export |
| Step 4 desc | Operations can review live registrations, export the final CSV, then purge the event data post campaign. |

---

## 5. Tab 2 — Event Dashboard

### Card: Create Event (left)

| Element | Current text |
|---|---|
| Title | Create Event |
| Description | This is the client-facing setup step: define the event, duplicate rule, retention window, and the demo link. |
| Empty banner | No event exists yet. Start by creating one or seed the Standard Chartered demo event. |
| Seed button | Load SCB Demo Event |
| Label `clientName` | Client Name |
| Label `title` | Event Title |
| Placeholder | Rewards Campaign Registration |
| Label `location` | Location |
| Placeholder | Chennai Regional Hub |
| Label `eventDate` | Event Date |
| Label `Duplicate Blocking Key` | Duplicate Blocking Key |
| Options | Employee ID / Email Address / Mobile Number |
| Label `retentionDays` | Retention Window |
| Label `notes` | Client Notes |
| Notes placeholder | Mention approved collection fields, event contacts, or data handling notes. |
| Submit (idle) | Create Event and QR Flow |
| Submit (busy) | Creating event... |

### Card: Live Dashboard (right top)

| Element | Current text |
|---|---|
| Title | Live Dashboard |
| Description | Show the client exactly where the data lands and how the registration count can be monitored. |
| Summary labels | Client / Event Date / Retention Until / Duplicate Rule |
| CSV button | Export CSV |
| Reveal button (mask on) | Reveal (Decrypt) |
| Reveal button (mask off) | Mask Off |
| Reveal button (busy) | Decrypting... |
| Purge button | Purge Event |
| Empty state | Create or select an event to see the dashboard, exports, and purge controls. |

### Card: Selected Event Registrations (right bottom)

| Element | Current text |
|---|---|
| Title | Selected Event Registrations |
| Description | Sensitive fields are masked by default in the dashboard, but the export retains the full dataset. |
| Columns | Name / Bank ID / Participation / Photo Consent / Revision |
| Empty row | No registrations for this event yet. |

---

## 6. Tab 3 — Security Flow

### Card: Security and Storage Narrative for the Client (left)

| Step | Title | Description |
|---|---|---|
| 1 | Website surface | The page can be hosted on the client-approved website or private event URL. The data path is designed around Firebase instead of a custom database. |
| 2 | Storage path | Registrations are stored in Firestore with an event ID, timestamps, duplicate key, and retention date. The live collections for this demo are: `events/{eventId}` and `registrations/{eventId}__sha256(dedupe)`. |
| 3 | Field-level encryption | Name, employee ID, email, and mobile are encrypted in the browser with AES-256-GCM before they hit Firestore. The key is held by us (not stored next to the data). Even if the database is ever leaked, the rows look like `email: "enc:v1:<iv>.<ciphertext>"`. |
| 4 | Duplicate detection without decryption | The duplicate-control value (employee ID / email / mobile) is SHA-256 hashed with a per-event salt and used as the Firestore document ID. The server never needs to see the plain value to block duplicates. |
| 5 | Duplicate prevention | Each event defines one duplicate control field. The app blocks repeat registrations for that value and allows an explicit replace action so the client can see the previous record before updating it. |
| 6 | Retention and deletion | Every record stores an `expiresAt` date. That supports either manual purge from the dashboard or a Firestore TTL policy for automated cleanup after the agreed retention window. |

### Card: Encryption Key (right top)

| Element | Current text |
|---|---|
| Title | Encryption Key |
| Description | The AES-256 key is held by the operator and never written to Firestore. Rotating it makes prior records unreadable. |
| Row label 1 | Active Key Fingerprint |
| Row label 2 | Algorithm — value: AES-GCM, 256-bit, 96-bit IV per record |
| Row label 3 | Encrypted Fields — value: fullName, employeeId, email, phone |
| Rotate button (idle) | Rotate Key (Demo) |
| Rotate button (busy) | Rotating... |
| Rotate confirm dialog | Generate a brand-new encryption key? Existing encrypted records will become unreadable. Useful for the demo to show that the data is meaningless without the key. |

### Card: Meeting Translation (right bottom)

| Row label | Row value |
|---|---|
| What they rejected | Custom storage that feels outside Google or looks hard to audit. |
| What they asked to see | A full module: QR entry, data landing point, dashboard, and the final send-to-client format. |
| What this version demonstrates | Event creation, QR generation, duplicate-safe registration, live dashboard, CSV export, and post-event purge. |
| What still depends on Firebase credentials | Real Firestore writes in production mode and the final project-specific security rules. |

---

## 7. Participant view (`?mode=register`)

| Element | Current text |
|---|---|
| Hero badge | Standard Chartered |
| Hero title (when event loaded) | (event title — e.g. "CSR Activity Chennai - Quiz Calendar Creation") |
| Hero title (no event) | Event Registration |
| Hero subtitle (with event) | (client name) · (location) |
| Hero subtitle (no event) | This link is configured for a specific Standard Chartered event. |
| Pill 1 | Encrypted before save |
| Pill 2 | Stored in Google Firestore |
| Card title | Welcome to the Quiz Calendar Creation |
| Card body | Thank you for being part of this creative initiative. We will be designing Quiz Calendars to help students create their own calendar while learning about the important dates and events in each month. Please fill out the form below to mark your attendance. |
| Event meta line | **Date:** {eventDate} · **Location:** {location} |
| Label | Full Name * |
| Label | Bank ID * |
| Label | Participation * |
| Options | Yes / No |
| Photo consent | By registering for this event, you consent to processing and usage of your photos and videos for event management and internal communication purposes. |
| Submit (idle) | Submit Registration |
| Submit (busy) | Submitting... |

### Duplicate dialog (participant view)

| Element | Current text |
|---|---|
| Title | You are already registered |
| Body | We already have a record for this {Bank ID / Email Address / Mobile Number}. Submit again to update it, or close to keep the existing entry. |
| Keep button | Keep Existing |
| Update button | Update My Entry |

---

## 8. Duplicate dialog (operator view)

| Element | Current text |
|---|---|
| Title | Duplicate registration detected |
| Body | This event already has a registration for the selected {Bank ID / Email Address / Mobile Number}. |
| Row labels | Name / Employee ID / Email / Phone / Last Updated / Revision |
| Keep button | Keep Existing |
| Replace button | Replace Registration |

---

## 9. Toasts / alerts

| Code path | Current text |
|---|---|
| Success — event created | Event "{title}" is ready. You can now share the QR code or registration link. |
| Error — create event | Unable to create the event right now. Please check the Firebase configuration and try again. |
| Success — registration created | Registration captured successfully. |
| Success — registration updated | Existing registration updated successfully. |
| Error — registration save | The registration could not be saved. Please retry after checking the selected event. |
| Success — duplicate replaced | The existing registration has been replaced and revision history was preserved. |
| Error — duplicate replace | Unable to replace the existing registration right now. |
| Success — purge | Event data purged successfully. |
| Error — purge | Unable to purge the event right now. |
| Success — CSV export | Encrypted records decrypted in-browser and exported as CSV for the client handoff. |
| Error — CSV export | Export failed. The key fingerprint shown in Security may have changed since the data was written. |
| Success — seed demo | Standard Chartered demo event created. You can now walk the client through the full flow. |
| Error — seed demo | Unable to seed the demo event right now. |
| Success — key rotated | New key generated ({fingerprint}). Prior records can no longer be decrypted. |
| Banner — demo mode | Firebase environment variables are not configured yet, so the demo is currently running in browser-backed demo mode. The UI, flow, duplicate logic, dashboard, QR generation, and Firestore data model are ready to switch over as soon as the Firebase keys are added. |

---

## 10. Validation messages

| Trigger | Current text |
|---|---|
| Empty client name | Client name is required. |
| Empty event title | Event title is required. |
| Empty event location | Event location is required. |
| Empty event date | Event date is required. |
| No event selected | Create or select an event before taking registrations. |
| Empty name | Participant name is required. |
| Empty Bank ID | Bank ID is required. |
| Bad Bank ID format | Bank ID must be at least 3 characters and use letters, numbers, dots, hyphens, or underscores. |
| Bad email | Enter a valid email address or leave it blank. |
| Bad phone | Enter a valid mobile number or leave it blank. |
| Missing dedupe value | A value for {Bank ID / Email Address / Mobile Number} is required to block duplicates. |

---

## 11. CSV export columns

`Event, Client, Participant Name, Bank ID, Email, Phone, Department, City, Participation, Photo Consent, Revision, Created At, Updated At, Expires At`

---

## What to do with this file

Three ways to give me edits:

1. **Inline rewrite.** Open this file, change the right side of any line, save, tell me "swap from TEXT_INVENTORY.md".
2. **Diff list.** Paste a list like `change "Capture Registration" → "New Registration"` and I batch-apply.
3. **Section drop.** Tell me to drop a whole card or step. E.g. "remove Meeting Translation card" — I delete it and the related JSX.
