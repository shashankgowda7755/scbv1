import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { getFirebaseMode, fallbackToDemoMode, firestoreDb } from "@/lib/firebase";
import {
  ENCRYPTED_FIELDS,
  decryptString,
  encryptString,
  hashDedupeValue,
} from "@/lib/crypto";

const DEMO_STORAGE_KEY = "scb-firebase-demo-store-v5";

const DEMO_COLLECTIONS = ["events", "registrations", "checkins", "checkouts", "attendance"];

const SORT_FIELD = {
  events: "createdAt",
  registrations: "updatedAt",
  checkins: "checkInTime",
  checkouts: "checkOutTime",
  attendance: "computedAt",
};

const demoListeners = DEMO_COLLECTIONS.reduce((acc, name) => {
  acc[name] = new Set();
  return acc;
}, {});

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeString(value).replace(/[^\d+]/g, "");
}

function normalizeUniqueId(value) {
  return normalizeString(value).toUpperCase();
}

function buildMaskedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) {
    return normalized;
  }
  const [name, domain] = normalized.split("@");
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 2))}@${domain}`;
}

function buildMaskedPhone(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length <= 4) {
    return normalized;
  }
  return `${normalized.slice(0, 2)}${"*".repeat(Math.max(normalized.length - 4, 2))}${normalized.slice(-2)}`;
}

function buildMaskedIdentifier(value) {
  const normalized = normalizeString(value);
  if (normalized.length <= 4) {
    return normalized;
  }
  return `${normalized.slice(0, 2)}${"*".repeat(Math.max(normalized.length - 4, 2))}${normalized.slice(-2)}`;
}

function buildMaskedName(value) {
  const parts = normalizeString(value).split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "";
  }
  return parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.length > 1 ? "." : ""}`)
    .join(" ");
}

function pickDedupeValue(field, formData) {
  if (field === "email") {
    return normalizeEmail(formData.email);
  }
  if (field === "phone") {
    return normalizePhone(formData.phone);
  }
  return normalizeUniqueId(formData.employeeId);
}

function buildExpiresAt(eventDate, retentionDays) {
  const baseDate = eventDate ? new Date(eventDate) : new Date();
  const safeRetention = Number(retentionDays) || 90;
  return new Date(baseDate.getTime() + safeRetention * 24 * 60 * 60 * 1000);
}

function buildEventRecord(input) {
  const eventId = `${slugify(input.clientName)}-${slugify(input.title)}-${Date.now().toString(36)}`;
  const retentionDays = Number(input.retentionDays) || 90;
  const createdAt = new Date();

  return {
    id: eventId,
    clientName: normalizeString(input.clientName),
    title: normalizeString(input.title),
    location: normalizeString(input.location),
    eventDate: input.eventDate,
    duplicateField: input.duplicateField || "employeeId",
    retentionDays,
    notes: normalizeString(input.notes),
    status: "active",
    createdAt,
    expiresAt: buildExpiresAt(input.eventDate, retentionDays),
  };
}

async function encryptRegistrationFields(plainData) {
  const cipher = {};
  for (const field of ENCRYPTED_FIELDS) {
    cipher[field] = await encryptString(plainData[field] ?? "");
  }
  return cipher;
}

