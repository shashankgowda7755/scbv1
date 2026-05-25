import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseAuth, firestoreDb, isDemoMode } from "./firebase";

const DEMO_USERS_KEY = "scb-demo-users";
const DEMO_SESSION_KEY = "scb-demo-session";

function readDemoUsers() {
  try {
    return JSON.parse(window.localStorage.getItem(DEMO_USERS_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeDemoUsers(list) {
  window.localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(list));
}
function readDemoSession() {
  try {
    return JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}
function writeDemoSession(user) {
  if (user) window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(DEMO_SESSION_KEY);
}

const demoListeners = new Set();
function emitDemo(user) {
  demoListeners.forEach((cb) => {
    try { cb(user); } catch {}
  });
}

export function observeAuth(cb) {
  if (isDemoMode() || !firebaseAuth) {
    const current = readDemoSession();
    cb(current);
    demoListeners.add(cb);
    return () => demoListeners.delete(cb);
  }
  return onAuthStateChanged(firebaseAuth, (u) => {
    cb(u ? { uid: u.uid, email: u.email } : null);
  });
}

export async function signIn(email, password) {
  if (isDemoMode() || !firebaseAuth) {
    const users = readDemoUsers();
    const found = users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!found) throw new Error("Invalid email or password.");
    const session = { uid: found.uid, email: found.email };
    writeDemoSession(session);
    emitDemo(session);
    return session;
  }
  const cred = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  return { uid: cred.user.uid, email: cred.user.email };
}

export async function signOutUser() {
  if (isDemoMode() || !firebaseAuth) {
    writeDemoSession(null);
    emitDemo(null);
    return;
  }
  await signOut(firebaseAuth);
}

export async function createAdminUser({ email, password, createdBy }) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) throw new Error("Email and password required.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  if (isDemoMode() || !firebaseAuth) {
    const users = readDemoUsers();
    if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error("User already exists.");
    }
    const newUser = {
      uid: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email: cleanEmail,
      password,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || "",
    };
    users.push(newUser);
    writeDemoUsers(users);
    return { uid: newUser.uid, email: newUser.email, createdAt: newUser.createdAt, createdBy: newUser.createdBy };
  }

  const cred = await createUserWithEmailAndPassword(firebaseAuth, cleanEmail, password);
  // Mirror to /users for listing (client SDK can't list auth users).
  await setDoc(doc(firestoreDb, "users", cred.user.uid), {
    uid: cred.user.uid,
    email: cleanEmail,
    createdAt: serverTimestamp(),
    createdBy: createdBy || "",
  });
  return { uid: cred.user.uid, email: cleanEmail };
}

export async function listAdminUsers() {
  if (isDemoMode() || !firebaseAuth) {
    return readDemoUsers().map((u) => ({
      uid: u.uid, email: u.email, createdAt: u.createdAt, createdBy: u.createdBy,
    }));
  }
  const snap = await getDocs(query(collection(firestoreDb, "users"), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: data.uid || d.id,
      email: data.email,
      createdAt: data.createdAt?.toDate?.().toISOString?.() || "",
      createdBy: data.createdBy || "",
    };
  });
}

export function hasAnyDemoUser() {
  return readDemoUsers().length > 0;
}
