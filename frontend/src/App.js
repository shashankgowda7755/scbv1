import { Component, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { AlertTriangle, BarChart3, CalendarPlus, CheckCircle2, ClipboardList, Database, Download, Eye, EyeOff, FilePlus, FileText, KeyRound, Link2, LockKeyhole, LogOut, PlayCircle, QrCode, RefreshCw, ShieldCheck, Trash2, UserPlus, XCircle } from "lucide-react";

import "@/App.css";
import {
  getStoreMode,
  subscribeEvents,
  subscribeRegistrations,
  subscribeCheckIns,
  subscribeCheckOuts,
  subscribeAttendance,
  createEvent,
  deleteEvent,
  resetEventData,
  saveRegistration,
  saveCheckIn,
  saveCheckOut,
  computeAttendance,
  closeEvent,
  reopenEvent,
  seedScbDemoEvent,
  decryptRegistrations,
  decryptRegistration,
  decryptAttendanceRow,
  probeFirestore,
  STATUS_LABEL,
} from "@/lib/event-store";
import { onFirebaseModeChange, getFallbackReason, reenableFirestoreMode } from "@/lib/firebase";
import { observeAuth, signIn, signOutUser, createAdminUser, listAdminUsers } from "@/lib/auth";

const BUILD_STAMP = "v2.9-activate-toggle-2026-05-25";
import { getKeyFingerprint, regenerateKey } from "@/lib/crypto";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const duplicateFieldLabels = {
  employeeId: "Bank ID",
  email: "Email Address",
  phone: "Mobile Number",
};

const participationOptions = ["Yes", "No"];

const registrationDefaults = {
  fullName: "",
  employeeId: "",
  email: "",
  phone: "",
  department: "",
  city: "",
  participation: "Yes",
  photoConsent: true,
  consent: true,
};

const eventDefaults = {
  clientName: "Standard Chartered Bank",
  title: "CSR Activity Chennai - Quiz Calendar Creation",
  location: "DLF Downtown",
  eventDate: "2026-05-09",
  duplicateField: "employeeId",
  retentionDays: 90,
  notes:
    "Volunteers design Quiz Calendars for students. Bank ID = duplicate key. Photo consent captured per participant.",
};

function statusPillClass(code) {
  switch (code) {
    case "COMPLETE":
    case "WALKIN_COMPLETE":
      return "status-pill-good";
    case "NO_SHOW":
      return "status-pill-bad";
    case "REG_ONLY":
    case "REG_CHECKIN":
    case "REG_CHECKOUT":
    case "WALKIN_CHECKIN":
    case "WALKIN_CHECKOUT":
      return "status-pill-warn";
    default:
      return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[c]);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString();
}

function buildModeUrl(eventId, mode) {
  const url = new URL(window.location.href);
  url.searchParams.set("event", eventId);
  url.searchParams.set("mode", mode);
  url.hash = mode;
  return url.toString();
}

function getEventShareUrl(eventId) {
  return buildModeUrl(eventId, "register");
}

function getCheckInUrl(eventId) {
  return buildModeUrl(eventId, "checkin");
}

function getCheckOutUrl(eventId) {
  return buildModeUrl(eventId, "checkout");
}

const PARTICIPANT_MODES = new Set(["register", "checkin", "checkout"]);

function eventStatusLabel(status) {
  return status === "closed" ? "INACTIVE" : "ACTIVE";
}

function getParticipantMode() {
  if (typeof window === "undefined") return null;
  const mode = new URLSearchParams(window.location.search).get("mode");
  return PARTICIPANT_MODES.has(mode) ? mode : null;
}

function validateEventForm(formData) {
  if (!formData.clientName.trim()) {
    return "Client name is required.";
  }

  if (!formData.title.trim()) {
    return "Event title is required.";
  }

  if (!formData.location.trim()) {
    return "Event location is required.";
  }

  if (!formData.eventDate) {
    return "Event date is required.";
  }

  return null;
}

function validateRegistrationForm(event, formData) {
  if (!event) {
    return "Create or select an event before taking registrations.";
  }

  if (!formData.fullName.trim()) {
    return "Participant name is required.";
  }

  if (!formData.employeeId.trim()) {
    return "Bank ID is required.";
  }

  if (!/^[A-Z0-9._-]{3,}$/i.test(formData.employeeId.trim())) {
    return "Bank ID must be at least 3 characters and use letters, numbers, dots, hyphens, or underscores.";
  }

  // Email / phone / department / city are optional for the Quiz Calendar form
  // schema. Only validate the format when the field has a value.
  if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
    return "Enter a valid email address or leave it blank.";
  }

  if (formData.phone.trim() && !/^[0-9+\-()\s]{7,20}$/.test(formData.phone.trim())) {
    return "Enter a valid mobile number or leave it blank.";
  }

  const duplicateValue = event.duplicateField === "email"
    ? formData.email.trim()
    : event.duplicateField === "phone"
      ? formData.phone.trim()
      : formData.employeeId.trim();

  if (!duplicateValue) {
    return `A value for ${duplicateFieldLabels[event.duplicateField]} is required to block duplicates.`;
  }

  return null;
}