async function buildRegistrationRecord(event, formData, previousRecord) {
  const now = new Date();
  const dedupeValue = pickDedupeValue(event.duplicateField, formData);
  const dedupeHash = await hashDedupeValue(event.id, dedupeValue);

  const plainData = {
    fullName: normalizeString(formData.fullName),
    employeeId: normalizeUniqueId(formData.employeeId),
    email: normalizeEmail(formData.email),
    phone: normalizeString(formData.phone),
  };

  const encrypted = await encryptRegistrationFields(plainData);

  return {
    id: `${event.id}__${dedupeHash}`,
    eventId: event.id,
    eventTitle: event.title,
    clientName: event.clientName,
    duplicateField: event.duplicateField,
    dedupeHash,
    fullName: encrypted.fullName,
    employeeId: encrypted.employeeId,
    email: encrypted.email,
    phone: encrypted.phone,
    department: normalizeString(formData.department),
    city: normalizeString(formData.city),
    participation: formData.participation === "No" ? "No" : "Yes",
    photoConsent: Boolean(formData.photoConsent),
    consent: Boolean(formData.consent),
    maskedFullName: buildMaskedName(plainData.fullName),
    maskedEmail: buildMaskedEmail(plainData.email),
    maskedPhone: buildMaskedPhone(plainData.phone),
    maskedEmployeeId: buildMaskedIdentifier(plainData.employeeId),
    createdAt: previousRecord?.createdAt || now,
    updatedAt: now,
    expiresAt: buildExpiresAt(event.eventDate, event.retentionDays),
    revision: previousRecord ? (previousRecord.revision || 1) + 1 : 1,
    history: previousRecord
      ? [
          ...(previousRecord.history || []),
          {
            revision: previousRecord.revision || 1,
            replacedAt: now.toISOString(),
            maskedEmail: previousRecord.maskedEmail,
            maskedPhone: previousRecord.maskedPhone,
            maskedEmployeeId: previousRecord.maskedEmployeeId,
          },
        ]
      : [],
  };
}

export async function decryptRegistration(record) {
  if (!record) {
    return record;
  }
  const decrypted = { ...record };
  for (const field of ENCRYPTED_FIELDS) {
    try {
      decrypted[field] = await decryptString(record[field]);
    } catch (error) {
      decrypted[field] = "[decrypt failed]";
    }
  }
  return decrypted;
}

export async function decryptRegistrations(records) {
  return Promise.all((records || []).map(decryptRegistration));
}

export async function decryptAttendanceRow(record) {
  if (!record) return record;
  const decrypted = { ...record };
  for (const field of ["fullName", "uniqueId"]) {
    if (record[field]) {
      try {
        decrypted[field] = await decryptString(record[field]);
      } catch {
        decrypted[field] = "[decrypt failed]";
      }
    }
  }
  return decrypted;
}

function serializeDemoValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeDemoValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeDemoValue(nestedValue)]),
    );
  }
  return value;
}

function normalizeValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeValue(nestedValue)]),
    );
  }
  return value;
}

function normalizeFirestoreDoc(snapshot) {
  return normalizeValue({
    id: snapshot.id,
    ...snapshot.data(),
  });
}

function sortByNewest(items, field) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left[field] || 0).getTime();
    const rightTime = new Date(right[field] || 0).getTime();
    return rightTime - leftTime;
  });
}

function emptyDemoStore() {
  return DEMO_COLLECTIONS.reduce((acc, name) => {
    acc[name] = [];
    return acc;
  }, {});
}

function loadDemoStore() {
  if (typeof window === "undefined") {
    return emptyDemoStore();
  }
  const rawStore = window.localStorage.getItem(DEMO_STORAGE_KEY);
  if (!rawStore) {
    return emptyDemoStore();
  }
  try {
    const parsed = JSON.parse(rawStore);
    const store = emptyDemoStore();
    DEMO_COLLECTIONS.forEach((name) => {
      store[name] = sortByNewest(parsed[name] || [], SORT_FIELD[name]);
    });
    return store;
  } catch {
    return emptyDemoStore();
  }
}

function saveDemoStore(store) {
  if (typeof window === "undefined") {
    return;
  }
  const payload = DEMO_COLLECTIONS.reduce((acc, name) => {
    acc[name] = (store[name] || []).map(serializeDemoValue);
    return acc;
  }, {});
  window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(payload));
}

function notifyDemoListeners() {
  const currentStore = loadDemoStore();
  DEMO_COLLECTIONS.forEach((name) => {
    const sorted = sortByNewest(currentStore[name], SORT_FIELD[name]);
    demoListeners[name].forEach((listener) => listener(sorted));
  });
}

function upsertInArray(arr, record, idField = "id") {
  const next = arr.filter((item) => item[idField] !== record[idField]);
  next.unshift(record);
  return next;
}

