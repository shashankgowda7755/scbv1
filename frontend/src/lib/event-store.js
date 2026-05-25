import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
} from "firebase/firestore";

import { firebaseMode, firestoreDb } from "@/lib/firebase";
import {
  ENCRYPTED_FIELDS,
  decryptString,
  encryptString,
  hashDedupeValue,
} from "@/lib/crypto";

const DEMO_STORAGE_KEY = "scb-firebase-demo-store-v4";

const demoListeners = {
  events: new Set(),
  registrations: new Set(),
};

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
    .map((part) => `${part.charAt(0).toUpperCase()}${part.length > 1 ? "."  : ""}`)
    .join(" ");
}

function pickDedupeValue(field, formData) {
  if (field === "email") {
    return normalizeEmail(formData.email);
  }
  if (field === "phone") {
    return normalizePhone(formData.phone);
  }
  return normalizeString(formData.employeeId).toUpperCase();
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
    employeeId: normalizeString(formData.employeeId).toUpperCase(),
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
    // Encrypted ciphertext blobs — what actually lands in Firestore.
    fullName: encrypted.fullName,
    employeeId: encrypted.employeeId,
    email: encrypted.email,
    phone: encrypted.phone,
    // Non-PII fields stay in clear.
    department: normalizeString(formData.department),
    city: normalizeString(formData.city),
    participation: formData.participation === "No" ? "No" : "Yes",
    photoConsent: Boolean(formData.photoConsent),
    consent: Boolean(formData.consent),
    // Masked previews stored in clear so the dashboard can show something
    // without ever decrypting. Mask is deterministic and reveals no full value.
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

function loadDemoStore() {
  if (typeof window === "undefined") {
    return { events: [], registrations: [] };
  }
  const rawStore = window.localStorage.getItem(DEMO_STORAGE_KEY);
  if (!rawStore) {
    return { events: [], registrations: [] };
  }
  try {
    const parsedStore = JSON.parse(rawStore);
    return {
      events: sortByNewest(parsedStore.events || [], "createdAt"),
      registrations: sortByNewest(parsedStore.registrations || [], "updatedAt"),
    };
  } catch (error) {
    return { events: [], registrations: [] };
  }
}

function saveDemoStore(store) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    DEMO_STORAGE_KEY,
    JSON.stringify({
      events: store.events.map(serializeDemoValue),
      registrations: store.registrations.map(serializeDemoValue),
    }),
  );
}

function notifyDemoListeners() {
  const currentStore = loadDemoStore();
  demoListeners.events.forEach((listener) => {
    listener(sortByNewest(currentStore.events, "createdAt"));
  });
  demoListeners.registrations.forEach((listener) => {
    listener(sortByNewest(currentStore.registrations, "updatedAt"));
  });
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

  const nextRegistrations = store.registrations.filter((item) => item.id !== recordId);
  nextRegistrations.unshift(registrationRecord);
  store.registrations = sortByNewest(nextRegistrations, "updatedAt");
  saveDemoStore(store);
  notifyDemoListeners();

  return {
    status: existingRecord ? "updated" : "created",
    record: registrationRecord,
  };
}

async function deleteEventInFirestore(eventId) {
  await deleteDoc(doc(firestoreDb, "events", eventId));
  const registrationsSnapshot = await getDocs(collection(firestoreDb, "registrations"));
  const deletions = registrationsSnapshot.docs
    .filter((snapshot) => snapshot.data().eventId === eventId)
    .map((snapshot) => deleteDoc(doc(firestoreDb, "registrations", snapshot.id)));
  await Promise.all(deletions);
}

async function deleteEventInDemo(eventId) {
  const store = loadDemoStore();
  store.events = store.events.filter((item) => item.id !== eventId);
  store.registrations = store.registrations.filter((item) => item.eventId !== eventId);
  saveDemoStore(store);
  notifyDemoListeners();
}

function subscribeToFirestoreCollection(collectionName, callback, sortField) {
  return onSnapshot(collection(firestoreDb, collectionName), (snapshot) => {
    const records = snapshot.docs.map(normalizeFirestoreDoc);
    callback(sortByNewest(records, sortField));
  });
}

function subscribeToDemoCollection(type, callback, sortField) {
  const listener = (records) => {
    callback(sortByNewest(records, sortField));
  };
  demoListeners[type].add(listener);
  listener(loadDemoStore()[type]);
  return () => {
    demoListeners[type].delete(listener);
  };
}

export function getStoreMode() {
  return firebaseMode;
}

export function subscribeEvents(callback) {
  if (firebaseMode === "firebase") {
    return subscribeToFirestoreCollection("events", callback, "createdAt");
  }
  return subscribeToDemoCollection("events", callback, "createdAt");
}

export function subscribeRegistrations(callback) {
  if (firebaseMode === "firebase") {
    return subscribeToFirestoreCollection("registrations", callback, "updatedAt");
  }
  return subscribeToDemoCollection("registrations", callback, "updatedAt");
}

export async function createEvent(input) {
  if (firebaseMode === "firebase") {
    return createEventInFirestore(input);
  }
  return createEventInDemo(input);
}

export async function saveRegistration(payload) {
  if (firebaseMode === "firebase") {
    return saveRegistrationInFirestore(payload);
  }
  return saveRegistrationInDemo(payload);
}

export async function deleteEvent(eventId) {
  if (firebaseMode === "firebase") {
    return deleteEventInFirestore(eventId);
  }
  return deleteEventInDemo(eventId);
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
