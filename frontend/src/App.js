import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { AlertTriangle, Building2, CalendarDays, Database, Download, Eye, EyeOff, KeyRound, Link2, LockKeyhole, QrCode, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import "@/App.css";
import { getStoreMode, subscribeEvents, subscribeRegistrations, createEvent, deleteEvent, saveRegistration, seedScbDemoEvent, decryptRegistrations, decryptRegistration } from "@/lib/event-store";
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

function getEventShareUrl(eventId) {
  const url = new URL(window.location.href);
  url.searchParams.set("event", eventId);
  url.searchParams.set("mode", "register");
  url.hash = "register";
  return url.toString();
}

function isParticipantMode() {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).get("mode") === "register";
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

function App() {
  const storeMode = getStoreMode();
  const participantMode = isParticipantMode();
  const [events, setEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [activeTab, setActiveTab] = useState("register");
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

  useEffect(() => {
    getKeyFingerprint()
      .then(setKeyFingerprint)
      .catch(() => setKeyFingerprint("unavailable"));
  }, []);

  useEffect(() => {
    const unsubscribeEvents = subscribeEvents((nextEvents) => {
      setEvents(nextEvents);
    });
    const unsubscribeRegistrations = subscribeRegistrations((nextRegistrations) => {
      setRegistrations(nextRegistrations);
    });

    return () => {
      unsubscribeEvents();
      unsubscribeRegistrations();
    };
  }, []);

  useEffect(() => {
    if (!events.length) {
      setSelectedEventId("");
      setActiveTab("dashboard");
      return;
    }

    const urlEventId = new URLSearchParams(window.location.search).get("event");
    const nextSelected = events.find((event) => event.id === urlEventId)?.id
      || events.find((event) => event.id === selectedEventId)?.id
      || events[0].id;

    setSelectedEventId(nextSelected);

    if (window.location.hash.replace("#", "") === "register") {
      setActiveTab("register");
    }
  }, [events, selectedEventId]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) || null;
  const eventRegistrations = registrations.filter((registration) => registration.eventId === selectedEventId);

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
  const totalRegistrations = registrations.length;
  const chartData = events.map((event) => ({
    name: event.title,
    count: registrations.filter((registration) => registration.eventId === event.id).length,
  }));
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
        dark: "#0f766e",
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
      setActiveTab("dashboard");
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

  function handleSeedDemoEvent() {
    seedScbDemoEvent()
      .then((seededEvent) => {
        setSelectedEventId(seededEvent.id);
        setActiveTab("dashboard");
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

  const flowSteps = [
    {
      title: "1. QR or private link",
      description: "The client shares a single event-specific link or QR code only with the intended employees.",
      icon: QrCode,
    },
    {
      title: "2. Registration page",
      description: "Employees land on the event page, enter their details, and the form validates before save.",
      icon: Users,
    },
    {
      title: "3. Google-backed storage",
      description: "The data is written to Cloud Firestore in Firebase, inside the client's approved Google ecosystem.",
      icon: Database,
    },
    {
      title: "4. Dashboard and export",
      description: "Operations can review live registrations, export the final CSV, then purge the event data post campaign.",
      icon: ShieldCheck,
    },
  ];

  if (participantMode) {
    return (
      <div className="scb-shell">
        <div className="scb-orb scb-orb-left" />
        <div className="scb-orb scb-orb-right" />
        <div className="scb-grid" />

        <main className="scb-container scb-participant">
          <section className="hero-card">
            <div className="hero-copy">
              <Badge className="hero-badge" variant="secondary">
                Standard Chartered
              </Badge>
              <h1 className="hero-title">
                {selectedEvent ? selectedEvent.title : "Event Registration"}
              </h1>
              <p className="hero-description">
                {selectedEvent
                  ? `${selectedEvent.clientName} · ${selectedEvent.location || ""}`
                  : "This link is configured for a specific Standard Chartered event."}
              </p>
              <div className="hero-pill-row">
                <Badge variant="outline" className="hero-pill">
                  <LockKeyhole className="h-3.5 w-3.5" />
                  Encrypted before save
                </Badge>
                <Badge variant="outline" className="hero-pill">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Stored in Google Firestore
                </Badge>
              </div>
            </div>
          </section>

          {message.text && (
            <Alert className={message.type === "error" ? "status-alert border-red-300 bg-red-50" : "status-alert border-emerald-300 bg-emerald-50"}>
              <AlertTriangle className={`h-5 w-5 ${message.type === "error" ? "text-red-600" : "text-emerald-600"}`} />
              <AlertDescription className={message.type === "error" ? "text-red-900" : "text-emerald-900"}>
                {message.text}
              </AlertDescription>
            </Alert>
          )}

          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Welcome to the Quiz Calendar Creation</CardTitle>
              <CardDescription>
                Thank you for being part of this creative initiative. We will be designing Quiz Calendars to help students
                create their own calendar while learning about the important dates and events in each month. Please fill out
                the form below to mark your attendance.
                {selectedEvent && (
                  <>
                    <br />
                    <strong>Date:</strong> {formatDate(selectedEvent.eventDate)} · <strong>Location:</strong> {selectedEvent.location}
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleRegistrationSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="p-fullName">Full Name *</Label>
                  <Input id="p-fullName" value={registrationForm.fullName} onChange={(e) => updateRegistrationField("fullName", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-employeeId">Bank ID *</Label>
                  <Input id="p-employeeId" value={registrationForm.employeeId} onChange={(e) => updateRegistrationField("employeeId", e.target.value)} placeholder="SCB-EMP-1042" />
                </div>
                <div className="space-y-2">
                  <Label>Participation *</Label>
                  <div className="radio-row">
                    {participationOptions.map((option) => (
                      <label key={option} className="radio-option">
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
                <label className="consent-row">
                  <input
                    type="checkbox"
                    checked={registrationForm.photoConsent}
                    onChange={(e) => updateRegistrationField("photoConsent", e.target.checked)}
                  />
                  <span>
                    By registering for this event, you consent to processing and usage of your photos and videos for event management and internal communication purposes.
                  </span>
                </label>
                <Button type="submit" className="cta-button" disabled={submitting || !selectedEvent}>
                  {submitting ? "Submitting..." : "Submit Registration"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </main>

        {duplicateState.open && (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h2 className="text-2xl font-semibold text-slate-950">You are already registered</h2>
              <p className="text-sm leading-6 text-slate-600">
                We already have a record for this {duplicateState.event ? duplicateFieldLabels[duplicateState.event.duplicateField] : "field"}.
                Submit again to update it, or close to keep the existing entry.
              </p>
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setDuplicateState({ open: false, event: null, existingRecord: null, pendingRegistration: null })}>
                  Keep Existing
                </Button>
                <Button type="button" onClick={confirmDuplicateReplace}>Update My Entry</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="scb-shell">
      <div className="scb-orb scb-orb-left" />
      <div className="scb-orb scb-orb-right" />
      <div className="scb-grid" />

      <main className="scb-container">
        <section className="hero-card">
          <div className="hero-copy">
            <Badge className="hero-badge" variant="secondary">
              Standard Chartered Demo Stack
            </Badge>
            <h1 className="hero-title">Firebase-based event registration, dashboard visibility, and client-safe data flow.</h1>
            <p className="hero-description">
              This demo is now aligned to the meeting: a Google-backed storage model, event-wise QR registration,
              duplicate control, a live dashboard, export handoff, and a clear post-event purge path.
            </p>
            <div className="hero-pill-row">
              <Badge variant="outline" className="hero-pill">
                <Database className="h-3.5 w-3.5" />
                {storeMode === "firebase" ? "Connected to Firestore" : "Demo mode, Firebase-ready"}
              </Badge>
              <Badge variant="outline" className="hero-pill">
                <ShieldCheck className="h-3.5 w-3.5" />
                Dashboard masks sensitive fields by default
              </Badge>
              <Badge variant="outline" className="hero-pill">
                <LockKeyhole className="h-3.5 w-3.5" />
                Field-level AES-256-GCM encryption
              </Badge>
              <Badge variant="outline" className="hero-pill">
                <CalendarDays className="h-3.5 w-3.5" />
                Retention tracked per event
              </Badge>
            </div>
          </div>

          <div className="hero-metrics">
            <Card className="glass-card metric-card">
              <CardHeader className="metric-header">
                <CardDescription>Active Events</CardDescription>
                <Building2 className="metric-icon" />
              </CardHeader>
              <CardContent>
                <div className="metric-value">{events.length}</div>
              </CardContent>
            </Card>

            <Card className="glass-card metric-card">
              <CardHeader className="metric-header">
                <CardDescription>Total Registrations</CardDescription>
                <Users className="metric-icon" />
              </CardHeader>
              <CardContent>
                <div className="metric-value">{totalRegistrations}</div>
              </CardContent>
            </Card>

            <Card className="glass-card metric-card">
              <CardHeader className="metric-header">
                <CardDescription>Selected Event</CardDescription>
                <CalendarDays className="metric-icon" />
              </CardHeader>
              <CardContent>
                <div className="metric-value metric-value-small">
                  {selectedEvent ? eventRegistrations.length : 0}
                </div>
                <p className="metric-subtitle">
                  {selectedEvent ? `${selectedEvent.title}` : "Create an event to begin"}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {storeMode !== "firebase" && (
          <Alert className="status-alert border-amber-300 bg-amber-50">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertDescription className="text-amber-900">
              Firebase environment variables are not configured yet, so the demo is currently running in browser-backed
              demo mode. The UI, flow, duplicate logic, dashboard, QR generation, and Firestore data model are ready to
              switch over as soon as the Firebase keys are added.
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
          <TabsList className="tab-strip">
            <TabsTrigger value="register">Registration Desk</TabsTrigger>
            <TabsTrigger value="dashboard">Event Dashboard</TabsTrigger>
            <TabsTrigger value="security">Security Flow</TabsTrigger>
          </TabsList>

          <TabsContent value="register">
            <div className="content-grid">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Capture Registration</CardTitle>
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

              <div className="stacked-column">
                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>Event QR and Private Link</CardTitle>
                    <CardDescription>
                      Generate one QR per event so the client can distribute the registration page internally.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedEvent ? (
                      <>
                        <div className="qr-panel">
                          {qrCodeUrl ? (
                            <img className="qr-image" src={qrCodeUrl} alt={`${selectedEvent.title} QR code`} />
                          ) : (
                            <div className="qr-placeholder">QR preview unavailable</div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label>Share Link</Label>
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
                      </>
                    ) : (
                      <div className="empty-state">
                        Create an event from the dashboard to generate the QR link.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle>What the Client Sees</CardTitle>
                    <CardDescription>
                      A plain-language walkthrough of how the data moves once the QR is scanned.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {flowSteps.map((step) => {
                      const Icon = step.icon;
                      return (
                        <div key={step.title} className="flow-step">
                          <div className="flow-icon">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="flow-title">{step.title}</p>
                            <p className="flow-description">{step.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dashboard">
            <div className="content-grid">
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

              <div className="stacked-column">
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
                          <div className="summary-item">
                            <span>Client</span>
                            <strong>{selectedEvent.clientName}</strong>
                          </div>
                          <div className="summary-item">
                            <span>Event Date</span>
                            <strong>{formatDate(selectedEvent.eventDate)}</strong>
                          </div>
                          <div className="summary-item">
                            <span>Retention Until</span>
                            <strong>{formatDate(selectedEvent.expiresAt)}</strong>
                          </div>
                          <div className="summary-item">
                            <span>Duplicate Rule</span>
                            <strong>{duplicateFieldLabels[selectedEvent.duplicateField]}</strong>
                          </div>
                        </div>

                        <div className="action-row">
                          <Button type="button" onClick={handleExportSelectedEvent}>
                            <Download className="mr-2 h-4 w-4" />
                            Export CSV
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setPrivacyMode((current) => !current)}>
                            {privacyMode ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                            {decryptingReveal ? "Decrypting..." : privacyMode ? "Reveal (Decrypt)" : "Mask Off"}
                          </Button>
                          <Button type="button" variant="outline" onClick={handleDeleteEvent}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Purge Event
                          </Button>
                        </div>

                        <div className="chart-shell">
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="name" tickLine={false} axisLine={false} hide />
                              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                              <Tooltip />
                              <Bar dataKey="count" fill="#0f766e" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
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

              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Meeting Translation</CardTitle>
                  <CardDescription>
                    What the transcript changed in the product direction.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-slate-700">
                  <div className="summary-item">
                    <span>What they rejected</span>
                    <strong>Custom storage that feels outside Google or looks hard to audit.</strong>
                  </div>
                  <div className="summary-item">
                    <span>What they asked to see</span>
                    <strong>A full module: QR entry, data landing point, dashboard, and the final send-to-client format.</strong>
                  </div>
                  <div className="summary-item">
                    <span>What this version demonstrates</span>
                    <strong>Event creation, QR generation, duplicate-safe registration, live dashboard, CSV export, and post-event purge.</strong>
                  </div>
                  <div className="summary-item">
                    <span>What still depends on Firebase credentials</span>
                    <strong>Real Firestore writes in production mode and the final project-specific security rules.</strong>
                  </div>
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
  );
}

export default App;