async function createEventInFirestore(input) {
  const eventRecord = buildEventRecord(input);
  await setDoc(doc(firestoreDb, "events", eventRecord.id), eventRecord);
  return normalizeValue(eventRecord);
}

async function createEventInDemo(input) {
  const store = loadDemoStore();
  const eventRecord = normalizeValue(buildEventRecord(input));
  store.events = sortByNewest([eventRecord, ...store.events], "createdAt");
  saveDemoStore(store);
  notifyDemoListeners();
  return eventRecord;
}

async function saveRegistrationInFirestore({ event, formData, replace }) {
  const dedupeValue = pickDedupeValue(event.duplicateField, formData);
  const dedupeHash = await hashDedupeValue(event.id, dedupeValue);
  const recordId = `${event.id}__${dedupeHash}`;
  const registrationRef = doc(firestoreDb, "registrations", recordId);
  const existingSnapshot = await getDoc(registrationRef);
  const existingRecord = existingSnapshot.exists() ? normalizeFirestoreDoc(existingSnapshot) : null;

  if (existingRecord && !replace) {
    return { status: "duplicate", existingRecord };
  }

  const registrationRecord = await buildRegistrationRecord(event, formData, existingRecord);
  await setDoc(registrationRef, registrationRecord);

  return {
    status: existingRecord ? "updated" : "created",
    record: normalizeValue(registrationRecord),
  };
}

async function saveRegistrationInDemo({ event, formData, replace }) {
  const store = loadDemoStore();
  const dedupeValue = pickDedupeValue(event.duplicateField, formData);
  const dedupeHash = await hashDedupeValue(event.id, dedupeValue);
  const recordId = `${event.id}__${dedupeHash}`;
  const existingRecord = store.registrations.find((item) => item.id === recordId) || null;

  if (existingRecord && !replace) {
    return { status: "duplicate", existingRecord };
  }

  const registrationRecord = normalizeValue(
    await buildRegistrationRecord(event, formData, existingRecord),
  );

  store.registrations = sortByNewest(
    upsertInArray(store.registrations, registrationRecord),
    "updatedAt",
  );
  saveDemoStore(store);
  notifyDemoListeners();

  return {
    status: existingRecord ? "updated" : "created",
    record: registrationRecord,
  };
}

async function deleteEventCascade(eventId) {
  if (getFirebaseMode() === "firebase") {
    await deleteDoc(doc(firestoreDb, "events", eventId));
    for (const sub of ["registrations", "checkins", "checkouts", "attendance"]) {
      const snap = await getDocs(collection(firestoreDb, sub));
      await Promise.all(
        snap.docs
          .filter((d) => d.data().eventId === eventId)
          .map((d) => deleteDoc(doc(firestoreDb, sub, d.id))),
      );
    }
    return;
  }
  const store = loadDemoStore();
  store.events = store.events.filter((item) => item.id !== eventId);
  for (const sub of ["registrations", "checkins", "checkouts", "attendance"]) {
    store[sub] = (store[sub] || []).filter((item) => item.eventId !== eventId);
  }
  saveDemoStore(store);
  notifyDemoListeners();
}

function subscribeToFirestoreCollection(collectionName, callback, sortField, filter, onFallback) {
  const ref = filter
    ? query(collection(firestoreDb, collectionName), where(filter.field, "==", filter.value))
    : collection(firestoreDb, collectionName);
  return onSnapshot(
    ref,
    (snapshot) => {
      const records = snapshot.docs.map(normalizeFirestoreDoc);
      callback(sortByNewest(records, sortField));
    },
    (error) => {
      if (error?.code === "permission-denied" || error?.code === "unavailable") {
        fallbackToDemoMode(`Firestore ${error.code}: rules not deployed or offline`);
        if (onFallback) onFallback();
      }
    },
  );
}

