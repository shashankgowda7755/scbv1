import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
];

const FORCE_DEMO_KEY = "SCB_FORCE_DEMO";

function readForceDemo() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FORCE_DEMO_KEY) === "1";
}

function writeForceDemo(on) {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(FORCE_DEMO_KEY, "1");
  else window.localStorage.removeItem(FORCE_DEMO_KEY);
}

const configOk = requiredConfig.every(Boolean);
let _mode = !configOk || readForceDemo() ? "demo" : "firebase";
let _fallbackReason = "";
const listeners = new Set();

let firestoreDb = null;
if (configOk) {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  firestoreDb = getFirestore(app);
}

export const firebaseMode = _mode; // legacy const for first-paint reads
export function getFirebaseMode() {
  return _mode;
}
export function isDemoMode() {
  return _mode === "demo";
}
export function fallbackToDemoMode(reason) {
  if (_mode === "demo") return;
  _mode = "demo";
  _fallbackReason = reason || "Firestore unavailable";
  writeForceDemo(true);
  listeners.forEach((cb) => {
    try {
      cb({ mode: _mode, reason: _fallbackReason });
    } catch {}
  });
}
export function reenableFirestoreMode() {
  writeForceDemo(false);
  // requires reload because subscribers attached against demo store
  if (typeof window !== "undefined") window.location.reload();
}
export function getFallbackReason() {
  return _fallbackReason;
}
export function onFirebaseModeChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export { firestoreDb, firebaseConfig };
