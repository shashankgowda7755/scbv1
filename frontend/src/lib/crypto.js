// AES-GCM 256 field-level encryption for sensitive registration fields.
//
// Demo story for the SCB call:
//   - Every sensitive value (email, phone, employee ID, full name) is encrypted
//     in the browser with a 256-bit AES-GCM key before it ever leaves the page.
//   - The Firestore document stores only `{ ct, iv }` ciphertext — even if the
//     database is leaked, no PII is readable without the key.
//   - The key is held by us (the operator), not stored alongside the data. In
//     the demo it lives in `localStorage` under `SCB_DATA_KEY_V1`. In production
//     it would come from `REACT_APP_DATA_KEY` (build-time env) or a KMS.
//   - The dedupe value is hashed with SHA-256 + a per-event salt, so duplicate
//     detection works without ever decrypting anything.

const STORAGE_KEY = "SCB_DATA_KEY_V1";
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;
const PREFIX = "enc:v1:";

function getSubtle() {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error("Web Crypto API is not available in this environment.");
  }
  return window.crypto.subtle;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary);
}

function base64ToBytes(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function generateRandomBytes(length) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

async function importRawKey(rawKey) {
  return getSubtle().importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

let cachedKey = null;
let cachedKeyBytes = null;

function readKeyFromStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value || null;
}

function writeKeyToStorage(base64) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, base64);
}

async function loadOrCreateKey() {
  if (cachedKey) {
    return cachedKey;
  }

  const envKey = process.env.REACT_APP_DATA_KEY;
  let base64 = envKey || readKeyFromStorage();

  if (!base64) {
    const rawKey = generateRandomBytes(KEY_LENGTH_BITS / 8);
    base64 = bytesToBase64(rawKey);
    writeKeyToStorage(base64);
  }

  const rawKey = base64ToBytes(base64);
  cachedKeyBytes = rawKey;
  cachedKey = await importRawKey(rawKey);
  return cachedKey;
}

export async function getKeyFingerprint() {
  await loadOrCreateKey();
  if (!cachedKeyBytes) {
    return "unavailable";
  }
  const digestBuffer = await getSubtle().digest("SHA-256", cachedKeyBytes);
  const digestBytes = new Uint8Array(digestBuffer);
  const hex = Array.from(digestBytes.slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `kid-${hex}`;
}

export async function regenerateKey() {
  const rawKey = generateRandomBytes(KEY_LENGTH_BITS / 8);
  const base64 = bytesToBase64(rawKey);
  writeKeyToStorage(base64);
  cachedKeyBytes = rawKey;
  cachedKey = await importRawKey(rawKey);
  return getKeyFingerprint();
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export async function encryptString(plainText) {
  if (plainText === null || plainText === undefined || plainText === "") {
    return "";
  }
  const key = await loadOrCreateKey();
  const iv = generateRandomBytes(IV_LENGTH_BYTES);
  const encoded = new TextEncoder().encode(String(plainText));
  const cipherBuffer = await getSubtle().encrypt({ name: "AES-GCM", iv }, key, encoded);
  const cipherBytes = new Uint8Array(cipherBuffer);
  return `${PREFIX}${bytesToBase64(iv)}.${bytesToBase64(cipherBytes)}`;
}

export async function decryptString(payload) {
  if (!isEncrypted(payload)) {
    return payload == null ? "" : String(payload);
  }
  const [ivB64, cipherB64] = payload.slice(PREFIX.length).split(".");
  if (!ivB64 || !cipherB64) {
    throw new Error("Malformed ciphertext payload.");
  }
  const key = await loadOrCreateKey();
  const iv = base64ToBytes(ivB64);
  const cipherBytes = base64ToBytes(cipherB64);
  const plainBuffer = await getSubtle().decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
  return new TextDecoder().decode(plainBuffer);
}

export async function hashDedupeValue(eventId, dedupeValue) {
  const input = `${eventId}::${String(dedupeValue || "").toLowerCase()}`;
  const digestBuffer = await getSubtle().digest("SHA-256", new TextEncoder().encode(input));
  const digestBytes = new Uint8Array(digestBuffer);
  return Array.from(digestBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

export const ENCRYPTED_FIELDS = ["fullName", "employeeId", "email", "phone"];