function subscribeToDemoCollection(type, callback, sortField, filter) {
  const listener = (records) => {
    let filtered = records;
    if (filter) {
      filtered = records.filter((item) => item[filter.field] === filter.value);
    }
    callback(sortByNewest(filtered, sortField));
  };
  demoListeners[type].add(listener);
  listener(loadDemoStore()[type]);
  return () => {
    demoListeners[type].delete(listener);
  };
}

function subscribeCollection(name, callback, filter) {
  const sortField = SORT_FIELD[name];
  let firestoreUnsub = null;
  let demoUnsub = null;
  let usingDemo = false;
  function switchToDemo() {
    if (usingDemo) return;
    usingDemo = true;
    if (firestoreUnsub) {
      try { firestoreUnsub(); } catch {}
      firestoreUnsub = null;
    }
    demoUnsub = subscribeToDemoCollection(name, callback, sortField, filter);
  }
  if (getFirebaseMode() === "firebase") {
    firestoreUnsub = subscribeToFirestoreCollection(name, callback, sortField, filter, switchToDemo);
  } else {
    switchToDemo();
  }
  return () => {
    if (firestoreUnsub) try { firestoreUnsub(); } catch {}
    if (demoUnsub) try { demoUnsub(); } catch {}
  };
}

async function safeFirestoreWrite(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error?.code === "permission-denied" || error?.code === "unavailable") {
      fallbackToDemoMode(`Firestore ${error.code} on write: rules not deployed`);
      return { __fellBackToDemo: true };
    }
    throw error;
  }
}

export function getStoreMode() {
  return getFirebaseMode();
}

export async function probeFirestore() {
  if (getFirebaseMode() !== "firebase") return getFirebaseMode();
  try {
    await getDocs(collection(firestoreDb, "events"));
  } catch (error) {
    if (error?.code === "permission-denied" || error?.code === "unavailable") {
      fallbackToDemoMode(`Firestore ${error.code}: rules not deployed`);
    }
  }
  return getFirebaseMode();
}

export function subscribeEvents(callback) {
  return subscribeCollection("events", callback);
}

export function subscribeRegistrations(callback) {
  return subscribeCollection("registrations", callback);
}

export function subscribeCheckIns(callback, eventId) {
  return subscribeCollection("checkins", callback, eventId ? { field: "eventId", value: eventId } : null);
}

export function subscribeCheckOuts(callback, eventId) {
  return subscribeCollection("checkouts", callback, eventId ? { field: "eventId", value: eventId } : null);
}

export function subscribeAttendance(callback, eventId) {
  return subscribeCollection("attendance", callback, eventId ? { field: "eventId", value: eventId } : null);
}

export async function createEvent(input) {
  if (getFirebaseMode() === "firebase") {
    const r = await safeFirestoreWrite(() => createEventInFirestore(input));
    if (r && r.__fellBackToDemo) return createEventInDemo(input);
    return r;
  }
  return createEventInDemo(input);
}

export async function saveRegistration(payload) {
  if (getFirebaseMode() === "firebase") {
    const r = await safeFirestoreWrite(() => saveRegistrationInFirestore(payload));
    if (r && r.__fellBackToDemo) return saveRegistrationInDemo(payload);
    return r;
  }
  return saveRegistrationInDemo(payload);
}

export async function deleteEvent(eventId) {
  return deleteEventCascade(eventId);
}

// Wipe all child data for an event but keep the event doc itself.
// Used for "Reset Event Data" — re-run a dry-run or recovered event without
// destroying the event configuration (title, date, location, duplicate rule).
export async function resetEventData(eventId) {
  if (getFirebaseMode() === "firebase") {
    for (const sub of ["registrations", "checkins", "checkouts", "attendance"]) {
      const snap = await getDocs(collection(firestoreDb, sub));
      await Promise.all(
        snap.docs
          .filter((d) => d.data().eventId === eventId)
          .map((d) => deleteDoc(doc(firestoreDb, sub, d.id))),
      );
    }
    return;
  }
  const store = loadDemoStore();
  for (const sub of ["registrations", "checkins", "checkouts", "attendance"]) {
    store[sub] = (store[sub] || []).filter((item) => item.eventId !== eventId);
  }
  saveDemoStore(store);
  notifyDemoListeners();
}