async function downloadCsv(filename, rows) {
  const header = [
    "Event",
    "Client",
    "Participant Name",
    "Bank ID",
    "Email",
    "Phone",
    "Department",
    "City",
    "Participation",
    "Photo Consent",
    "Revision",
    "Created At",
    "Updated At",
    "Expires At",
  ];

  // Decrypt right before export so the client handoff file has the full data.
  const decryptedRows = await decryptRegistrations(rows);

  const safeRows = decryptedRows.map((row) => [
    row.eventTitle,
    row.clientName,
    row.fullName,
    row.employeeId,
    row.email,
    row.phone,
    row.department,
    row.city,
    row.participation || "Yes",
    row.photoConsent ? "Yes" : "No",
    row.revision,
    row.createdAt,
    row.updatedAt,
    row.expiresAt,
  ]);

  const csvContent = [header, ...safeRows]
    .map((columns) => columns.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ParticipantCheckIn({ event, form, setForm, result, busy, onSubmit, walkInOpen, setWalkInOpen, onWalkInConfirm }) {
  const [walkInName, setWalkInName] = useState("");
  return (
    <div className="gform-page">
      <main className="gform-shell">
        <div className="gform-header">
          <h1>{event ? `${event.title} — Check-In` : "Event Check-In"}</h1>
          <p className="gform-lead"><strong>Welcome.</strong> Enter your Unique ID to mark your attendance.</p>
          {event && (
            <p className="gform-meta">
              <strong>Date:</strong> {formatDate(event.eventDate)}<br />
              <strong>Location:</strong> {event.location}
            </p>
          )}
        </div>

        {result && result.kind !== "duplicate" && (
          <div className="gform-alert gform-alert-success">
            <CheckCircle2 className="inline h-4 w-4 mr-2" />
            {result.displayName ? `Welcome, ${result.displayName}.` : "Walk-in check-in recorded."} Time: {formatDateTime(result.time)}.
          </div>
        )}
        {result && result.kind === "duplicate" && (
          <div className="gform-alert gform-alert-error">
            <XCircle className="inline h-4 w-4 mr-2" />
            Already checked in at {formatDateTime(result.time)}.
          </div>
        )}

        <form className="gform-form" onSubmit={onSubmit}>
          <div className="gform-q">
            <label htmlFor="ci-id">Unique ID <span className="gform-star">*</span></label>
            <input
              id="ci-id"
              className="gform-input"
              autoFocus
              autoComplete="off"
              placeholder="SCB-EMP-1042"
              value={form.uniqueId}
              onChange={(e) => setForm((f) => ({ ...f, uniqueId: e.target.value }))}
            />
          </div>
          <button type="submit" className="gform-submit" disabled={busy || !event}>
            {busy ? "Checking in..." : "Check In"}
          </button>
        </form>

        {walkInOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h2 className="text-xl font-semibold">No registration found</h2>
              <p className="text-sm text-slate-600">
                Capture as walk-in. Add the attendee's name for the report.
              </p>
              <div className="gform-q">
                <label htmlFor="walkin-name">Full Name</label>
                <input
                  id="walkin-name"
                  className="gform-input"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="gform-submit" style={{ background: "#71717A" }} onClick={() => setWalkInOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="gform-submit" onClick={() => onWalkInConfirm(walkInName.trim() || "Walk-in")}>
                  Record Walk-In
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ParticipantCheckOut({ event, form, setForm, result, busy, onSubmit }) {
  return (
    <div className="gform-page">
      <main className="gform-shell">
        <div className="gform-header">
          <h1>{event ? `${event.title} — Checkout` : "Event Checkout"}</h1>
          <p className="gform-lead"><strong>Thank you for attending.</strong> Enter your Unique ID to check out.</p>
          {event && (
            <p className="gform-meta">
              <strong>Date:</strong> {formatDate(event.eventDate)}<br />
              <strong>Location:</strong> {event.location}
            </p>
          )}
        </div>

        {result && result.kind !== "duplicate" && (
          <div className="gform-alert gform-alert-success">
            <CheckCircle2 className="inline h-4 w-4 mr-2" />
            Checkout recorded at {formatDateTime(result.time)}.
          </div>
        )}
        {result && result.kind === "duplicate" && (
          <div className="gform-alert gform-alert-error">
            <XCircle className="inline h-4 w-4 mr-2" />
            Already checked out at {formatDateTime(result.time)}.
          </div>
        )}

        <form className="gform-form" onSubmit={onSubmit}>
          <div className="gform-q">
            <label htmlFor="co-id">Unique ID <span className="gform-star">*</span></label>
            <input
              id="co-id"
              className="gform-input"
              autoFocus
              autoComplete="off"
              placeholder="SCB-EMP-1042"
              value={form.uniqueId}
              onChange={(e) => setForm((f) => ({ ...f, uniqueId: e.target.value }))}
            />
          </div>
          <button type="submit" className="gform-submit" disabled={busy || !event}>
            {busy ? "Checking out..." : "Check Out"}
          </button>
        </form>
      </main>
    </div>
  );
}

function LoginScreen({ storeMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await signIn(email, password);
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scb-login-wrap">
      <div className="scb-login-card">
        <div className="scb-login-brand">
          <div className="scb-sidebar-logo">SCB</div>
          <div>
            <div className="scb-sidebar-name">Event Platform</div>
            <div className="scb-sidebar-sub">Internal admin sign-in</div>
          </div>
        </div>

        <form onSubmit={submit} className="scb-login-form">
          <Label htmlFor="login-email">Work email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@tndwwt.org"
          />
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {err && (
            <Alert className="status-alert border-red-300 bg-red-50">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <AlertDescription className="text-red-900">{err}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="scb-login-foot">
          Access by invitation only. No self-signup. An existing admin must add your email from the Admin Users page.
          {storeMode === "demo" && " Demo mode — credentials live in this browser only."}
        </p>
      </div>
    </div>
  );
}

function App() {
  const [storeMode, setStoreMode] = useState(getStoreMode());
  const [fallbackBanner, setFallbackBanner] = useState("");
  const participantMode = getParticipantMode();
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [userForm, setUserForm] = useState({ email: "", password: "" });
  const [userBusy, setUserBusy] = useState(false);
  const [userMsg, setUserMsg] = useState({ type: "", text: "" });
  const [events, setEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [checkOuts, setCheckOuts] = useState([]);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [activeTab, _setActiveTab] = useState("events");
  const setActiveTab = (next) => {
    _setActiveTab(next);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const [registrationForm, setRegistrationForm] = useState(registrationDefaults);
  const [eventForm, setEventForm] = useState(eventDefaults);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [submitting, setSubmitting] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [duplicateState, setDuplicateState] = useState({
    open: false,
    event: null,
    existingRecord: null,
    pendingRegistration: null,
  });
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [privacyMode, setPrivacyMode] = useState(true);
  const [copyMessage, setCopyMessage] = useState("");
  const [decryptedById, setDecryptedById] = useState({});
  const [decryptingReveal, setDecryptingReveal] = useState(false);
  const [keyFingerprint, setKeyFingerprint] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);

  // Check-In / Checkout local state
  const [checkInForm, setCheckInForm] = useState({ uniqueId: "", fullName: "" });
  const [checkOutForm, setCheckOutForm] = useState({ uniqueId: "", fullName: "" });
  const [checkInResult, setCheckInResult] = useState(null);
  const [checkOutResult, setCheckOutResult] = useState(null);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [checkOutBusy, setCheckOutBusy] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);

  // Reports
  const [reportFilter, setReportFilter] = useState("ALL");
  const [reportBusy, setReportBusy] = useState(false);
  const [decryptedAttendance, setDecryptedAttendance] = useState([]);

  useEffect(() => {
    getKeyFingerprint()
      .then(setKeyFingerprint)
      .catch(() => setKeyFingerprint("unavailable"));
    probeFirestore().then((mode) => {
      setStoreMode(mode);
      if (mode === "demo" && getFallbackReason()) {
        setFallbackBanner(getFallbackReason());
      }
    });
    const offMode = onFirebaseModeChange(({ mode, reason }) => {
      setStoreMode(mode);
      if (mode === "demo") setFallbackBanner(reason || "Switched to local store");
    });
    return () => offMode();
  }, []);

  // Subscribe to auth state. Participant mode bypasses login entirely.
  useEffect(() => {
    if (participantMode) {
      setAuthReady(true);
      return undefined;
    }
    const unsub = observeAuth((user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, [participantMode]);

  // Reload admin users when signed in.
  useEffect(() => {
    if (!authUser) { setAdminUsers([]); return; }
    listAdminUsers().then(setAdminUsers).catch(() => setAdminUsers([]));
  }, [authUser]);

  async function handleAddAdminUser(e) {
    e?.preventDefault?.();
    setUserBusy(true);
    setUserMsg({ type: "", text: "" });
    try {
      await createAdminUser({ email: userForm.email, password: userForm.password, createdBy: authUser?.email || "" });
      setUserForm({ email: "", password: "" });
      setUserMsg({ type: "success", text: `Added ${userForm.email.trim().toLowerCase()}.` });
      const fresh = await listAdminUsers();
      setAdminUsers(fresh);
    } catch (e2) {
      setUserMsg({ type: "error", text: e2?.message || String(e2) });
    } finally {
      setUserBusy(false);
    }
  }

  async function handleSignOut() {
    try { await signOutUser(); } catch {}
  }

  // Auto-dismiss success/error messages after 6s
  useEffect(() => {
    if (!message.text) return undefined;
    const t = window.setTimeout(() => setMessage({ type: "", text: "" }), 6000);
    return () => window.clearTimeout(t);
  }, [message.text]);

  function handleHardReset() {
    if (!window.confirm("Clear all local data and reload? This wipes events/registrations/check-ins held in this browser.")) return;
    try {
      Object.keys(window.localStorage).filter((k) => k.startsWith("scb-") || k === "SCB_FORCE_DEMO" || k === "SCB_DATA_KEY_V1").forEach((k) => window.localStorage.removeItem(k));
    } catch {}
    window.location.reload();
  }

  useEffect(() => {
    // Participant routes only need events (to resolve the event id from the URL).
    // Loading every registration / check-in / check-out / attendance row on a phone
    // over a slow connection was hanging the participant page for some operators.
    const unsubEvents = subscribeEvents(setEvents);
    if (participantMode) {
      return () => unsubEvents();
    }
    const unsubRegs = subscribeRegistrations(setRegistrations);
    const unsubIns = subscribeCheckIns(setCheckIns);
    const unsubOuts = subscribeCheckOuts(setCheckOuts);
    const unsubAtt = subscribeAttendance(setAttendanceRows);
    return () => {
      unsubEvents();
      unsubRegs();
      unsubIns();
      unsubOuts();
      unsubAtt();
    };
  }, [participantMode]);

  useEffect(() => {
    if (!events.length) {
      setSelectedEventId("");
      setActiveTab("events");
      return;
    }

    const urlEventId = new URLSearchParams(window.location.search).get("event");
    const nextSelected = events.find((event) => event.id === urlEventId)?.id
      || events.find((event) => event.id === selectedEventId)?.id
      || events[0].id;

    setSelectedEventId(nextSelected);

    const hash = window.location.hash.replace("#", "");
    if (hash === "register") setActiveTab("registrations");
    else if (hash === "checkin") setActiveTab("checkin");
    else if (hash === "checkout") setActiveTab("checkout");
  }, [events, selectedEventId]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) || null;
  const eventRegistrations = registrations.filter((r) => r.eventId === selectedEventId);
  const eventCheckIns = checkIns.filter((c) => c.eventId === selectedEventId);
  const eventCheckOuts = checkOuts.filter((c) => c.eventId === selectedEventId);
  const eventAttendance = attendanceRows.filter((a) => a.eventId === selectedEventId);

  const walkInCount = eventAttendance.filter((a) => a.walkInFlag).length;
  const completeCount = eventAttendance.filter((a) => a.statusCode === "COMPLETE").length;
  const noShowCount = eventAttendance.filter((a) => a.statusCode === "NO_SHOW").length;
  // "Did not" counters answer the operator's audit questions directly.
  const didNotCheckInCount = eventAttendance.filter((a) => a.registrationTime && !a.checkInTime).length;
  const didNotCheckOutCount = eventAttendance.filter((a) => a.checkInTime && !a.checkOutTime).length;
  const didNotRegisterCount = walkInCount; // walked in without registering
  const statusCounts = Object.keys(STATUS_LABEL).reduce((acc, code) => {
    acc[code] = eventAttendance.filter((a) => a.statusCode === code).length;
    return acc;
  }, {});
  const completionRate = eventRegistrations.length
    ? Math.round((completeCount / eventRegistrations.length) * 100)
    : 0;

  // Decrypt visible rows whenever privacy mode is off or new rows arrive.
  useEffect(() => {
    if (privacyMode) {
      return;
    }
    let cancelled = false;
    setDecryptingReveal(true);
    Promise.all(
      eventRegistrations.map(async (record) => {
        if (decryptedById[record.id] && decryptedById[record.id].updatedAt === record.updatedAt) {
          return [record.id, decryptedById[record.id]];
        }
        const decrypted = await decryptRegistration(record);
        return [record.id, decrypted];
      }),
    )
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setDecryptedById((current) => {
          const next = { ...current };
          for (const [id, value] of entries) {
            next[id] = value;
          }
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) {
          setDecryptingReveal(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // decryptedById is intentionally excluded — including it would loop because
    // this effect calls setDecryptedById on every run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyMode, eventRegistrations]);

  // Duplicate dialog needs the existing record decrypted so the operator can
  // confirm it really is the same person before replacing.
  const [duplicateDecrypted, setDuplicateDecrypted] = useState(null);
  useEffect(() => {
    if (!duplicateState.open || !duplicateState.existingRecord) {
      setDuplicateDecrypted(null);
      return;
    }
    let cancelled = false;
    decryptRegistration(duplicateState.existingRecord).then((decrypted) => {
      if (!cancelled) {
        setDuplicateDecrypted(decrypted);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [duplicateState.open, duplicateState.existingRecord]);

  const decryptedRows = useMemo(
    () => eventRegistrations.map((record) => decryptedById[record.id] || null),
    [eventRegistrations, decryptedById],
  );

  const globalStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const eventsThisMonth = events.filter((e) => new Date(e.eventDate) >= monthStart).length;
    const regsThisMonth = registrations.filter((r) => new Date(r.createdAt) >= monthStart).length;
    const sortedEvents = [...events].sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate)).slice(0, 6);
    const trend = sortedEvents.map((e) => {
      const evRegs = registrations.filter((r) => r.eventId === e.id).length;
      const evAttendance = attendanceRows.filter((a) => a.eventId === e.id);
      const completed = evAttendance.filter((a) => a.statusCode === "COMPLETE").length;
      const rate = evRegs ? Math.round((completed / evRegs) * 100) : 0;
      return { id: e.id, title: e.title, date: e.eventDate, rate };
    });
    return { eventsThisMonth, regsThisMonth, trend };
  }, [events, registrations, attendanceRows]);

  // Recompute attendance whenever check-in/checkout state changes for the selected event.
  // Lightweight: writes one doc per unique attendee, idempotent.
  useEffect(() => {
    if (!selectedEventId || participantMode) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      computeAttendance(selectedEventId).catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [selectedEventId, eventCheckIns.length, eventCheckOuts.length, eventRegistrations.length, selectedEvent?.status, participantMode]);

  // Decrypt attendance rows for the report view.
  useEffect(() => {
    let cancelled = false;
    Promise.all(eventAttendance.map(decryptAttendanceRow)).then((rows) => {
      if (!cancelled) setDecryptedAttendance(rows);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceRows, selectedEventId]);
  const totalRegistrations = registrations.length;
  const shareUrl = selectedEvent ? getEventShareUrl(selectedEvent.id) : "";

  useEffect(() => {
    let isMounted = true;

    if (!shareUrl) {
      setQrCodeUrl("");
      return undefined;
    }

    QRCode.toDataURL(shareUrl, {
      width: 320,
      margin: 1,
      color: {
        dark: "#0A0A0A",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (isMounted) {
          setQrCodeUrl(dataUrl);
        }
      })
      .catch(() => {
        if (isMounted) {
          setQrCodeUrl("");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [shareUrl]);

  useEffect(() => {
    if (!copyMessage) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCopyMessage("");
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [copyMessage]);

  function updateRegistrationField(name, value) {
    setRegistrationForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setMessage({ type: "", text: "" });
  }

  function updateEventField(name, value) {
    setEventForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
    setMessage({ type: "", text: "" });
  }

  async function handleCreateEvent(event) {
    event.preventDefault();

    const validationError = validateEventForm(eventForm);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setCreatingEvent(true);
    try {
      const createdEvent = await createEvent(eventForm);
      setSelectedEventId(createdEvent.id);
      setEventForm({
        ...eventDefaults,
        title: "",
        location: "",
        notes: "",
      });
      setActiveTab("qrshare");
      setMessage({
        type: "success",
        text: `Event "${createdEvent.title}" is ready. You can now share the QR code or registration link.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: "Unable to create the event right now. Please check the Firebase configuration and try again.",
      });
    } finally {
      setCreatingEvent(false);
    }
  }

  async function handleRegistrationSubmit(event) {
    event.preventDefault();

    const validationError = validateRegistrationForm(selectedEvent, registrationForm);
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setSubmitting(true);
    try {
      const result = await saveRegistration({
        event: selectedEvent,
        formData: registrationForm,
        replace: false,
      });

      if (result.status === "duplicate") {
        setDuplicateState({
          open: true,
          event: selectedEvent,
          existingRecord: result.existingRecord,
          pendingRegistration: registrationForm,
        });
        return;
      }

      setRegistrationForm(registrationDefaults);
      setMessage({
        type: "success",
        text: result.status === "updated"
          ? "Existing registration updated successfully."
          : "Registration captured successfully.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: "The registration could not be saved. Please retry after checking the selected event.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDuplicateReplace() {
    if (!duplicateState.event || !duplicateState.pendingRegistration) {
      return;
    }

    setSubmitting(true);
    try {
      await saveRegistration({
        event: duplicateState.event,
        formData: duplicateState.pendingRegistration,
        replace: true,
      });
      setRegistrationForm(registrationDefaults);
      setMessage({
        type: "success",
        text: "The existing registration has been replaced and revision history was preserved.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: "Unable to replace the existing registration right now.",
      });
    } finally {
      setSubmitting(false);
      setDuplicateState({
        open: false,
        event: null,
        existingRecord: null,
        pendingRegistration: null,
      });
    }
  }

  async function handleDeleteEvent() {
    if (!selectedEvent) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${selectedEvent.title}" and all related registrations? This simulates the post-event purge requested by the client.`,
    );

    if (!shouldDelete) {
      return;
    }

    try {
      await deleteEvent(selectedEvent.id);
      setMessage({
        type: "success",
        text: "Event data purged successfully.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: "Unable to purge the event right now.",
      });
    }
  }

  async function handleResetEventData(eventOrId) {
    const ev = typeof eventOrId === "string"
      ? events.find((e) => e.id === eventOrId)
      : (eventOrId || selectedEvent);
    if (!ev) return;
    const typed = window.prompt(
      `This wipes ALL data tied to "${ev.title}" — registrations, check-ins, check-outs, attendance — but keeps the event itself so you can re-run it.\n\nType the word RESET to confirm.`,
    );
    if (typed !== "RESET") {
      if (typed !== null) setMessage({ type: "error", text: "Reset cancelled — confirmation word didn't match." });
      return;
    }
    try {
      await resetEventData(ev.id);
      setMessage({ type: "success", text: `Event data reset for "${ev.title}". Event preserved.` });
    } catch (error) {
      setMessage({ type: "error", text: `Failed to reset event data: ${error?.message || error}` });
    }
  }

  async function handleCopyShareLink() {
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage("Registration link copied.");
    } catch (error) {
      setCopyMessage("Copy failed. Use the link shown in the dashboard.");
    }
  }

  async function handleExportSelectedEvent() {
    if (!selectedEvent) {
      return;
    }

    try {
      await downloadCsv(
        `${selectedEvent.clientName}-${selectedEvent.title}-registrations.csv`.replace(/\s+/g, "-").toLowerCase(),
        eventRegistrations,
      );
      setMessage({
        type: "success",
        text: "Encrypted records decrypted in-browser and exported as CSV for the client handoff.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: "Export failed. The key fingerprint shown in Security may have changed since the data was written.",
      });
    }
  }

  async function handleRegenerateKey() {
    const proceed = window.confirm(
      "Generate a brand-new encryption key? Existing encrypted records will become unreadable. Useful for the demo to show that the data is meaningless without the key.",
    );
    if (!proceed) {
      return;
    }
    setKeyBusy(true);
    try {
      const fingerprint = await regenerateKey();
      setKeyFingerprint(fingerprint);
      setDecryptedById({});
      setPrivacyMode(true);
      setMessage({
        type: "success",
        text: `New key generated (${fingerprint}). Prior records can no longer be decrypted.`,
      });
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleCheckInSubmit(event) {
    event.preventDefault();
    if (!selectedEvent) {
      setMessage({ type: "error", text: "Select an event before running check-in." });
      return;
    }
    const trimmedId = checkInForm.uniqueId.trim();
    if (!trimmedId) {
      setMessage({ type: "error", text: "Enter the attendee's Unique ID to check in." });
      return;
    }
    setCheckInBusy(true);
    try {
      const result = await saveCheckIn({
        event: selectedEvent,
        uniqueId: trimmedId,
        fullName: checkInForm.fullName.trim(),
      });
      if (result.status === "duplicate") {
        const t = result.existing.checkInTime;
        setCheckInResult({ kind: "duplicate", time: t, masked: result.existing.maskedUniqueId });
        setMessage({ type: "error", text: `Already checked in at ${formatDateTime(t)}.` });
        setCheckInBusy(false);
        return;
      }
      if (result.status === "event-closed") {
        setMessage({ type: "error", text: "Event is closed. Reopen the event to accept check-ins." });
        setCheckInBusy(false);
        return;
      }
      if (result.status === "walk-in" && !checkInForm.fullName.trim()) {
        setWalkInOpen(true);
        setCheckInBusy(false);
        return;
      }
      setCheckInResult({
        kind: result.status,
        time: result.record.checkInTime,
        displayName: result.displayName,
        masked: result.record.maskedUniqueId,
      });
      setCheckInForm({ uniqueId: "", fullName: "" });
      setMessage({
        type: "success",
        text: result.status === "walk-in"
          ? `Walk-in check-in recorded at ${formatDateTime(result.record.checkInTime)}.`
          : `${result.displayName || "Attendee"} checked in at ${formatDateTime(result.record.checkInTime)}.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: "Check-in failed. Retry." });
    } finally {
      setCheckInBusy(false);
    }
  }

  async function handleCheckOutSubmit(event) {
    event.preventDefault();
    if (!selectedEvent) {
      setMessage({ type: "error", text: "Select an event before running checkout." });
      return;
    }
    const trimmedId = checkOutForm.uniqueId.trim();
    if (!trimmedId) {
      setMessage({ type: "error", text: "Enter the attendee's Unique ID to check out." });
      return;
    }
    setCheckOutBusy(true);
    try {
      const result = await saveCheckOut({
        event: selectedEvent,
        uniqueId: trimmedId,
        fullName: checkOutForm.fullName.trim(),
      });
      if (result.status === "duplicate") {
        const t = result.existing.checkOutTime;
        setCheckOutResult({ kind: "duplicate", time: t, masked: result.existing.maskedUniqueId });
        setMessage({ type: "error", text: `Already checked out at ${formatDateTime(t)}.` });
        setCheckOutBusy(false);
        return;
      }
      setCheckOutResult({
        kind: result.status,
        time: result.record.checkOutTime,
        displayName: result.displayName,
        masked: result.record.maskedUniqueId,
      });
      setCheckOutForm({ uniqueId: "", fullName: "" });

      const blurb = {
        complete: `${result.displayName || "Attendee"} checked out at ${formatDateTime(result.record.checkOutTime)}.`,
        "reg-checkout-no-checkin": `Registered attendee checked out without a check-in record.`,
        "walkin-complete": `Walk-in checkout recorded — they had a check-in earlier.`,
        "walkin-checkout": `Walk-in checkout only. No prior record for this ID.`,
      };
      setMessage({ type: "success", text: blurb[result.status] || "Checkout recorded." });
    } catch (error) {
      setMessage({ type: "error", text: "Checkout failed. Retry." });
    } finally {
      setCheckOutBusy(false);
    }
  }

  async function handleGenerateReport() {
    if (!selectedEvent) return;
    setReportBusy(true);
    try {
      await computeAttendance(selectedEvent.id);
      setMessage({ type: "success", text: "Attendance report regenerated from current data." });
    } catch (error) {
      setMessage({ type: "error", text: "Report generation failed." });
    } finally {
      setReportBusy(false);
    }
  }

  async function handleCloseEvent(eventArg) {
    const ev = eventArg || selectedEvent;
    if (!ev) return;
    const proceed = window.confirm(
      `Deactivate "${ev.title}"? This stops accepting new registrations / check-ins and finalizes the attendance report.`,
    );
    if (!proceed) return;
    try {
      await closeEvent(ev.id);
      setMessage({ type: "success", text: `"${ev.title}" deactivated. Attendance report finalized.` });
    } catch (error) {
      setMessage({ type: "error", text: "Deactivate failed." });
    }
  }

  async function handleReopenEvent(eventArg) {
    const ev = eventArg || selectedEvent;
    if (!ev) return;
    try {
      await reopenEvent(ev.id);
      setMessage({ type: "success", text: `"${ev.title}" activated. Accepting registrations and check-ins again.` });
    } catch (error) {
      setMessage({ type: "error", text: "Activate failed." });
    }
  }

  async function handleExportAttendanceCsv() {
    if (!selectedEvent || !eventAttendance.length) return;
    const decrypted = await Promise.all(eventAttendance.map(decryptAttendanceRow));
    const header = ["Name", "Unique ID", "Walk-In", "Registration Time", "Check-In Time", "Checkout Time", "Status"];
    const rows = decrypted.map((row) => [
      row.fullName,
      row.uniqueId,
      row.walkInFlag ? "Yes" : "No",
      row.registrationTime || "",
      row.checkInTime || "",
      row.checkOutTime || "",
      STATUS_LABEL[row.statusCode] || row.statusCode,
    ]);
    const csv = [header, ...rows]
      .map((cols) => cols.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedEvent.clientName}-${selectedEvent.title}-attendance.csv`.replace(/\s+/g, "-").toLowerCase();
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportAttendancePdf() {
    if (!selectedEvent || !eventAttendance.length) return;
    const styles = `
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#0A0A0A;}
      h1{font-size:18px;margin:0 0 4px;}
      .meta{font-size:11px;color:#555;margin-bottom:16px;}
      table{width:100%;border-collapse:collapse;font-size:11px;}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;}
      th{background:#FFF1E8;color:#3F3F46;}
      .summary{margin:12px 0;font-size:12px;}
      .summary span{margin-right:16px;}
    `;
    const summaryRow = `
      <div class="summary">
        <span>Registrations: <b>${eventRegistrations.length}</b></span>
        <span>Check-Ins: <b>${eventCheckIns.length}</b></span>
        <span>Checkouts: <b>${eventCheckOuts.length}</b></span>
        <span>Walk-Ins: <b>${walkInCount}</b></span>
        <span>No-Shows: <b>${noShowCount}</b></span>
        <span>Completion: <b>${completionRate}%</b></span>
      </div>`;
    const rowsHtml = decryptedAttendance
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.fullName || row.maskedFullName || "")}</td>
          <td>${escapeHtml(row.uniqueId || row.maskedUniqueId || "")}</td>
          <td>${row.walkInFlag ? "Yes" : "No"}</td>
          <td>${row.registrationTime ? formatDateTime(row.registrationTime) : ""}</td>
          <td>${row.checkInTime ? formatDateTime(row.checkInTime) : ""}</td>
          <td>${row.checkOutTime ? formatDateTime(row.checkOutTime) : ""}</td>
          <td>${escapeHtml(STATUS_LABEL[row.statusCode] || row.statusCode)}</td>
        </tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><title>${escapeHtml(selectedEvent.title)} — Attendance</title><style>${styles}</style></head><body>
      <h1>${escapeHtml(selectedEvent.title)}</h1>
      <div class="meta">${escapeHtml(selectedEvent.clientName)} · ${formatDate(selectedEvent.eventDate)} · ${escapeHtml(selectedEvent.location)}</div>
      ${summaryRow}
      <table>
        <thead><tr><th>Name</th><th>Unique ID</th><th>Walk-In</th><th>Registration</th><th>Check-In</th><th>Checkout</th><th>Status</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function handleSeedDemoEvent() {
    seedScbDemoEvent()
      .then((seededEvent) => {
        setSelectedEventId(seededEvent.id);
        setActiveTab("qrshare");
        setMessage({
          type: "success",
          text: "Standard Chartered demo event created. You can now walk the client through the full flow.",
        });
      })
      .catch(() => {
        setMessage({
          type: "error",
          text: "Unable to seed the demo event right now.",
        });
      });
  }

  if (participantMode === "checkin") {
    return (
      <ParticipantCheckIn
        event={selectedEvent}
        form={checkInForm}
        setForm={setCheckInForm}
        result={checkInResult}
        busy={checkInBusy}
        onSubmit={handleCheckInSubmit}
        walkInOpen={walkInOpen}
        setWalkInOpen={setWalkInOpen}
        onWalkInConfirm={async (name) => {
          setCheckInForm((f) => ({ ...f, fullName: name }));
          setWalkInOpen(false);
          await saveCheckIn({ event: selectedEvent, uniqueId: checkInForm.uniqueId.trim(), fullName: name }).then((result) => {
            if (result.status !== "duplicate") {
              setCheckInResult({
                kind: "walk-in",
                time: result.record.checkInTime,
                displayName: name,
                masked: result.record.maskedUniqueId,
              });
              setCheckInForm({ uniqueId: "", fullName: "" });
            }
          });
        }}
      />
    );
  }

  if (participantMode === "checkout") {
    return (
      <ParticipantCheckOut
        event={selectedEvent}
        form={checkOutForm}
        setForm={setCheckOutForm}
        result={checkOutResult}
        busy={checkOutBusy}
        onSubmit={handleCheckOutSubmit}
      />
    );
  }

  if (participantMode === "register") {
    return (
      <div className="gform-page">
        <main className="gform-shell">
          <div className="gform-header">
            <h1>{selectedEvent ? selectedEvent.title : "CSR Activity Chennai - Quiz Calendar Creation"}</h1>
            <p className="gform-lead"><strong>Welcome to the Quiz Calendar Creation!</strong></p>
            <p>Thank you for being part of this creative initiative!</p>
            <p>We will be designing Quiz calendars to help students create their own calendar while learning about the important dates and events in each month.</p>
            <p>Your creativity will make these important days come alive for young learners!</p>
            <p>Please fill out the form below to mark your attendance.</p>
            {selectedEvent && (
              <p className="gform-meta">
                <strong>Date:</strong> {formatDate(selectedEvent.eventDate)}<br />
                <strong>Location:</strong> {selectedEvent.location}
              </p>
            )}
            <p className="gform-required">* Indicates required question</p>
          </div>

          {message.text && (
            <div className={`gform-alert ${message.type === "error" ? "gform-alert-error" : "gform-alert-success"}`}>
              {message.text}
            </div>
          )}

          <form className="gform-form" onSubmit={handleRegistrationSubmit}>
            <div className="gform-q">
              <label htmlFor="p-fullName">Full Name <span className="gform-star">*</span></label>
              <input
                id="p-fullName"
                className="gform-input"
                placeholder="Your answer"
                value={registrationForm.fullName}
                onChange={(e) => updateRegistrationField("fullName", e.target.value)}
              />
            </div>

            <div className="gform-q">
              <label htmlFor="p-employeeId">Bank ID <span className="gform-star">*</span></label>
              <input
                id="p-employeeId"
                className="gform-input"
                placeholder="Your answer"
                value={registrationForm.employeeId}
                onChange={(e) => updateRegistrationField("employeeId", e.target.value)}
              />
            </div>

            <div className="gform-q">
              <label>Participation <span className="gform-star">*</span></label>
              <div className="gform-radio-group">
                {participationOptions.map((option) => (
                  <label key={option} className="gform-radio">
                    <input
                      type="radio"
                      name="participation"
                      value={option}
                      checked={registrationForm.participation === option}
                      onChange={() => updateRegistrationField("participation", option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="gform-q">
              <p className="gform-quote">"By registering for this event, you consent to processing and usage of your photos and videos for event management and internal communication purposes."</p>
              <label className="gform-radio">
                <input
                  type="checkbox"
                  checked={registrationForm.photoConsent}
                  onChange={(e) => updateRegistrationField("photoConsent", e.target.checked)}
                />
                <span>Yes</span>
              </label>
            </div>

            <button type="submit" className="gform-submit" disabled={submitting || !selectedEvent}>
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </form>

          <div className="gform-footer">
            Never submit passwords through this form.
          </div>
        </main>

        {duplicateState.open && (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h2 className="text-2xl font-semibold text-slate-950">You already registered for this event</h2>
              <p className="text-sm leading-6 text-slate-600">
                We have an earlier submission tied to your {duplicateState.event ? duplicateFieldLabels[duplicateState.event.duplicateField] : "ID"}.
              </p>
              {(() => {
                const prior = duplicateState.existingRecord || {};
                const pending = duplicateState.pendingRegistration || {};
                const priorPart = prior.participation || "Yes";
                const pendingPart = pending.participation || "Yes";
                const changed = priorPart !== pendingPart;
                return (
                  <div className="duplicate-diff">
                    <div className="duplicate-diff-row">
                      <span>Previously on {formatDateTime(prior.updatedAt || prior.createdAt)} you said attending: <strong>{priorPart}</strong>.</span>
                    </div>
                    <div className="duplicate-diff-row">
                      <span>Now you are saying attending: <strong>{pendingPart}</strong>.</span>
                      {changed && <span className="duplicate-diff-flag">CHANGED</span>}
                    </div>
                  </div>
                );
              })()}
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setDuplicateState({ open: false, event: null, existingRecord: null, pendingRegistration: null })}>
                  Keep Previous Entry
                </Button>
                <Button type="button" onClick={confirmDuplicateReplace}>Update My Entry</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const navSections = [
    {
      heading: "Setup",
      items: [
        { id: "events", label: "Events", icon: CalendarPlus, ready: true },
        { id: "formbuilder", label: "Form Builder", icon: FilePlus, ready: false },
      ],
    },
    {
      heading: "Operate",
      items: [
        { id: "registrations", label: "Registrations", icon: UserPlus, ready: true },
        { id: "checkin", label: "Check-In", icon: ClipboardList, ready: true },
        { id: "checkout", label: "Checkout", icon: LogOut, ready: true },
        { id: "qrshare", label: "QR & Share", icon: QrCode, ready: true },
      ],
    },
    {
      heading: "Insights",
      items: [
        { id: "dashboard", label: "Dashboard", icon: BarChart3, ready: true },
        { id: "reports", label: "Reports", icon: FileText, ready: true },
      ],
    },
    {
      heading: "Trust",
      items: [
        { id: "security", label: "Security", icon: ShieldCheck, ready: true },
        { id: "users", label: "Admin Users", icon: KeyRound, ready: true },
      ],
    },
  ];

  const activeLabel = navSections
    .flatMap((section) => section.items)
    .find((item) => item.id === activeTab)?.label || "Events";

  // Auth gate: admin shell requires sign-in. Participant routes returned earlier.
  if (!authReady) {
    return <div className="scb-login-wrap"><div className="scb-login-card"><p>Loading...</p></div></div>;
  }
  if (!authUser) {
    return <LoginScreen storeMode={storeMode} />;
  }

  return (
    <div className="scb-shell">
      <div className="scb-layout">
        <aside className="scb-sidebar">
          <div className="scb-sidebar-brand">
            <div className="scb-sidebar-logo">SCB</div>
            <div>
              <div className="scb-sidebar-name">Event Platform</div>
              <div className="scb-sidebar-sub">Communitree</div>
            </div>
          </div>

          <nav className="scb-nav">
            {navSections.map((section) => (
              <div key={section.heading} className="scb-nav-section">
                <div className="scb-nav-heading">{section.heading}</div>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`scb-nav-item ${isActive ? "scb-nav-item-active" : ""}`}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      {!item.ready && <span className="scb-nav-badge">Soon</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="scb-sidebar-foot">
            <div className="scb-sidebar-keyline">
              <span>Key</span>
              <strong>{keyFingerprint || "loading..."}</strong>
            </div>
            <Badge variant="outline" className="scb-status-pill">
              <Database className="h-3.5 w-3.5" />
              {storeMode === "firebase" ? "Firestore live" : "Demo mode"}
            </Badge>
            {authUser && (
              <div className="scb-sidebar-user">
                <span className="scb-sidebar-user-label">Signed in</span>
                <strong title={authUser.email}>{authUser.email}</strong>
                <button type="button" className="scb-signout-btn" onClick={handleSignOut}>
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
            )}
            <div className="scb-build">build {BUILD_STAMP}</div>
          </div>
        </aside>

        <main className="scb-main">
          <header className="scb-topbar">
            <div className="scb-brand">
              <div className="scb-crumb">SCB Event Platform / {activeLabel}</div>
              <h1>{activeLabel}</h1>
            </div>
            <div className="scb-topbar-right">
              <div className="scb-event-picker">
                <Label className="scb-event-picker-label">Event</Label>
                <Select
                  value={selectedEventId || ""}
                  onValueChange={(v) => setSelectedEventId(v)}
                  disabled={!events.length}
                >
                  <SelectTrigger className="scb-event-trigger">
                    <SelectValue placeholder={events.length ? "Pick event" : "Create one first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((ev) => (
                      <SelectItem key={ev.id} value={ev.id}>
                        {ev.title}{ev.status === "closed" ? " (inactive)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="scb-stats">
                <div className="scb-stat"><span>Registered</span><strong>{selectedEvent ? eventRegistrations.length : 0}</strong></div>
                <div className="scb-stat"><span>Checked-In</span><strong>{selectedEvent ? eventCheckIns.length : 0}</strong></div>
                <div className="scb-stat"><span>Checked-Out</span><strong>{selectedEvent ? eventCheckOuts.length : 0}</strong></div>
              </div>
            </div>
          </header>

          {fallbackBanner && (
            <Alert className="status-alert border-amber-300 bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <AlertDescription className="text-amber-900">
                Using local store. {fallbackBanner}. Data lives in this browser only.{" "}
                <button type="button" className="underline" onClick={reenableFirestoreMode}>Retry Firestore</button>
                {" · "}
                <button type="button" className="underline" onClick={handleHardReset}>Hard reset</button>
              </AlertDescription>
            </Alert>
          )}

          {message.text && (
            <Alert className={message.type === "error" ? "status-alert border-red-300 bg-red-50" : "status-alert border-emerald-300 bg-emerald-50"}>
              <AlertTriangle className={`h-5 w-5 ${message.type === "error" ? "text-red-600" : "text-emerald-600"}`} />
              <AlertDescription className={message.type === "error" ? "text-red-900" : "text-emerald-900"}>
                {message.text}
              </AlertDescription>
            </Alert>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="tab-strip" style={{ display: "none" }}>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>

          <TabsContent value="registrations">
            <div className="page-stack">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Share Registration Link</CardTitle>
                  <CardDescription>
                    Send this link to the SCB team. They fill the form themselves — you don't capture data by hand.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedEvent ? (
                    <>
                      <div className="link-row">
                        <div className="link-box">{shareUrl}</div>
                        <Button type="button" variant="outline" onClick={handleCopyShareLink}>
                          <Link2 className="mr-2 h-4 w-4" /> Copy Link
                        </Button>
                        <Button type="button" variant="outline" onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}>
                          Open
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setActiveTab("qrshare")}>
                          <QrCode className="mr-2 h-4 w-4" /> Show QR
                        </Button>
                      </div>
                      {copyMessage && <p className="helper-copy">{copyMessage}</p>}
                      <p className="helper-copy">
                        Event: <strong>{selectedEvent.title}</strong> · {formatDate(selectedEvent.eventDate)} · {selectedEvent.location}
                      </p>
                    </>
                  ) : (
                    <div className="empty-state">Pick an event from the topbar to get its share link.</div>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Manual Capture (Backup)</CardTitle>
                  <CardDescription>
                    Employees land on this form from the QR code or a private link. Duplicate prevention is event-specific.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5" onSubmit={handleRegistrationSubmit}>
                    <div className="field-grid">
                      <div className="space-y-2">
                        <Label htmlFor="event">Selected Event</Label>
                        <Select
                          value={selectedEventId}
                          onValueChange={(value) => setSelectedEventId(value)}
                          disabled={!events.length}
                        >
                          <SelectTrigger id="event">
                            <SelectValue placeholder="Select an event" />
                          </SelectTrigger>
                          <SelectContent>
                            {events.map((event) => (
                              <SelectItem key={event.id} value={event.id}>
                                {event.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Duplicate Control</Label>
                        <div className="inline-flex min-h-10 items-center rounded-md border border-dashed border-teal-300 bg-teal-50 px-3 text-sm text-teal-900">
                          {selectedEvent ? duplicateFieldLabels[selectedEvent.duplicateField] : "Create an event first"}
                        </div>
                      </div>
                    </div>

                    <div className="field-grid">
                      <div className="space-y-2">
                        <Label htmlFor="fullName">Participant Name</Label>
                        <Input
                          id="fullName"
                          value={registrationForm.fullName}
                          onChange={(event) => updateRegistrationField("fullName", event.target.value)}
                          placeholder="Roshney Mathew"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="employeeId">Bank ID</Label>
                        <Input
                          id="employeeId"
                          value={registrationForm.employeeId}
                          onChange={(event) => updateRegistrationField("employeeId", event.target.value)}
                          placeholder="SCB-EMP-1042"
                        />
                      </div>
                    </div>

                    <div className="field-grid">
                      <div className="space-y-2">
                        <Label htmlFor="participation">Participation</Label>
                        <Select
                          value={registrationForm.participation}
                          onValueChange={(value) => updateRegistrationField("participation", value)}
                        >
                          <SelectTrigger id="participation">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {participationOptions.map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address (optional)</Label>
                        <Input
                          id="email"
                          type="email"
                          value={registrationForm.email}
                          onChange={(event) => updateRegistrationField("email", event.target.value)}
                          placeholder="name@sc.com"
                        />
                      </div>
                    </div>

                    <div className="field-grid">
                      <div className="space-y-2">
                        <Label htmlFor="phone">Mobile Number (optional)</Label>
                        <Input
                          id="phone"
                          value={registrationForm.phone}
                          onChange={(event) => updateRegistrationField("phone", event.target.value)}
                          placeholder="+91 98765 43210"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="department">Department (optional)</Label>
                        <Input
                          id="department"
                          value={registrationForm.department}
                          onChange={(event) => updateRegistrationField("department", event.target.value)}
                          placeholder="Retail Banking"
                        />
                      </div>
                    </div>

                    <label className="consent-row">
                      <input
                        type="checkbox"
                        checked={registrationForm.photoConsent}
                        onChange={(event) => updateRegistrationField("photoConsent", event.target.checked)}
                      />
                      <span>
                        By registering for this event, the participant consents to processing and usage of their photos and videos for event management and internal communication purposes.
                      </span>
                    </label>

                    <label className="consent-row">
                      <input
                        type="checkbox"
                        checked={registrationForm.consent}
                        onChange={(event) => updateRegistrationField("consent", event.target.checked)}
                      />
                      <span>
                        Capture this record for the selected event and retain it only for the event window.
                      </span>
                    </label>

                    <Button type="submit" className="cta-button" disabled={submitting || !selectedEvent}>
                      {submitting ? "Processing..." : "Submit Registration"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="qrshare">
            <div className="page-stack">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>All Events — Quick Switch</CardTitle>
                  <CardDescription>
                    Click any event to load its QR + share link below.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {events.length ? (
                    <div className="event-grid">
                      {events.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          className={`event-tile ${ev.id === selectedEventId ? "event-tile-active" : ""}`}
                          onClick={() => setSelectedEventId(ev.id)}
                        >
                          <div className="event-tile-title">{ev.title}</div>
                          <div className="event-tile-meta">
                            <span>{formatDate(ev.eventDate)}</span>
                            <span>{ev.location}</span>
                          </div>
                          <div className="event-tile-status">
                            {eventStatusLabel(ev.status)}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">No events. Create one in the Events tab.</div>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Event QR and Private Link</CardTitle>
                  <CardDescription>
                    QR encodes the registration URL. Share the link directly via email/Slack, or print the QR for venue signage.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedEvent ? (
                    <div className="qr-layout">
                      <div className="qr-panel">
                        {qrCodeUrl ? (
                          <img className="qr-image" src={qrCodeUrl} alt={`${selectedEvent.title} QR code`} />
                        ) : (
                          <div className="qr-placeholder">QR preview unavailable</div>
                        )}
                        {qrCodeUrl && (
                          <a className="qr-download" href={qrCodeUrl} download={`${selectedEvent.id}-qr.png`}>
                            <Download className="h-3.5 w-3.5" /> Download PNG
                          </a>
                        )}
                      </div>
                      <div className="qr-meta">
                        <div className="summary-item">
                          <span>Event</span>
                          <strong>{selectedEvent.title}</strong>
                        </div>
                        <div className="summary-item">
                          <span>Date</span>
                          <strong>{formatDate(selectedEvent.eventDate)}</strong>
                        </div>
                        <div className="space-y-2">
                          <Label>Registration Share Link</Label>
                          <div className="link-row">
                            <div className="link-box">{shareUrl}</div>
                            <Button type="button" variant="outline" onClick={handleCopyShareLink}>
                              <Link2 className="mr-2 h-4 w-4" />
                              Copy
                            </Button>
                          </div>
                          {copyMessage && <p className="helper-copy">{copyMessage}</p>}
                          <a className="helper-copy" href={shareUrl} target="_blank" rel="noreferrer">
                            Open participant view in a new tab →
                          </a>
                        </div>
                        <div className="space-y-2">
                          <Label>Check-In Desk URL</Label>
                          <div className="link-row">
                            <div className="link-box">{getCheckInUrl(selectedEvent.id)}</div>
                            <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(getCheckInUrl(selectedEvent.id))}>
                              <Link2 className="mr-2 h-4 w-4" /> Copy
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Checkout Desk URL</Label>
                          <div className="link-row">
                            <div className="link-box">{getCheckOutUrl(selectedEvent.id)}</div>
                            <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(getCheckOutUrl(selectedEvent.id))}>
                              <Link2 className="mr-2 h-4 w-4" /> Copy
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">
                      Pick an event above to generate its QR + share links.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="formbuilder">
            <div className="page-stack">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Form Builder</CardTitle>
                  <CardDescription>
                    No-code editor to create the Registration, Check-In, and Checkout forms per event. Coming next.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flow-step"><div className="flow-icon"><FilePlus className="h-4 w-4" /></div><div><p className="flow-title">Pick the event</p><p className="flow-description">Forms are scoped to one Event Code so they auto-close when the event closes.</p></div></div>
                  <div className="flow-step"><div className="flow-icon"><FilePlus className="h-4 w-4" /></div><div><p className="flow-title">Drag-and-drop fields</p><p className="flow-description">Text, dropdown, radio, checkbox, date, file upload. Mark required and one Unique ID field.</p></div></div>
                  <div className="flow-step"><div className="flow-icon"><FilePlus className="h-4 w-4" /></div><div><p className="flow-title">Preview + publish</p><p className="flow-description">Generate three shareable URLs: registration, check-in, checkout. Admin never touches code.</p></div></div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="checkin">
            <div className="page-stack">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Check-In Desk</CardTitle>
                  <CardDescription>
                    Single-field form for the venue desk. Type or scan the attendee's Unique ID. Walk-ins captured separately.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {selectedEvent ? (
                    <>
                      <div className="summary-grid">
                        <div className="summary-item"><span>Event</span><strong>{selectedEvent.title}</strong></div>
                        <div className="summary-item"><span>Status</span><strong>{eventStatusLabel(selectedEvent.status)}</strong></div>
                        <div className="summary-item"><span>Registered</span><strong>{eventRegistrations.length}</strong></div>
                        <div className="summary-item"><span>Checked In</span><strong>{eventCheckIns.length}</strong></div>
                      </div>

                      <form className="space-y-4" onSubmit={handleCheckInSubmit}>
                        <div className="field-grid">
                          <div className="space-y-2">
                            <Label htmlFor="ci-uniqueid">Attendee Unique ID</Label>
                            <Input
                              id="ci-uniqueid"
                              autoFocus
                              autoComplete="off"
                              placeholder="SCB-EMP-1042"
                              value={checkInForm.uniqueId}
                              onChange={(e) => setCheckInForm((f) => ({ ...f, uniqueId: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="ci-walkinname">Walk-In Name (only if no registration)</Label>
                            <Input
                              id="ci-walkinname"
                              placeholder="leave blank for registered attendees"
                              value={checkInForm.fullName}
                              onChange={(e) => setCheckInForm((f) => ({ ...f, fullName: e.target.value }))}
                            />
                          </div>
                        </div>
                        <Button type="submit" className="cta-button" disabled={checkInBusy}>
                          {checkInBusy ? "Checking in..." : "Record Check-In"}
                        </Button>
                      </form>

                      {checkInResult && checkInResult.kind !== "duplicate" && (
                        <Alert className="status-alert border-emerald-300 bg-emerald-50">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">
                            {checkInResult.kind === "walk-in"
                              ? `Walk-in recorded at ${formatDateTime(checkInResult.time)}.`
                              : `${checkInResult.displayName || "Attendee"} checked in at ${formatDateTime(checkInResult.time)}.`}
                          </AlertDescription>
                        </Alert>
                      )}
                      {checkInResult && checkInResult.kind === "duplicate" && (
                        <Alert className="status-alert border-red-300 bg-red-50">
                          <XCircle className="h-5 w-5 text-red-600" />
                          <AlertDescription className="text-red-900">
                            Already checked in at {formatDateTime(checkInResult.time)}.
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="link-row">
                        <div className="link-box">{getCheckInUrl(selectedEvent.id)}</div>
                        <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(getCheckInUrl(selectedEvent.id))}>
                          <Link2 className="mr-2 h-4 w-4" />
                          Copy Desk URL
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">Select an event to run check-in.</div>
                  )}
                </CardContent>
              </Card>

              {selectedEvent && eventCheckIns.length > 0 && (
                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>Check-Ins Log</CardTitle>
                    <CardDescription>Most recent first. Unique IDs masked for privacy.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Unique ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Walk-In</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {eventCheckIns.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.maskedUniqueId}</TableCell>
                            <TableCell>{row.maskedFullName || "—"}</TableCell>
                            <TableCell>{row.walkInFlag ? "Yes" : "No"}</TableCell>
                            <TableCell>{formatDateTime(row.checkInTime)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="checkout">
            <div className="page-stack">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Checkout Desk</CardTitle>
                  <CardDescription>
                    End-of-event exit form. Closes the attendance loop. Walk-in-only checkouts captured separately.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {selectedEvent ? (
                    <>
                      <div className="summary-grid">
                        <div className="summary-item"><span>Event</span><strong>{selectedEvent.title}</strong></div>
                        <div className="summary-item"><span>Checked In</span><strong>{eventCheckIns.length}</strong></div>
                        <div className="summary-item"><span>Checked Out</span><strong>{eventCheckOuts.length}</strong></div>
                        <div className="summary-item"><span>Walk-Ins</span><strong>{walkInCount}</strong></div>
                      </div>

                      <form className="space-y-4" onSubmit={handleCheckOutSubmit}>
                        <div className="field-grid">
                          <div className="space-y-2">
                            <Label htmlFor="co-uniqueid">Attendee Unique ID</Label>
                            <Input
                              id="co-uniqueid"
                              autoFocus
                              autoComplete="off"
                              placeholder="SCB-EMP-1042"
                              value={checkOutForm.uniqueId}
                              onChange={(e) => setCheckOutForm((f) => ({ ...f, uniqueId: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="co-walkinname">Walk-In Name (if no record)</Label>
                            <Input
                              id="co-walkinname"
                              placeholder="leave blank if attendee has a record"
                              value={checkOutForm.fullName}
                              onChange={(e) => setCheckOutForm((f) => ({ ...f, fullName: e.target.value }))}
                            />
                          </div>
                        </div>
                        <Button type="submit" className="cta-button" disabled={checkOutBusy}>
                          {checkOutBusy ? "Checking out..." : "Record Checkout"}
                        </Button>
                      </form>

                      {checkOutResult && checkOutResult.kind !== "duplicate" && (
                        <Alert className="status-alert border-emerald-300 bg-emerald-50">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <AlertDescription className="text-emerald-900">
                            Checkout recorded at {formatDateTime(checkOutResult.time)}.
                          </AlertDescription>
                        </Alert>
                      )}
                      {checkOutResult && checkOutResult.kind === "duplicate" && (
                        <Alert className="status-alert border-red-300 bg-red-50">
                          <XCircle className="h-5 w-5 text-red-600" />
                          <AlertDescription className="text-red-900">
                            Already checked out at {formatDateTime(checkOutResult.time)}.
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="link-row">
                        <div className="link-box">{getCheckOutUrl(selectedEvent.id)}</div>
                        <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(getCheckOutUrl(selectedEvent.id))}>
                          <Link2 className="mr-2 h-4 w-4" />
                          Copy Desk URL
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">Select an event to run checkout.</div>
                  )}
                </CardContent>
              </Card>

              {selectedEvent && eventCheckOuts.length > 0 && (
                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>Checkouts Log</CardTitle>
                    <CardDescription>Most recent first.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Unique ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Walk-In</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {eventCheckOuts.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.maskedUniqueId}</TableCell>
                            <TableCell>{row.maskedFullName || "—"}</TableCell>
                            <TableCell>{row.walkInFlag ? "Yes" : "No"}</TableCell>
                            <TableCell>{formatDateTime(row.checkOutTime)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="reports">
            <div className="page-stack">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Post-Event Report</CardTitle>
                  <CardDescription>
                    Status engine assigns one of 8 codes to every Unique ID. Recompute manually or close the event to lock the final report.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedEvent ? (
                    <>
                      <div className="summary-grid">
                        <div className="summary-item"><span>Event</span><strong>{selectedEvent.title}</strong></div>
                        <div className="summary-item"><span>Status</span><strong>{eventStatusLabel(selectedEvent.status)}</strong></div>
                        <div className="summary-item"><span>Date</span><strong>{formatDate(selectedEvent.eventDate)}</strong></div>
                        <div className="summary-item"><span>Completion Rate</span><strong>{completionRate}%</strong></div>
                      </div>

                      <div className="summary-grid">
                        <div className="summary-item"><span>Registrations</span><strong>{eventRegistrations.length}</strong></div>
                        <div className="summary-item"><span>Check-Ins</span><strong>{eventCheckIns.length}</strong></div>
                        <div className="summary-item"><span>Checkouts</span><strong>{eventCheckOuts.length}</strong></div>
                        <div className="summary-item"><span>Walk-Ins</span><strong>{walkInCount}</strong></div>
                        <div className="summary-item"><span>No-Shows</span><strong>{noShowCount}</strong></div>
                        <div className="summary-item"><span>Complete</span><strong>{completeCount}</strong></div>
                      </div>

                      <div>
                        <Label className="block mb-2">Operational gaps</Label>
                        <div className="summary-grid">
                          <div className="summary-item summary-item-warn">
                            <span>Did Not Check In</span>
                            <strong>{didNotCheckInCount}</strong>
                          </div>
                          <div className="summary-item summary-item-warn">
                            <span>Did Not Check Out</span>
                            <strong>{didNotCheckOutCount}</strong>
                          </div>
                          <div className="summary-item summary-item-warn">
                            <span>Did Not Register (Walk-In)</span>
                            <strong>{didNotRegisterCount}</strong>
                          </div>
                        </div>
                      </div>

                      <div>
                        <Label className="block mb-2">Status breakdown</Label>
                        <div className="status-breakdown">
                          {Object.entries(STATUS_LABEL).map(([code, label]) => (
                            <div key={code} className="status-chip">
                              <span className={`status-dot ${statusPillClass(code)}`}></span>
                              <span className="status-chip-label">{label}</span>
                              <strong>{statusCounts[code] || 0}</strong>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="action-row">
                        <Button type="button" onClick={handleGenerateReport} disabled={reportBusy}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          {reportBusy ? "Computing..." : "Regenerate Report"}
                        </Button>
                        <Button type="button" variant="outline" onClick={handleExportAttendanceCsv} disabled={!eventAttendance.length}>
                          <Download className="mr-2 h-4 w-4" />
                          Export CSV
                        </Button>
                        <Button type="button" variant="outline" onClick={handleExportAttendancePdf} disabled={!eventAttendance.length}>
                          <FileText className="mr-2 h-4 w-4" />
                          Export PDF
                        </Button>
                        {selectedEvent.status !== "closed" ? (
                          <Button type="button" variant="outline" onClick={() => handleCloseEvent(selectedEvent)}>
                            <LogOut className="mr-2 h-4 w-4" />
                            Deactivate Event
                          </Button>
                        ) : (
                          <Button type="button" variant="outline" onClick={() => handleReopenEvent(selectedEvent)}>
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Activate Event
                          </Button>
                        )}
                      </div>

                      <div className="field-grid">
                        <div className="space-y-2">
                          <Label>Filter by status</Label>
                          <Select value={reportFilter} onValueChange={setReportFilter}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ALL">All Statuses</SelectItem>
                              {Object.entries(STATUS_LABEL).map(([code, label]) => (
                                <SelectItem key={code} value={code}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">Select an event to view its report.</div>
                  )}
                </CardContent>
              </Card>

              {selectedEvent && eventAttendance.length > 0 && (
                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>Attendee Detail</CardTitle>
                    <CardDescription>
                      Names and IDs decrypted in-browser for the report. {privacyMode ? "Showing masked values." : "Showing decrypted values."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="action-row mb-2">
                      <Button type="button" variant="outline" onClick={() => setPrivacyMode((m) => !m)}>
                        {privacyMode ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                        {privacyMode ? "Reveal Names" : "Mask Names"}
                      </Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Unique ID</TableHead>
                          <TableHead>Registration</TableHead>
                          <TableHead>Check-In</TableHead>
                          <TableHead>Checkout</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {eventAttendance
                          .filter((row) => reportFilter === "ALL" || row.statusCode === reportFilter)
                          .map((row, idx) => {
                            const decrypted = decryptedAttendance[idx];
                            const showPlain = !privacyMode && decrypted;
                            return (
                              <TableRow key={row.id}>
                                <TableCell>{showPlain ? decrypted.fullName : row.maskedFullName || "(masked)"}</TableCell>
                                <TableCell>{showPlain ? decrypted.uniqueId : row.maskedUniqueId}</TableCell>
                                <TableCell>{row.registrationTime ? formatDateTime(row.registrationTime) : "—"}</TableCell>
                                <TableCell>{row.checkInTime ? formatDateTime(row.checkInTime) : "—"}</TableCell>
                                <TableCell>{row.checkOutTime ? formatDateTime(row.checkOutTime) : "—"}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={statusPillClass(row.statusCode)}>
                                    {STATUS_LABEL[row.statusCode] || row.statusCode}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="events">
            <div className="page-stack">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Create Event</CardTitle>
                  <CardDescription>
                    This is the client-facing setup step: define the event, duplicate rule, retention window, and the demo link.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!events.length && (
                    <div className="helper-banner">
                      <p>No event exists yet. Start by creating one or seed the Standard Chartered demo event.</p>
                      <Button type="button" variant="outline" onClick={handleSeedDemoEvent}>
                        Load SCB Demo Event
                      </Button>
                    </div>
                  )}

                  <form className="space-y-5" onSubmit={handleCreateEvent}>
                    <div className="field-grid">
                      <div className="space-y-2">
                        <Label htmlFor="clientName">Client Name</Label>
                        <Input
                          id="clientName"
                          value={eventForm.clientName}
                          onChange={(event) => updateEventField("clientName", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="title">Event Title</Label>
                        <Input
                          id="title"
                          value={eventForm.title}
                          onChange={(event) => updateEventField("title", event.target.value)}
                          placeholder="Rewards Campaign Registration"
                        />
                      </div>
                    </div>

                    <div className="field-grid">
                      <div className="space-y-2">
                        <Label htmlFor="location">Location</Label>
                        <Input
                          id="location"
                          value={eventForm.location}
                          onChange={(event) => updateEventField("location", event.target.value)}
                          placeholder="Chennai Regional Hub"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="eventDate">Event Date</Label>
                        <Input
                          id="eventDate"
                          type="date"
                          value={eventForm.eventDate}
                          onChange={(event) => updateEventField("eventDate", event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="field-grid">
                      <div className="space-y-2">
                        <Label>Duplicate Blocking Key</Label>
                        <Select
                          value={eventForm.duplicateField}
                          onValueChange={(value) => updateEventField("duplicateField", value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employeeId">Employee ID</SelectItem>
                            <SelectItem value="email">Email Address</SelectItem>
                            <SelectItem value="phone">Mobile Number</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retentionDays">Retention Window</Label>
                        <Input
                          id="retentionDays"
                          type="number"
                          min="1"
                          max="365"
                          value={eventForm.retentionDays}
                          onChange={(event) => updateEventField("retentionDays", event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="notes">Client Notes</Label>
                      <Textarea
                        id="notes"
                        value={eventForm.notes}
                        onChange={(event) => updateEventField("notes", event.target.value)}
                        placeholder="Mention approved collection fields, event contacts, or data handling notes."
                      />
                    </div>

                    <Button type="submit" className="cta-button" disabled={creatingEvent}>
                      {creatingEvent ? "Creating event..." : "Create Event and QR Flow"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>All Events</CardTitle>
                  <CardDescription>
                    Click an event to make it active across the platform. Active event drives every tab + the topbar stats.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {events.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Registrations</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {events.map((ev) => {
                          const regCount = registrations.filter((r) => r.eventId === ev.id).length;
                          const isActive = ev.id === selectedEventId;
                          return (
                            <TableRow key={ev.id} className={isActive ? "row-active" : ""}>
                              <TableCell>
                                <strong>{ev.title}</strong>
                                {isActive && <span className="row-active-pill">CURRENT</span>}
                              </TableCell>
                              <TableCell>{formatDate(ev.eventDate)}</TableCell>
                              <TableCell>{ev.location}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{eventStatusLabel(ev.status)}</Badge>
                              </TableCell>
                              <TableCell>{regCount}</TableCell>
                              <TableCell>
                                <div className="action-row">
                                  {isActive ? (
                                    <Button type="button" size="sm" disabled className="cursor-default opacity-70">
                                      Current
                                    </Button>
                                  ) : (
                                    <Button type="button" size="sm" onClick={() => setSelectedEventId(ev.id)}>
                                      Make Current
                                    </Button>
                                  )}
                                  <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedEventId(ev.id); setActiveTab("qrshare"); }}>
                                    <QrCode className="mr-1 h-3.5 w-3.5" /> QR
                                  </Button>
                                  <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedEventId(ev.id); setActiveTab("dashboard"); }}>
                                    <BarChart3 className="mr-1 h-3.5 w-3.5" /> Dashboard
                                  </Button>
                                  <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedEventId(ev.id); setActiveTab("reports"); }}>
                                    <FileText className="mr-1 h-3.5 w-3.5" /> Report
                                  </Button>
                                  {ev.status === "closed" ? (
                                    <Button type="button" variant="outline" size="sm" onClick={() => handleReopenEvent(ev)} title="Re-open this event so registrations / check-ins resume">
                                      <PlayCircle className="mr-1 h-3.5 w-3.5" /> Activate
                                    </Button>
                                  ) : (
                                    <Button type="button" variant="outline" size="sm" onClick={() => handleCloseEvent(ev)} title="Stop accepting new registrations / check-ins; finalize report">
                                      <LogOut className="mr-1 h-3.5 w-3.5" /> Deactivate
                                    </Button>
                                  )}
                                  <Button type="button" variant="outline" size="sm" onClick={() => handleResetEventData(ev)} title="Wipe this event's registrations + check-ins + check-outs; keep the event">
                                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reset Data
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="empty-state">No events yet. Create one above.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="dashboard">
            <div className="page-stack">
                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>Live Dashboard</CardTitle>
                    <CardDescription>
                      Show the client exactly where the data lands and how the registration count can be monitored.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedEvent ? (
                      <>
                        <div className="summary-grid">
                          <div className="summary-item"><span>Client</span><strong>{selectedEvent.clientName}</strong></div>
                          <div className="summary-item"><span>Event Date</span><strong>{formatDate(selectedEvent.eventDate)}</strong></div>
                          <div className="summary-item"><span>Status</span><strong>{eventStatusLabel(selectedEvent.status)}</strong></div>
                          <div className="summary-item"><span>Duplicate Rule</span><strong>{duplicateFieldLabels[selectedEvent.duplicateField]}</strong></div>
                        </div>

                        <div className="summary-grid">
                          <div className="summary-item"><span>Registrations</span><strong>{eventRegistrations.length}</strong></div>
                          <div className="summary-item"><span>Check-Ins</span><strong>{eventCheckIns.length}</strong></div>
                          <div className="summary-item"><span>Checkouts</span><strong>{eventCheckOuts.length}</strong></div>
                          <div className="summary-item"><span>Walk-Ins</span><strong>{walkInCount}</strong></div>
                          <div className="summary-item"><span>No-Shows</span><strong>{noShowCount}</strong></div>
                          <div className="summary-item"><span>Completion</span><strong>{completionRate}%</strong></div>
                        </div>

                        <div className="action-row">
                          <Button type="button" onClick={handleExportSelectedEvent}>
                            <Download className="mr-2 h-4 w-4" />
                            Export Registrations CSV
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setPrivacyMode((current) => !current)}>
                            {privacyMode ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                            {decryptingReveal ? "Decrypting..." : privacyMode ? "Reveal (Decrypt)" : "Mask Off"}
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setActiveTab("reports")}>
                            <FileText className="mr-2 h-4 w-4" />
                            View Report
                          </Button>
                          <Button type="button" variant="outline" onClick={() => handleResetEventData(selectedEvent)} title="Wipe registrations + check-ins + check-outs for this event; keep the event itself">
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Reset Event Data
                          </Button>
                          <Button type="button" variant="outline" onClick={handleDeleteEvent} title="Delete the event entirely and all its data">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Event
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        Create or select an event to see the dashboard, exports, and purge controls.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>Across All Events</CardTitle>
                    <CardDescription>Program-level view for the month and the last 6 events.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="summary-grid">
                      <div className="summary-item"><span>Events This Month</span><strong>{globalStats.eventsThisMonth}</strong></div>
                      <div className="summary-item"><span>Registrations This Month</span><strong>{globalStats.regsThisMonth}</strong></div>
                      <div className="summary-item"><span>Total Events</span><strong>{events.length}</strong></div>
                      <div className="summary-item"><span>Total Registrations</span><strong>{registrations.length}</strong></div>
                    </div>
                    {globalStats.trend.length > 0 && (
                      <div>
                        <Label>Last 6 events — completion rate</Label>
                        <div className="trend-list">
                          {globalStats.trend.map((row) => (
                            <div key={row.id} className="trend-row">
                              <div className="trend-meta">
                                <strong>{row.title}</strong>
                                <span>{formatDate(row.date)}</span>
                              </div>
                              <div className="trend-bar-wrap">
                                <div className="trend-bar" style={{ width: `${row.rate}%` }} />
                                <span className="trend-pct">{row.rate}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>Selected Event Registrations</CardTitle>
                    <CardDescription>
                      Sensitive fields are masked by default in the dashboard, but the export retains the full dataset.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Bank ID</TableHead>
                          <TableHead>Participation</TableHead>
                          <TableHead>Photo Consent</TableHead>
                          <TableHead>Revision</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {eventRegistrations.length ? (
                          eventRegistrations.map((registration, index) => {
                            const decrypted = decryptedRows[index];
                            const showPlain = !privacyMode && decrypted;
                            return (
                              <TableRow key={registration.id}>
                                <TableCell>
                                  {showPlain ? decrypted.fullName : registration.maskedFullName || "(masked)"}
                                </TableCell>
                                <TableCell>{showPlain ? decrypted.employeeId : registration.maskedEmployeeId}</TableCell>
                                <TableCell>{registration.participation || "Yes"}</TableCell>
                                <TableCell>{registration.photoConsent ? "Yes" : "No"}</TableCell>
                                <TableCell>{registration.revision}</TableCell>
                              </TableRow>
                            );
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground">
                              No registrations for this event yet.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
            </div>
          </TabsContent>

          <TabsContent value="security">
            <div className="content-grid">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Security and Storage Narrative for the Client</CardTitle>
                  <CardDescription>
                    This is the exact story we can tell on the demo call when they ask where the data sits.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flow-step">
                    <div className="flow-icon">
                      <LockKeyhole className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="flow-title">Website surface</p>
                      <p className="flow-description">
                        The page can be hosted on the client-approved website or private event URL. The data path is designed around Firebase instead of a custom database.
                      </p>
                    </div>
                  </div>
                  <div className="flow-step">
                    <div className="flow-icon">
                      <Database className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="flow-title">Storage path</p>
                      <p className="flow-description">
                        Registrations are stored in Firestore with an event ID, timestamps, duplicate key, and retention date. The live collections for this demo are:
                      </p>
                      <div className="code-panel">
                        <code>events/{"{eventId}"}</code>
                        <code>registrations/{"{eventId}__sha256(dedupe)"}</code>
                      </div>
                    </div>
                  </div>
                  <div className="flow-step">
                    <div className="flow-icon">
                      <LockKeyhole className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="flow-title">Field-level encryption</p>
                      <p className="flow-description">
                        Name, employee ID, email, and mobile are encrypted in the browser with AES-256-GCM before they hit Firestore.
                        The key is held by us (not stored next to the data). Even if the database is ever leaked, the rows look like this:
                      </p>
                      <div className="code-panel">
                        <code>email: "enc:v1:&lt;iv&gt;.&lt;ciphertext&gt;"</code>
                        <code>phone: "enc:v1:&lt;iv&gt;.&lt;ciphertext&gt;"</code>
                      </div>
                    </div>
                  </div>
                  <div className="flow-step">
                    <div className="flow-icon">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="flow-title">Duplicate detection without decryption</p>
                      <p className="flow-description">
                        The duplicate-control value (employee ID / email / mobile) is SHA-256 hashed with a per-event salt and used as the
                        Firestore document ID. The server never needs to see the plain value to block duplicates.
                      </p>
                    </div>
                  </div>
                  <div className="flow-step">
                    <div className="flow-icon">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="flow-title">Duplicate prevention</p>
                      <p className="flow-description">
                        Each event defines one duplicate control field. The app blocks repeat registrations for that value and allows an explicit replace action so the client can see the previous record before updating it.
                      </p>
                    </div>
                  </div>
                  <div className="flow-step">
                    <div className="flow-icon">
                      <Trash2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="flow-title">Retention and deletion</p>
                      <p className="flow-description">
                        Every record stores an <code>expiresAt</code> date. That supports either manual purge from the dashboard or a Firestore TTL policy for automated cleanup after the agreed retention window.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Encryption Key</CardTitle>
                  <CardDescription>
                    The AES-256 key is held by the operator and never written to Firestore. Rotating it makes prior records unreadable.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="summary-item">
                    <span>Active Key Fingerprint</span>
                    <strong>{keyFingerprint || "loading..."}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Algorithm</span>
                    <strong>AES-GCM, 256-bit, 96-bit IV per record</strong>
                  </div>
                  <div className="summary-item">
                    <span>Encrypted Fields</span>
                    <strong>fullName, employeeId, email, phone</strong>
                  </div>
                  <Button type="button" variant="outline" onClick={handleRegenerateKey} disabled={keyBusy}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {keyBusy ? "Rotating..." : "Rotate Key (Demo)"}
                  </Button>
                </CardContent>
              </Card>

            </div>
          </TabsContent>

          <TabsContent value="users">
            <div className="content-grid">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Add Admin User</CardTitle>
                  <CardDescription>
                    Anyone added here can sign into this panel. Use work emails only. Min 8-char password.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleAddAdminUser} className="space-y-3">
                    <div>
                      <Label htmlFor="new-user-email">Email</Label>
                      <Input
                        id="new-user-email"
                        type="email"
                        value={userForm.email}
                        onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                        required
                        placeholder="staffer@tndwwt.org"
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-user-password">Temporary password</Label>
                      <Input
                        id="new-user-password"
                        type="text"
                        value={userForm.password}
                        onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                        required
                        minLength={8}
                        placeholder="Min 8 characters. Share with the user securely."
                      />
                    </div>
                    {userMsg.text && (
                      <Alert className={`status-alert ${userMsg.type === "error" ? "border-red-300 bg-red-50" : "border-emerald-300 bg-emerald-50"}`}>
                        {userMsg.type === "error" ? <AlertTriangle className="h-5 w-5 text-red-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                        <AlertDescription className={userMsg.type === "error" ? "text-red-900" : "text-emerald-900"}>{userMsg.text}</AlertDescription>
                      </Alert>
                    )}
                    <Button type="submit" disabled={userBusy}>
                      {userBusy ? "Creating..." : "Add admin user"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Existing Admin Users</CardTitle>
                  <CardDescription>{adminUsers.length} {adminUsers.length === 1 ? "user" : "users"} can sign in.</CardDescription>
                </CardHeader>
                <CardContent>
                  {adminUsers.length === 0 ? (
                    <p className="text-sm text-gray-500">No admin user records yet. Add one above.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adminUsers.map((u) => (
                          <TableRow key={u.uid}>
                            <TableCell><strong>{u.email}</strong></TableCell>
                            <TableCell>{u.createdAt ? new Date(u.createdAt).toLocaleString() : "—"}</TableCell>
                            <TableCell className="text-gray-500">{u.createdBy || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  <p className="text-xs text-gray-500 mt-3">
                    To remove a user, open Firebase Console → Authentication → Users, then delete the row in the <code>users</code> collection. (Removal UI in next release.)
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {duplicateState.open && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Duplicate registration detected">
            <div className="modal-card">
              <div className="space-y-4">
                <h2 className="text-2xl font-semibold text-slate-950">Duplicate registration detected</h2>
                <p className="text-sm leading-6 text-slate-600">
                  This event already has a registration for the selected {duplicateState.event ? duplicateFieldLabels[duplicateState.event.duplicateField] : "field"}.
                </p>
                {duplicateState.existingRecord && (
                  <>
                    {(() => {
                      const prior = duplicateState.existingRecord;
                      const pending = duplicateState.pendingRegistration || {};
                      const priorPart = prior.participation || "Yes";
                      const pendingPart = pending.participation || "Yes";
                      const participationChanged = priorPart !== pendingPart;
                      const priorConsent = prior.photoConsent;
                      const pendingConsent = pending.photoConsent;
                      const consentChanged = priorConsent !== pendingConsent;
                      return (
                        <div className="duplicate-diff">
                          <div className="duplicate-diff-row">
                            <span>Previously on {formatDateTime(prior.updatedAt || prior.createdAt)} this person said attending: <strong>{priorPart}</strong>.</span>
                          </div>
                          <div className="duplicate-diff-row">
                            <span>Now submitting attending: <strong>{pendingPart}</strong>.</span>
                            {participationChanged && (
                              <span className="duplicate-diff-flag">CHANGED</span>
                            )}
                          </div>
                          {consentChanged && (
                            <div className="duplicate-diff-row">
                              <span>Photo consent: was <strong>{priorConsent ? "Yes" : "No"}</strong>, now <strong>{pendingConsent ? "Yes" : "No"}</strong>.</span>
                              <span className="duplicate-diff-flag">CHANGED</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="duplicate-panel">
                      <div className="summary-item">
                        <span>Name</span>
                        <strong>{duplicateDecrypted ? duplicateDecrypted.fullName : duplicateState.existingRecord.maskedFullName || "Decrypting..."}</strong>
                      </div>
                      <div className="summary-item">
                        <span>Employee ID</span>
                        <strong>{duplicateState.existingRecord.maskedEmployeeId}</strong>
                      </div>
                      <div className="summary-item">
                        <span>Email</span>
                        <strong>{duplicateState.existingRecord.maskedEmail}</strong>
                      </div>
                      <div className="summary-item">
                        <span>Phone</span>
                        <strong>{duplicateState.existingRecord.maskedPhone}</strong>
                      </div>
                      <div className="summary-item">
                        <span>Last Updated</span>
                        <strong>{formatDateTime(duplicateState.existingRecord.updatedAt)}</strong>
                      </div>
                      <div className="summary-item">
                        <span>Revision</span>
                        <strong>{duplicateState.existingRecord.revision}</strong>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="modal-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDuplicateState({
                      open: false,
                      event: null,
                      existingRecord: null,
                      pendingRegistration: null,
                    });
                  }}
                >
                  Keep Existing
                </Button>
                <Button type="button" onClick={confirmDuplicateReplace}>
                  Replace Registration
                </Button>
              </div>
            </div>
          </div>
        )}
        </main>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[SCB ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "ui-sans-serif, system-ui", maxWidth: 880, margin: "0 auto" }}>
          <h1 style={{ color: "#991B1B", fontSize: 22, marginBottom: 12 }}>Something crashed.</h1>
          <p style={{ color: "#3F3F46", marginBottom: 16 }}>
            The app caught a runtime error. Click below to wipe local state and reload.
          </p>
          <pre style={{ background: "#FEF2F2", color: "#7F1D1D", padding: "0.75rem", borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => {
              try {
                Object.keys(window.localStorage)
                  .filter((k) => k.startsWith("scb-") || k === "SCB_FORCE_DEMO" || k === "SCB_DATA_KEY_V1")
                  .forEach((k) => window.localStorage.removeItem(k));
              } catch {}
              window.location.reload();
            }}
            style={{ marginTop: 16, padding: "0.6rem 1.2rem", background: "#0A0A0A", color: "#fff", border: 0, borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
          >
            Wipe local data and reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithBoundary;