export async function setEventStatus(eventId, status) {
  if (!["active", "closed"].includes(status)) {
    throw new Error(`Invalid event status: ${status}`);
  }
  if (getFirebaseMode() === "firebase") {
    await updateDoc(doc(firestoreDb, "events", eventId), { status });
  } else {
    const store = loadDemoStore();
    store.events = store.events.map((item) =>
      item.id === eventId ? { ...item, status } : item,
    );
    saveDemoStore(store);
    notifyDemoListeners();
  }
  if (status === "closed") {
    await computeAttendance(eventId);
  }
}

function dedupeValueOf(field, raw) {
  if (field === "email") return normalizeEmail(raw);
  if (field === "phone") return normalizePhone(raw);
  return normalizeUniqueId(raw);
}

async function findRegistrationByUniqueId(event, uniqueId) {
  const dedupeValue = dedupeValueOf(event.duplicateField, uniqueId);
  const dedupeHash = await hashDedupeValue(event.id, dedupeValue);
  const recordId = `${event.id}__${dedupeHash}`;
  if (getFirebaseMode() === "firebase") {
    const snap = await getDoc(doc(firestoreDb, "registrations", recordId));
    return snap.exists() ? { record: normalizeFirestoreDoc(snap), dedupeHash } : { record: null, dedupeHash };
  }
  const store = loadDemoStore();
  const record = store.registrations.find((item) => item.id === recordId) || null;
  return { record, dedupeHash };
}

export async function lookupRegistration(event, uniqueId) {
  const { record } = await findRegistrationByUniqueId(event, uniqueId);
  return record;
}

async function readEventDoc(eventId) {
  if (getFirebaseMode() === "firebase") {
    const snap = await getDoc(doc(firestoreDb, "events", eventId));
    return snap.exists() ? normalizeFirestoreDoc(snap) : null;
  }
  const store = loadDemoStore();
  return store.events.find((item) => item.id === eventId) || null;
}

async function readCollectionDoc(name, id) {
  if (getFirebaseMode() === "firebase") {
    const snap = await getDoc(doc(firestoreDb, name, id));
    return snap.exists() ? normalizeFirestoreDoc(snap) : null;
  }
  const store = loadDemoStore();
  return (store[name] || []).find((item) => item.id === id) || null;
}

async function writeCollectionDoc(name, record) {
  function writeDemo() {
    const store = loadDemoStore();
    store[name] = sortByNewest(upsertInArray(store[name] || [], record), SORT_FIELD[name]);
    saveDemoStore(store);
    notifyDemoListeners();
  }
  if (getFirebaseMode() === "firebase") {
    const r = await safeFirestoreWrite(() => setDoc(doc(firestoreDb, name, record.id), record));
    if (r && r.__fellBackToDemo) writeDemo();
    return;
  }
  writeDemo();
}

async function listCollectionByEvent(name, eventId) {
  if (getFirebaseMode() === "firebase") {
    try {
      const q = query(collection(firestoreDb, name), where("eventId", "==", eventId));
      const snap = await getDocs(q);
      return snap.docs.map(normalizeFirestoreDoc);
    } catch (e) {
      if (e?.code === "permission-denied" || e?.code === "unavailable") {
        fallbackToDemoMode(`Firestore ${e.code} on read`);
      } else {
        throw e;
      }
    }
  }
  const store = loadDemoStore();
  return (store[name] || []).filter((item) => item.eventId === eventId);
}

async function deleteCollectionDoc(name, id) {
  if (getFirebaseMode() === "firebase") {
    await deleteDoc(doc(firestoreDb, name, id));
    return;
  }
  const store = loadDemoStore();
  store[name] = (store[name] || []).filter((item) => item.id !== id);
  saveDemoStore(store);
  notifyDemoListeners();
}

async function buildAttendanceLog(event, kind, { uniqueId, fullName, registration }) {
  const now = new Date();
  const normalizedUniqueId = normalizeUniqueId(uniqueId);
  const normalizedFullName = normalizeString(fullName);
  const dedupeHash = registration
    ? registration.dedupeHash
    : await hashDedupeValue(event.id, dedupeValueOf(event.duplicateField, uniqueId));

  const encryptedUniqueId = await encryptString(normalizedUniqueId);
  const encryptedFullName = await encryptString(normalizedFullName);

  return {
    id: `${event.id}__${dedupeHash}`,
    eventId: event.id,
    eventTitle: event.title,
    dedupeHash,
    registrationId: registration?.id || null,
    walkInFlag: !registration,
    uniqueId: encryptedUniqueId,
    fullName: encryptedFullName,
    maskedUniqueId: buildMaskedIdentifier(normalizedUniqueId),
    maskedFullName: buildMaskedName(normalizedFullName || registration?.maskedFullName || ""),
    [kind === "checkin" ? "checkInTime" : "checkOutTime"]: now,
    createdAt: now,
    expiresAt: buildExpiresAt(event.eventDate, event.retentionDays),
  };
}

export async function saveCheckIn({ event, uniqueId, fullName }) {
  if (!event || event.status === "closed") {
    return { status: "event-closed" };
  }
  const lookup = await findRegistrationByUniqueId(event, uniqueId);
  const registration = lookup.record;
  const recordId = `${event.id}__${lookup.dedupeHash}`;

  const existing = await readCollectionDoc("checkins", recordId);
  if (existing) {
    return { status: "duplicate", existing };
  }

  const nameForRecord = fullName || (registration ? await decryptString(registration.fullName).catch(() => "") : "");
  const record = await buildAttendanceLog(event, "checkin", {
    uniqueId,
    fullName: nameForRecord,
    registration,
  });
  await writeCollectionDoc("checkins", record);

  return {
    status: registration ? "checked-in" : "walk-in",
    record,
    registration,
    displayName: nameForRecord,
  };
}

export async function saveCheckOut({ event, uniqueId, fullName }) {
  if (!event) return { status: "event-not-found" };

  const lookup = await findRegistrationByUniqueId(event, uniqueId);
  const registration = lookup.record;
  const recordId = `${event.id}__${lookup.dedupeHash}`;

  const existing = await readCollectionDoc("checkouts", recordId);
  if (existing) {
    return { status: "duplicate", existing };
  }

  const checkInRecord = await readCollectionDoc("checkins", recordId);

  const nameForRecord =
    fullName ||
    (registration ? await decryptString(registration.fullName).catch(() => "") : "") ||
    (checkInRecord ? await decryptString(checkInRecord.fullName).catch(() => "") : "");

  const record = await buildAttendanceLog(event, "checkout", {
    uniqueId,
    fullName: nameForRecord,
    registration,
  });
  await writeCollectionDoc("checkouts", record);

  let status;
  if (registration && checkInRecord) status = "complete";
  else if (registration && !checkInRecord) status = "reg-checkout-no-checkin";
  else if (!registration && checkInRecord) status = "walkin-complete";
  else status = "walkin-checkout";

  return { status, record, registration, checkInRecord, displayName: nameForRecord };
}

export async function deleteCheckIn(eventId, dedupeHash) {
  await deleteCollectionDoc("checkins", `${eventId}__${dedupeHash}`);
}

export async function deleteCheckOut(eventId, dedupeHash) {
  await deleteCollectionDoc("checkouts", `${eventId}__${dedupeHash}`);
}

export function classifyAttendance({ registration, checkIn, checkOut }) {
  const r = Boolean(registration);
  const i = Boolean(checkIn);
  const o = Boolean(checkOut);
  if (r && i && o) return "COMPLETE";
  if (r && i && !o) return "REG_CHECKIN";
  if (r && !i && o) return "REG_CHECKOUT";
  if (r && !i && !o) return "NO_SHOW";
  if (!r && i && o) return "WALKIN_COMPLETE";
  if (!r && i && !o) return "WALKIN_CHECKIN";
  if (!r && !i && o) return "WALKIN_CHECKOUT";
  return "UNKNOWN";
}

export const STATUS_LABEL = {
  COMPLETE: "Complete",
  REG_CHECKIN: "Reg + Check-In",
  REG_ONLY: "Registered Only",
  REG_CHECKOUT: "Reg + Checkout, No Check-In",
  WALKIN_COMPLETE: "Walk-In Complete",
  WALKIN_CHECKIN: "Walk-In Check-In Only",
  WALKIN_CHECKOUT: "Walk-In Checkout Only",
  NO_SHOW: "No-Show",
};

export async function computeAttendance(eventId) {
  const event = await readEventDoc(eventId);
  if (!event) return { count: 0, rows: [] };

  const [registrations, checkIns, checkOuts] = await Promise.all([
    listCollectionByEvent("registrations", eventId),
    listCollectionByEvent("checkins", eventId),
    listCollectionByEvent("checkouts", eventId),
  ]);

  const byHash = new Map();
  function bucket(hash) {
    if (!byHash.has(hash)) {
      byHash.set(hash, { registration: null, checkIn: null, checkOut: null });
    }
    return byHash.get(hash);
  }
  registrations.forEach((r) => (bucket(r.dedupeHash).registration = r));
  checkIns.forEach((c) => (bucket(c.dedupeHash).checkIn = c));
  checkOuts.forEach((c) => (bucket(c.dedupeHash).checkOut = c));

  const now = new Date();
  const rows = [];

  const existingAttendance = await listCollectionByEvent("attendance", eventId);
  const existingIds = new Set(existingAttendance.map((a) => a.id));

  for (const [hash, item] of byHash.entries()) {
    let statusCode = classifyAttendance(item);
    if (statusCode === "NO_SHOW" && item.registration) {
      statusCode = event.status === "closed" ? "NO_SHOW" : "REG_ONLY";
    }

    const id = `${eventId}__${hash}`;
    const source = item.registration || item.checkIn || item.checkOut;

    const record = {
      id,
      eventId,
      eventTitle: event.title,
      dedupeHash: hash,
      registrationId: item.registration?.id || null,
      checkInId: item.checkIn?.id || null,
      checkOutId: item.checkOut?.id || null,
      registrationTime: item.registration?.createdAt || null,
      checkInTime: item.checkIn?.checkInTime || null,
      checkOutTime: item.checkOut?.checkOutTime || null,
      walkInFlag: !item.registration,
      uniqueId: source.employeeId || source.uniqueId || "",
      fullName: source.fullName || "",
      maskedUniqueId:
        item.registration?.maskedEmployeeId ||
        item.checkIn?.maskedUniqueId ||
        item.checkOut?.maskedUniqueId ||
        "",
      maskedFullName:
        item.registration?.maskedFullName ||
        item.checkIn?.maskedFullName ||
        item.checkOut?.maskedFullName ||
        "",
      statusCode,
      computedAt: now,
      expiresAt: buildExpiresAt(event.eventDate, event.retentionDays),
    };
    rows.push(record);
    await writeCollectionDoc("attendance", record);
    existingIds.delete(id);
  }

  for (const staleId of existingIds) {
    await deleteCollectionDoc("attendance", staleId);
  }

  return { count: rows.length, rows };
}

export async function closeEvent(eventId) {
  await setEventStatus(eventId, "closed");
}

export async function reopenEvent(eventId) {
  await setEventStatus(eventId, "active");
}

export function seedScbDemoEvent() {
  return createEvent({
    clientName: "Standard Chartered Bank",
    title: "CSR Activity Chennai - Quiz Calendar Creation",
    location: "DLF Downtown",
    eventDate: "2026-05-09",
    duplicateField: "employeeId",
    retentionDays: 90,
    notes:
      "Volunteers design Quiz Calendars to help students learn important dates and events each month. Bank ID prevents duplicate sign-ups. Photo consent captured per participant.",
  });
}
