import { useState, useEffect, useCallback, useRef } from "react";
import { dbGetAll, dbPut, dbDelete, dbClear, requestPersistentStorage } from "./db";

// ============================================================
// PRIORITY SCORING
// ============================================================
const IMPORTANCE_SCORES = { critical: 4, high: 3, normal: 2 };
const EFFORT_SCORES = { small: 3, medium: 2, large: 1 };

function calcPriority(task) {
  const imp = IMPORTANCE_SCORES[task.importance] || 2;
  const eff = EFFORT_SCORES[task.effort] || 2;
  let score = imp * 10 + eff;
  if (task.deadline) {
    const days = daysUntil(task.deadline);
    if (days <= 1) score += 8;
    else if (days <= 3) score += 5;
    else if (days <= 7) score += 2;
  }
  return score;
}

// ============================================================
// HELPERS
// ============================================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function relativeDeadline(dateStr) {
  if (!dateStr) return "";
  const days = daysUntil(dateStr);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 6) return `${days}d`;
  return formatDate(dateStr);
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nextWeekday(dayIndex) { // 0=Sun … 6=Sat
  const d = new Date();
  const diff = (dayIndex - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// ICONS (inline SVG components)
// ============================================================
const Icon = ({ d, size = 20, color = "currentColor", ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d={d} />
  </svg>
);

const Icons = {
  plus: (p) => <Icon d="M12 5v14M5 12h14" {...p} />,
  check: (p) => <Icon d="M20 6L9 17l-5-5" {...p} />,
  inbox: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  ),
  sun: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  moon: (p) => <Icon d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" {...p} />,
  chevronRight: (p) => <Icon d="M9 18l6-6-6-6" {...p} />,
  chevronLeft: (p) => <Icon d="M15 18l-6-6 6-6" {...p} />,
  x: (p) => <Icon d="M18 6L6 18M6 6l12 12" {...p} />,
  list: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  settings: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  archive: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  clock: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  download: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  upload: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  swap: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
    </svg>
  ),
  edit: (p) => <Icon d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" {...p} />,
  trash: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  ),
  calendar: (p) => (
    <svg width={p?.size || 20} height={p?.size || 20} viewBox="0 0 24 24" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
};

// ============================================================
// STYLES
// ============================================================
const COLORS = {
  bg: "#0a0c0f",
  surface: "#13171c",
  surfaceHover: "#191e25",
  surfaceActive: "#1f252e",
  border: "#242b34",
  borderLight: "#2f3844",
  text: "#eaecef",
  textMuted: "#8d95a0",
  textDim: "#545e6b",
  accent: "#4f9eff",
  accentBright: "#6eb3ff",
  accentDim: "#152d50",
  accentGlow: "rgba(79, 158, 255, 0.15)",
  success: "#34c759",
  successDim: "#0f2d1a",
  warning: "#f59e0b",
  warningDim: "#3a2500",
  danger: "#ff453a",
  dangerDim: "#3a0f0d",
  work: "#bf5af2",
  workDim: "#2a1245",
  personal: "#30d158",
  personalDim: "#0d2b18",
  scoreBg: "#0d1f35",
  scoreHigh: "#f59e0b",
  scoreLow: "#545e6b",
};

const FONT = `'JetBrains Mono', 'SF Mono', 'Fira Code', monospace`;
const FONT_DISPLAY = `'Space Grotesk', 'Outfit', system-ui, sans-serif`;

// ============================================================
// MAIN APP
// ============================================================
export default function FocusApp() {
  const [tasks, setTasks] = useState([]);
  const [screen, setScreen] = useState("day"); // day, inbox, processing, backlog, someday, morning, settings
  const [context, setContext] = useState("work");
  const [loaded, setLoaded] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const [processingIds, setProcessingIds] = useState([]); // snapshot of inbox task IDs
  const [processingCursor, setProcessingCursor] = useState(0);
  const [processingAnswers, setProcessingAnswers] = useState({});
  const [swapTask, setSwapTask] = useState(null); // task attempting to be added to top5
  const [backlogTab, setBacklogTab] = useState("backlog"); // backlog | someday
  const [backlogFilter, setBacklogFilter] = useState("all"); // all | critical | deadline | quick
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [pendingDeadline, setPendingDeadline] = useState("");
  const [metaTask, setMetaTask] = useState(null);
  const [pendingMeta, setPendingMeta] = useState({});
  const [snoozeTask, setSnoozeTask] = useState(null);
  const [pendingSnooze, setPendingSnooze] = useState("");
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [toast, setToast] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const captureRef = useRef(null);
  const editInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const autoFillRef = useRef({});

  // Load tasks from IndexedDB
  useEffect(() => {
    dbGetAll("tasks").then((t) => {
      setTasks(t || []);
      setLoaded(true);
    }).catch(() => setLoaded(true));

    // Request persistent storage
    requestPersistentStorage();

    // Capture install prompt
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  // Reset pending deadline each time the deadline_date step becomes active
  useEffect(() => {
    if (getProcessingStep() === "deadline_date") setPendingDeadline("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingAnswers]);

  // Lift capture sheet above soft keyboard using visualViewport
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !captureOpen) {
      setKeyboardOffset(0);
      return;
    }
    const handleResize = () => {
      setKeyboardOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    vv.addEventListener("resize", handleResize);
    handleResize(); // apply immediately if keyboard already open
    return () => {
      vv.removeEventListener("resize", handleResize);
      setKeyboardOffset(0);
    };
  }, [captureOpen]);

  // Auto-fill top 3 from backlog by priority score (once per context per day)
  useEffect(() => {
    if (screen !== "day" || !loaded) return;
    const key = `${context}:${todayStr()}`;
    if (autoFillRef.current[key]) return;
    autoFillRef.current[key] = true;

    const todayTop5 = tasks.filter(
      (t) => t.status === "top5" && t.context === context && t.top5Date === todayStr()
    );
    const slotsNeeded = 3 - todayTop5.length;
    if (slotsNeeded <= 0) return;

    const candidates = tasks
      .filter((t) => t.status === "backlog" && t.context === context)
      .sort((a, b) => calcPriority(b) - calcPriority(a))
      .slice(0, slotsNeeded);

    if (candidates.length === 0) return;

    candidates.forEach((task) => {
      dbPut("tasks", { ...task, status: "top5", top5Date: todayStr() });
    });
    setTasks((prev) =>
      prev.map((t) =>
        candidates.find((c) => c.id === t.id)
          ? { ...t, status: "top5", top5Date: todayStr() }
          : t
      )
    );
    setToast(`Auto-filled ${candidates.length} top task${candidates.length > 1 ? "s" : ""}`);
    setTimeout(() => setToast(null), 2200);
  }, [screen, context, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist task changes
  const saveTask = useCallback(async (task) => {
    await dbPut("tasks", task);
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) return prev.map((t) => (t.id === task.id ? task : t));
      return [...prev, task];
    });
  }, []);

  const removeTask = useCallback(async (id) => {
    await dbDelete("tasks", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // Derived
  const inboxTasks = tasks.filter((t) => t.status === "inbox");
  const backlogTasks = tasks
    .filter((t) => t.status === "backlog" && t.context === context && (!t.snoozedUntil || t.snoozedUntil <= todayStr()))
    .sort((a, b) => calcPriority(b) - calcPriority(a));
  const snoozedTasks = tasks
    .filter((t) => t.status === "backlog" && t.context === context && t.snoozedUntil && t.snoozedUntil > todayStr())
    .sort((a, b) => a.snoozedUntil.localeCompare(b.snoozedUntil));
  const top5Tasks = tasks
    .filter((t) => t.status === "top5" && t.context === context && t.top5Date === todayStr())
    .sort((a, b) => calcPriority(b) - calcPriority(a));
  const completedToday = tasks.filter(
    (t) => t.status === "done" && t.context === context && t.completedDate === todayStr()
  );
  const somedayTasks = tasks.filter((t) => t.status === "someday");
  const yesterdayIncomplete = tasks.filter(
    (t) => t.status === "top5" && t.top5Date && t.top5Date < todayStr()
  );

  // Capture
  const handleCapture = () => {
    const text = captureText.trim();
    if (!text) return;
    const task = {
      id: genId(),
      title: text,
      status: "inbox",
      context: null,
      effort: null,
      importance: null,
      deadline: null,
      top5Date: null,
      completedDate: null,
      createdAt: new Date().toISOString(),
    };
    saveTask(task);
    setCaptureText("");
    setCaptureOpen(false);
    showToast("Captured");
  };

  const handleCaptureToday = () => {
    const text = captureText.trim();
    if (!text) return;
    const task = {
      id: genId(),
      title: text,
      status: "backlog",
      context,
      effort: "medium",
      importance: "normal",
      deadline: null,
      top5Date: null,
      completedDate: null,
      createdAt: new Date().toISOString(),
    };
    if (top5Tasks.length < 5) {
      saveTask({ ...task, status: "top5", top5Date: todayStr() });
      showToast("Added to today");
    } else {
      saveTask(task);
      setSwapTask({ ...task, status: "top5", top5Date: todayStr() });
    }
    setCaptureText("");
    setCaptureOpen(false);
  };

  // Processing
  const startProcessing = () => {
    if (inboxTasks.length === 0) return;
    const ids = inboxTasks.map((t) => t.id);
    setProcessingIds(ids);
    setProcessingCursor(0);
    setProcessingAnswers({});
    setScreen("processing");
  };

  const startProcessingSingle = (taskId) => {
    setProcessingIds([taskId]);
    setProcessingCursor(0);
    setProcessingAnswers({});
    setScreen("processing");
  };

  // Get current processing task by ID from the snapshot
  const currentProcessingTask = processingIds.length > 0
    ? tasks.find((t) => t.id === processingIds[processingCursor])
    : null;

  const handleProcessAnswer = (field, value) => {
    if (!currentProcessingTask) return;

    const newAnswers = { ...processingAnswers, [field]: value };

    if (field === "actionable") {
      if (value === "drop") {
        removeTask(currentProcessingTask.id);
        advanceProcessing();
        return;
      }
      if (value === "someday") {
        saveTask({ ...currentProcessingTask, status: "someday" });
        advanceProcessing();
        return;
      }
      setProcessingAnswers(newAnswers);
      return;
    }

    if (field === "deadline_date") {
      const updated = {
        ...currentProcessingTask,
        status: "backlog",
        context: newAnswers.context || "work",
        effort: newAnswers.effort || "medium",
        importance: newAnswers.importance || "normal",
        deadline: value || null,
      };
      saveTask(updated);
      showToast("Processed");
      advanceProcessing();
      return;
    }

    if (field === "has_deadline" && value === "no") {
      const updated = {
        ...currentProcessingTask,
        status: "backlog",
        context: newAnswers.context || "work",
        effort: newAnswers.effort || "medium",
        importance: newAnswers.importance || "normal",
        deadline: null,
      };
      saveTask(updated);
      showToast("Processed");
      advanceProcessing();
      return;
    }

    setProcessingAnswers(newAnswers);
  };

  const advanceProcessing = () => {
    const nextIdx = processingCursor + 1;
    if (nextIdx >= processingIds.length) {
      const single = processingIds.length === 1;
      setScreen(single ? "inbox" : "day");
      setProcessingIds([]);
      if (!single) showToast("Inbox clear");
    } else {
      setProcessingCursor(nextIdx);
      setProcessingAnswers({});
    }
  };

  // Top 5 management
  const addToTop5 = (task) => {
    if (top5Tasks.length >= 5) {
      setSwapTask(task);
      return;
    }
    saveTask({ ...task, status: "top5", top5Date: todayStr() });
    showToast("Added to Top 5");
  };

  const handleSwap = (removeTask_) => {
    if (!swapTask) return;
    saveTask({ ...removeTask_, status: "backlog", top5Date: null });
    saveTask({ ...swapTask, status: "top5", top5Date: todayStr() });
    setSwapTask(null);
    showToast("Swapped");
  };

  const completeTask = (task) => {
    saveTask({ ...task, status: "done", completedDate: todayStr() });
    showToast("Done!");
  };

  const sendToBacklog = (task) => {
    saveTask({ ...task, status: "backlog", top5Date: null });
  };

  // Morning nudge actions
  const keepTask = (task) => {
    // Send back to pipeline so auto-fill re-evaluates it alongside new candidates
    saveTask({ ...task, status: "backlog", top5Date: null });
  };

  const dropTask = (task) => {
    removeTask(task.id);
  };

  // Inline editing
  const startEdit = (task) => {
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
    setTimeout(() => editInputRef.current?.focus(), 30);
  };

  const commitEdit = (task) => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== task.title) {
      saveTask({ ...task, title: trimmed });
    }
    setEditingTaskId(null);
    setEditingTitle("");
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setEditingTitle("");
  };

  const openMetaEditor = (task) => {
    setMetaTask(task);
    setPendingMeta({
      context: task.context || "work",
      importance: task.importance || "normal",
      effort: task.effort || "medium",
      deadline: task.deadline || "",
    });
  };

  const saveMetaEdit = () => {
    if (!metaTask) return;
    saveTask({
      ...metaTask,
      context: pendingMeta.context,
      importance: pendingMeta.importance,
      effort: pendingMeta.effort,
      deadline: pendingMeta.deadline || null,
    });
    setMetaTask(null);
    showToast("Updated");
  };

  const applySnooze = (date) => {
    if (!snoozeTask || !date) return;
    const updates = { snoozedUntil: date };
    if (snoozeTask.status === "top5") {
      updates.status = "backlog";
      updates.top5Date = null;
    }
    saveTask({ ...snoozeTask, ...updates });
    setSnoozeTask(null);
    setPendingSnooze("");
    showToast("Snoozed");
  };

  const clearSnooze = (task) => {
    saveTask({ ...task, snoozedUntil: null });
    showToast("Woken up");
  };

  // Export
  const exportData = () => {
    const data = JSON.stringify(tasks, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `focus-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported");
  };

  // Import
  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        await dbClear("tasks");
        for (const t of imported) await dbPut("tasks", t);
        setTasks(imported);
        showToast("Imported " + imported.length + " tasks");
      } catch {
        showToast("Import failed");
      }
    };
    reader.readAsText(file);
  };

  // Processing step
  const getProcessingStep = () => {
    const a = processingAnswers;
    if (!a.actionable) return "actionable";
    if (!a.context || !a.effort || !a.importance || !a._detailsDone) return "details";
    if (!a.has_deadline) return "has_deadline";
    if (a.has_deadline === "yes" && !a.deadline_date) return "deadline_date";
    return "done";
  };

  if (!loaded) {
    return (
      <div style={{ background: COLORS.bg, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.textMuted, fontFamily: FONT, fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div style={{
      background: COLORS.bg,
      minHeight: "100vh",
      color: COLORS.text,
      fontFamily: FONT_DISPLAY,
      fontSize: 14,
      position: "relative",
      maxWidth: 480,
      margin: "0 auto",
      overflow: "hidden",
    }}>
      <style>{`
        input, textarea, button { font-family: inherit; }
        button { cursor: pointer; border: none; background: none; color: inherit; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .focus-card { animation: slideUp 0.25s ease-out; }
        .focus-fade { animation: fadeIn 0.2s ease-out; }
        .focus-slide { animation: slideIn 0.3s ease-out; }
        .btn-choice {
          padding: 13px 20px; border-radius: 12px; font-size: 14px;
          font-weight: 500; transition: all 0.15s ease;
          border: 1px solid ${COLORS.border}; background: ${COLORS.surface};
          text-align: center; width: 100%;
        }
        .btn-choice:hover { background: ${COLORS.surfaceHover}; border-color: ${COLORS.borderLight}; }
        .btn-choice:active { background: ${COLORS.surfaceActive}; transform: scale(0.98); }
        .btn-primary {
          padding: 11px 22px; border-radius: 10px; font-size: 13px;
          font-weight: 600; background: ${COLORS.accent}; color: #000;
          transition: all 0.15s ease; letter-spacing: 0.2px;
        }
        .btn-primary:hover { background: ${COLORS.accentBright}; }
        .btn-primary:active { transform: scale(0.97); }
        .task-row {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 12px;
          background: ${COLORS.surface}; border: 1px solid ${COLORS.border};
          border-left-width: 3px;
          transition: all 0.15s ease; margin-bottom: 8px;
        }
        .task-row:hover { background: ${COLORS.surfaceHover}; }
        .check-circle {
          width: 24px; height: 24px; border-radius: 50%;
          border: 2px solid ${COLORS.borderLight}; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s ease; cursor: pointer;
        }
        .check-circle:hover { border-color: ${COLORS.success}; background: ${COLORS.successDim}; }
        .nav-item {
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          padding: 8px 0 6px; font-size: 10px; color: ${COLORS.textDim};
          transition: color 0.15s ease; position: relative; flex: 1;
          font-family: '${FONT_DISPLAY}';
        }
        .nav-item.active { color: ${COLORS.accent}; }
        .nav-item.active::after {
          content: ''; position: absolute; bottom: 2px;
          width: 4px; height: 4px; border-radius: 50%;
          background: ${COLORS.accent};
        }
        .badge {
          position: absolute; top: 2px; right: calc(50% - 18px);
          background: ${COLORS.danger}; color: white; font-size: 9px;
          font-weight: 700; padding: 1px 5px; border-radius: 8px; min-width: 16px;
          text-align: center; font-family: ${FONT};
        }
        .tag {
          display: inline-block; padding: 2px 7px; border-radius: 5px;
          font-size: 10px; font-weight: 600; letter-spacing: 0.4px;
          font-family: ${FONT};
        }
        .progress-seg {
          height: 4px; border-radius: 2px; flex: 1;
          background: ${COLORS.border}; transition: background 0.4s ease;
        }
        .progress-seg.filled { background: ${COLORS.success}; }
        .score-badge {
          font-family: ${FONT}; font-size: 11px; font-weight: 700;
          padding: 3px 8px; border-radius: 6px; flex-shrink: 0;
        }
        .rank-num {
          font-family: ${FONT}; font-size: 11px; font-weight: 600;
          color: ${COLORS.textDim}; min-width: 20px; text-align: right;
          flex-shrink: 0;
        }
        .overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.75); display: flex; align-items: flex-end;
          justify-content: center; z-index: 100; animation: fadeIn 0.15s ease-out;
        }
        .sheet {
          background: ${COLORS.surface}; border-radius: 20px 20px 0 0;
          padding: 24px 20px 36px; width: 100%; max-width: 480px;
          animation: slideUp 0.25s ease-out; border-top: 1px solid ${COLORS.border};
        }
      `}</style>

      {/* HEADER */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{
          padding: "18px 20px 16px", display: "flex", alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{
              fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700,
              letterSpacing: "-0.5px", background: `linear-gradient(90deg, ${COLORS.text} 0%, ${COLORS.accentBright} 100%)`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              FocusFlow
            </div>
            <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2, fontWeight: 500 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </div>
          </div>
          <div style={{
            display: "flex", gap: 3, background: COLORS.surface, borderRadius: 12,
            padding: 3, border: `1px solid ${COLORS.border}`,
          }}>
            <button
              onClick={() => setContext("work")}
              style={{
                padding: "7px 14px", borderRadius: 9, fontSize: 11, fontWeight: 700,
                letterSpacing: "0.5px", transition: "all 0.15s ease", fontFamily: FONT,
                background: context === "work" ? COLORS.workDim : "transparent",
                color: context === "work" ? COLORS.work : COLORS.textDim,
                border: context === "work" ? `1px solid ${COLORS.work}40` : "1px solid transparent",
              }}
            >
              WORK
            </button>
            <button
              onClick={() => setContext("personal")}
              style={{
                padding: "7px 14px", borderRadius: 9, fontSize: 11, fontWeight: 700,
                letterSpacing: "0.5px", transition: "all 0.15s ease", fontFamily: FONT,
                background: context === "personal" ? COLORS.personalDim : "transparent",
                color: context === "personal" ? COLORS.personal : COLORS.textDim,
                border: context === "personal" ? `1px solid ${COLORS.personal}40` : "1px solid transparent",
              }}
            >
              PER
            </button>
          </div>
        </div>
        {/* Gradient accent line */}
        <div style={{
          height: 2,
          background: `linear-gradient(90deg, ${COLORS.accent}88 0%, ${COLORS.work}44 50%, transparent 100%)`,
        }} />
      </div>

      {/* MAIN CONTENT */}
      <div style={{ padding: "16px 20px 100px", minHeight: "calc(100vh - 140px)" }}>

        {/* ==================== DAY VIEW ==================== */}
        {screen === "day" && (
          <div className="focus-fade">
            {/* Morning nudge banner */}
            {yesterdayIncomplete.length > 0 && (
              <button
                onClick={() => setScreen("morning")}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 16px", borderRadius: 10, marginBottom: 16,
                  background: COLORS.warningDim, border: `1px solid ${COLORS.warning}33`,
                  width: "100%", textAlign: "left",
                }}
              >
                <Icons.sun color={COLORS.warning} size={18} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.warning }}>
                    {yesterdayIncomplete.length} task{yesterdayIncomplete.length > 1 ? "s" : ""} from yesterday
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                    Tap to review
                  </div>
                </div>
                <Icons.chevronRight color={COLORS.warning} size={16} style={{ marginLeft: "auto" }} />
              </button>
            )}

            {/* Progress */}
            {(() => {
              const total = top5Tasks.length + completedToday.length;
              const done = completedToday.length;
              const allDone = total > 0 && done === total;
              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", fontFamily: FONT }}>
                      TODAY
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: allDone ? COLORS.success : COLORS.textMuted }}>
                      {allDone && total > 0 ? "All done" : `${done}/${total} done`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className={`progress-seg${i < done ? " filled" : ""}`} />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Top 5 */}
            {top5Tasks.length === 0 && completedToday.length === 0 ? (
              <div style={{
                textAlign: "center", padding: "52px 20px",
                color: COLORS.textDim,
              }}>
                <div style={{ fontSize: 40, marginBottom: 14, letterSpacing: 6, color: COLORS.border }}>
                  {context === "work" ? "///" : "~~~"}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600, color: COLORS.textMuted, marginBottom: 8 }}>
                  Nothing here yet
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: COLORS.textDim }}>
                  Process your inbox to build a pipeline —<br />your top 3 will auto-fill each morning.
                </div>
              </div>
            ) : (
              <div>
                {top5Tasks.map((task, i) => {
                  const borderColor = task.importance === "critical" ? COLORS.danger
                    : task.importance === "high" ? COLORS.warning
                    : COLORS.border;
                  return (
                    <div key={task.id} className="task-row focus-card" style={{
                      animationDelay: `${i * 50}ms`,
                      borderLeftColor: borderColor,
                    }}>
                      <span className="rank-num">#{i + 1}</span>
                      <div className="check-circle" onClick={() => completeTask(task)}>
                        <Icons.check size={12} color="transparent" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {editingTaskId === task.id ? (
                          <input
                            ref={editInputRef}
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => commitEdit(task)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(task);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            style={{
                              width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.accent}`,
                              borderRadius: 6, padding: "3px 8px", color: COLORS.text,
                              fontSize: 14, fontWeight: 500, fontFamily: FONT_DISPLAY, outline: "none",
                            }}
                          />
                        ) : (
                          <div
                            onClick={() => startEdit(task)}
                            style={{
                              fontSize: 14, fontWeight: 500, cursor: "text",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                            title="Tap to edit"
                          >
                            {task.title}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                          {task.importance === "critical" && (
                            <span className="tag" style={{ background: COLORS.dangerDim, color: COLORS.danger }}>critical</span>
                          )}
                          {task.importance === "high" && (
                            <span className="tag" style={{ background: COLORS.warningDim, color: COLORS.warning }}>high</span>
                          )}
                          {task.effort && (
                            <span className="tag" style={{ background: COLORS.border, color: COLORS.textMuted }}>{task.effort}</span>
                          )}
                          {task.deadline && (
                            <span className="tag" style={{
                              background: daysUntil(task.deadline) <= 1 ? COLORS.dangerDim : COLORS.accentDim,
                              color: daysUntil(task.deadline) <= 1 ? COLORS.danger : COLORS.accent,
                            }}>
                              {relativeDeadline(task.deadline)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => openMetaEditor(task)} style={{ padding: 4, opacity: 0.35 }} title="Edit task">
                        <Icons.edit size={14} />
                      </button>
                      <button onClick={() => { setSnoozeTask(task); setPendingSnooze(""); }} style={{ padding: 4, opacity: 0.35 }} title="Not today">
                        <Icons.clock size={14} />
                      </button>
                      <button onClick={() => sendToBacklog(task)} style={{ padding: 4, opacity: 0.35 }} title="Remove from today">
                        <Icons.x size={14} />
                      </button>
                    </div>
                  );
                })}

                {/* Completed today */}
                {completedToday.map((task) => (
                  <div key={task.id} className="task-row" style={{ opacity: 0.4, borderColor: "transparent" }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: COLORS.success, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icons.check size={12} color="#000" />
                    </div>
                    <div style={{
                      fontSize: 13, textDecoration: "line-through",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {task.title}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================== INBOX ==================== */}
        {screen === "inbox" && (
          <div className="focus-fade">
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 20,
            }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600 }}>
                Inbox
                {inboxTasks.length > 0 && (
                  <span style={{ color: COLORS.textDim, fontWeight: 400, marginLeft: 8 }}>{inboxTasks.length}</span>
                )}
              </div>
              {inboxTasks.length > 0 && (
                <button className="btn-primary" onClick={startProcessing} style={{ fontSize: 12, padding: "8px 16px" }}>
                  Process all
                </button>
              )}
            </div>

            {inboxTasks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px", color: COLORS.textDim }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>
                  {"{ }"}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: COLORS.textMuted, marginBottom: 8 }}>
                  Inbox is empty
                </div>
                <div style={{ fontSize: 12 }}>
                  Capture something to get started
                </div>
              </div>
            ) : (
              inboxTasks.map((task, i) => (
                <div key={task.id} className="task-row focus-card" style={{ animationDelay: `${i * 30}ms` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{task.title}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 4 }}>
                      {formatDate(task.createdAt?.slice(0, 10))}
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    onClick={() => startProcessingSingle(task.id)}
                    style={{ fontSize: 10, padding: "5px 10px", flexShrink: 0 }}
                  >
                    Process
                  </button>
                  <button onClick={() => removeTask(task.id)} style={{ padding: 4, opacity: 0.4 }} title="Delete">
                    <Icons.trash size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* ==================== PROCESSING ==================== */}
        {screen === "processing" && currentProcessingTask && (
          <div className="focus-slide" key={currentProcessingTask.id}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 24,
            }}>
              <button onClick={() => { setScreen("inbox"); setProcessingIds([]); }} style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.textMuted, fontSize: 12 }}>
                <Icons.chevronLeft size={16} /> Back
              </button>
              <div style={{ fontSize: 11, color: COLORS.textDim }}>
                {processingCursor + 1} of {processingIds.length}
              </div>
            </div>

            {/* Task card */}
            <div style={{
              background: COLORS.surface, borderRadius: 12, padding: "20px",
              border: `1px solid ${COLORS.border}`, marginBottom: 28,
            }}>
              <div style={{
                fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
                lineHeight: 1.5,
              }}>
                {currentProcessingTask.title}
              </div>
            </div>

            {/* Processing questions */}
            {(() => {
              const step = getProcessingStep();

              if (step === "actionable") return (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, fontFamily: FONT_DISPLAY }}>
                    Is this actionable?
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button className="btn-choice" onClick={() => handleProcessAnswer("actionable", "yes")}>
                      Yes, I need to do this
                    </button>
                    <button className="btn-choice" onClick={() => handleProcessAnswer("actionable", "someday")}>
                      Someday, not now
                    </button>
                    <button className="btn-choice" onClick={() => handleProcessAnswer("actionable", "drop")} style={{ color: COLORS.danger }}>
                      Drop it
                    </button>
                  </div>
                </div>
              );

              if (step === "details") {
                const sel = (field, value) => setProcessingAnswers(prev => ({ ...prev, [field]: value }));
                const { context: ctx, effort: eff, importance: imp } = processingAnswers;
                const allSet = ctx && eff && imp;
                return (
                  <div>
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 10 }}>CONTEXT</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {[["work", "Work", COLORS.work], ["personal", "Personal", COLORS.personal]].map(([v, label, color]) => (
                          <button key={v} className="btn-choice" onClick={() => sel("context", v)} style={{
                            flex: 1,
                            background: ctx === v ? COLORS.accentDim : COLORS.surface,
                            borderColor: ctx === v ? `${COLORS.accent}55` : COLORS.border,
                          }}>
                            <span style={{ color: ctx === v ? color : COLORS.textMuted }}>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 10 }}>EFFORT</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {["small", "medium", "large"].map(v => (
                          <button key={v} className="btn-choice" onClick={() => sel("effort", v)} style={{
                            flex: 1,
                            background: eff === v ? COLORS.accentDim : COLORS.surface,
                            borderColor: eff === v ? `${COLORS.accent}55` : COLORS.border,
                            color: eff === v ? COLORS.accent : COLORS.textMuted,
                          }}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 10 }}>IMPORTANCE</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {[["critical", COLORS.danger], ["high", COLORS.warning], ["normal", COLORS.textMuted]].map(([v, color]) => (
                          <button key={v} className="btn-choice" onClick={() => sel("importance", v)} style={{
                            flex: 1,
                            background: imp === v ? COLORS.accentDim : COLORS.surface,
                            borderColor: imp === v ? `${COLORS.accent}55` : COLORS.border,
                          }}>
                            <span style={{ color: imp === v ? color : COLORS.textMuted }}>{v}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      className="btn-primary"
                      disabled={!allSet}
                      onClick={() => setProcessingAnswers(prev => ({ ...prev, _detailsDone: true }))}
                      style={{ width: "100%", opacity: allSet ? 1 : 0.4 }}
                    >
                      Continue
                    </button>
                  </div>
                );
              }

              if (step === "has_deadline") return (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, fontFamily: FONT_DISPLAY }}>
                    Is there a deadline?
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-choice" onClick={() => handleProcessAnswer("has_deadline", "yes")} style={{ flex: 1 }}>
                      Yes
                    </button>
                    <button className="btn-choice" onClick={() => handleProcessAnswer("has_deadline", "no")} style={{ flex: 1 }}>
                      No
                    </button>
                  </div>
                </div>
              );

              if (step === "deadline_date") return (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, fontFamily: FONT_DISPLAY }}>
                    When is it due?
                  </div>
                  <input
                    type="date"
                    value={pendingDeadline}
                    onChange={(e) => setPendingDeadline(e.target.value)}
                    style={{
                      width: "100%", padding: "14px 16px", borderRadius: 10,
                      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                      color: COLORS.text, fontSize: 14, fontFamily: FONT,
                    }}
                  />
                  <button
                    className="btn-primary"
                    disabled={!pendingDeadline}
                    onClick={() => handleProcessAnswer("deadline_date", pendingDeadline)}
                    style={{ marginTop: 12, width: "100%", opacity: pendingDeadline ? 1 : 0.4 }}
                  >
                    Set due date
                  </button>
                </div>
              );

              return null;
            })()}

            {/* Progress dots */}
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 32 }}>
              {["actionable", "details", "has_deadline"].map((s, i) => {
                const step = getProcessingStep();
                const steps = ["actionable", "details", "has_deadline"];
                const currentIdx = steps.indexOf(step);
                return (
                  <div key={s} style={{
                    width: 6, height: 6, borderRadius: 3,
                    background: i <= currentIdx ? COLORS.accent : COLORS.border,
                    transition: "background 0.2s ease",
                  }} />
                );
              })}
            </div>
          </div>
        )}

        {/* ==================== BACKLOG (with Someday tab) ==================== */}
        {screen === "backlog" && (
          <div className="focus-fade">
            {/* Tab switcher */}
            <div style={{
              display: "flex", gap: 4, marginBottom: 20,
              background: COLORS.surface, borderRadius: 10, padding: 3,
              border: `1px solid ${COLORS.border}`,
            }}>
              <button
                onClick={() => { setBacklogTab("backlog"); setBacklogFilter("all"); }}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  transition: "all 0.15s ease", textAlign: "center",
                  background: backlogTab === "backlog" ? COLORS.accentDim : "transparent",
                  color: backlogTab === "backlog" ? COLORS.accent : COLORS.textDim,
                  border: backlogTab === "backlog" ? `1px solid ${COLORS.accent}33` : "1px solid transparent",
                }}
              >
                Pipeline{backlogTasks.length > 0 ? ` (${backlogTasks.length})` : ""}
              </button>
              <button
                onClick={() => setBacklogTab("someday")}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  transition: "all 0.15s ease", textAlign: "center",
                  background: backlogTab === "someday" ? COLORS.accentDim : "transparent",
                  color: backlogTab === "someday" ? COLORS.accent : COLORS.textDim,
                  border: backlogTab === "someday" ? `1px solid ${COLORS.accent}33` : "1px solid transparent",
                }}
              >
                Someday{somedayTasks.length > 0 ? ` (${somedayTasks.length})` : ""}
              </button>
            </div>

            {/* Backlog tab */}
            {backlogTab === "backlog" && (
              <>
                {/* Filter chips */}
                {backlogTasks.length > 0 && (() => {
                  const chips = [
                    { id: "all", label: "All", count: backlogTasks.length },
                    { id: "critical", label: "Critical", count: backlogTasks.filter(t => t.importance === "critical").length },
                    { id: "deadline", label: "Deadline", count: backlogTasks.filter(t => t.deadline).length },
                    { id: "quick", label: "Quick wins", count: backlogTasks.filter(t => t.effort === "small").length },
                  ].filter(c => c.id === "all" || c.count > 0);
                  return (
                    <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                      {chips.map((chip) => {
                        const active = backlogFilter === chip.id;
                        return (
                          <button
                            key={chip.id}
                            onClick={() => setBacklogFilter(chip.id)}
                            style={{
                              padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                              transition: "all 0.15s ease", cursor: "pointer",
                              background: active ? COLORS.accentDim : COLORS.surface,
                              color: active ? COLORS.accent : COLORS.textMuted,
                              border: active ? `1px solid ${COLORS.accent}55` : `1px solid ${COLORS.border}`,
                            }}
                          >
                            {chip.label}
                            {chip.id !== "all" && (
                              <span style={{ marginLeft: 5, fontFamily: FONT, fontSize: 10, opacity: 0.8 }}>
                                {chip.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                {(() => {
                  const filtered = backlogTasks.filter((t) => {
                    if (backlogFilter === "critical") return t.importance === "critical";
                    if (backlogFilter === "deadline") return !!t.deadline;
                    if (backlogFilter === "quick") return t.effort === "small";
                    return true;
                  });
                  return filtered.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: COLORS.textDim }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: COLORS.textMuted, marginBottom: 8 }}>
                        {backlogTasks.length === 0 ? "Pipeline is empty" : "No matches"}
                      </div>
                      <div style={{ fontSize: 12 }}>
                        {backlogTasks.length === 0 ? "Process inbox items to fill your pipeline" : "Try a different filter"}
                      </div>
                    </div>
                  ) : (
                    filtered.map((task, i) => {
                    const score = calcPriority(task);
                    const scoreColor = score >= 40 ? COLORS.accent : score >= 30 ? COLORS.scoreHigh : COLORS.scoreLow;
                    const scoreBg = score >= 40 ? COLORS.scoreBg : score >= 30 ? COLORS.warningDim : COLORS.border;
                    const borderColor = task.importance === "critical" ? COLORS.danger
                      : task.importance === "high" ? COLORS.warning
                      : COLORS.border;
                    return (
                      <div key={task.id} className="task-row focus-card" style={{
                        animationDelay: `${i * 30}ms`, borderLeftColor: borderColor,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {editingTaskId === task.id ? (
                            <input
                              ref={editInputRef}
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onBlur={() => commitEdit(task)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(task);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              style={{
                                width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.accent}`,
                                borderRadius: 6, padding: "3px 8px", color: COLORS.text,
                                fontSize: 14, fontWeight: 500, fontFamily: FONT_DISPLAY, outline: "none",
                              }}
                            />
                          ) : (
                            <div
                              onClick={() => startEdit(task)}
                              style={{
                                fontSize: 14, fontWeight: 500, cursor: "text",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}
                              title="Tap to edit"
                            >
                              {task.title}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                            {task.importance === "critical" && (
                              <span className="tag" style={{ background: COLORS.dangerDim, color: COLORS.danger }}>critical</span>
                            )}
                            {task.importance === "high" && (
                              <span className="tag" style={{ background: COLORS.warningDim, color: COLORS.warning }}>high</span>
                            )}
                            <span className="tag" style={{ background: COLORS.border, color: COLORS.textMuted }}>{task.effort}</span>
                            {task.deadline && (
                              <span className="tag" style={{
                                background: daysUntil(task.deadline) <= 1 ? COLORS.dangerDim : COLORS.accentDim,
                                color: daysUntil(task.deadline) <= 1 ? COLORS.danger : COLORS.accent,
                              }}>
                                {relativeDeadline(task.deadline)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="score-badge" style={{ background: scoreBg, color: scoreColor }}>
                          {score}
                        </span>
                        <button onClick={() => openMetaEditor(task)} style={{ padding: "6px 8px", opacity: 0.5, flexShrink: 0 }} title="Edit task">
                          <Icons.edit size={13} />
                        </button>
                        <button onClick={() => { setSnoozeTask(task); setPendingSnooze(""); }} style={{ padding: "6px 8px", opacity: 0.5, flexShrink: 0 }} title="Not today">
                          <Icons.clock size={13} />
                        </button>
                        <button
                          onClick={() => addToTop5(task)}
                          className="btn-primary"
                          style={{ fontSize: 10, padding: "6px 12px", flexShrink: 0 }}
                        >
                          + Today
                        </button>
                      </div>
                    );
                  })
                  );
                })()}

                {/* Snoozed tasks */}
                {snoozedTasks.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <button
                      onClick={() => setShowSnoozed(s => !s)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "10px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                        color: COLORS.textMuted, marginBottom: showSnoozed ? 8 : 0,
                        transition: "margin-bottom 0.15s ease",
                      }}
                    >
                      <Icons.clock size={14} />
                      Snoozed ({snoozedTasks.length})
                      <Icons.chevronRight size={14} style={{ marginLeft: "auto", transform: showSnoozed ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }} />
                    </button>
                    {showSnoozed && snoozedTasks.map((task, i) => (
                      <div key={task.id} className="task-row focus-card" style={{ animationDelay: `${i * 30}ms`, opacity: 0.65 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {task.title}
                          </div>
                          <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                            <Icons.clock size={10} color={COLORS.textDim} />
                            Wakes {relativeDeadline(task.snoozedUntil)}
                          </div>
                        </div>
                        <button
                          onClick={() => clearSnooze(task)}
                          style={{ padding: "6px 10px", borderRadius: 8, background: COLORS.surface, border: `1px solid ${COLORS.border}`, fontSize: 10, fontWeight: 500, flexShrink: 0 }}
                        >
                          Wake now
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Someday tab */}
            {backlogTab === "someday" && (
              <>
                {somedayTasks.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 20px", color: COLORS.textDim }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: COLORS.textMuted, marginBottom: 8 }}>
                      Nothing here yet
                    </div>
                    <div style={{ fontSize: 12 }}>
                      Tasks marked "Someday" during processing will appear here
                    </div>
                  </div>
                ) : (
                  somedayTasks.map((task, i) => (
                    <div key={task.id} className="task-row focus-card" style={{ animationDelay: `${i * 30}ms` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{task.title}</div>
                        <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 4 }}>
                          Added {formatDate(task.createdAt?.slice(0, 10))}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => { saveTask({ ...task, status: "inbox" }); showToast("Moved to inbox"); }}
                          style={{ padding: "6px 10px", borderRadius: 8, background: COLORS.surface, border: `1px solid ${COLORS.border}`, fontSize: 10, fontWeight: 500 }}
                        >
                          Reactivate
                        </button>
                        <button onClick={() => removeTask(task.id)} style={{ padding: 4, opacity: 0.4 }}>
                          <Icons.trash size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}

        {/* ==================== MORNING NUDGE ==================== */}
        {screen === "morning" && (
          <div className="focus-fade">
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              marginBottom: 24,
            }}>
              <button onClick={() => {
                autoFillRef.current[`work:${todayStr()}`] = false;
                autoFillRef.current[`personal:${todayStr()}`] = false;
                setScreen("day");
              }} style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.textMuted, fontSize: 12 }}>
                <Icons.chevronLeft size={16} /> Day View
              </button>
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
              Good morning
            </div>
            <div style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 24 }}>
              {yesterdayIncomplete.length} unfinished task{yesterdayIncomplete.length !== 1 ? "s" : ""} from yesterday. Keep returns it to your pipeline so today auto-fills fresh.
            </div>

            {yesterdayIncomplete.map((task, i) => (
              <div key={task.id} className="focus-card" style={{
                background: COLORS.surface, borderRadius: 12, padding: 16,
                border: `1px solid ${COLORS.border}`, marginBottom: 12,
                animationDelay: `${i * 60}ms`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
                  {task.title}
                </div>
                <div style={{
                  display: "flex", gap: 8,
                  borderTop: `1px solid ${COLORS.border}`, paddingTop: 12,
                }}>
                  <button
                    onClick={() => { keepTask(task); showToast("Returned to pipeline"); }}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 600,
                      background: COLORS.accentDim, color: COLORS.accent,
                      border: `1px solid ${COLORS.accent}33`,
                    }}
                  >
                    Keep
                  </button>
                  <button
                    onClick={() => { dropTask(task); showToast("Discarded"); }}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 600,
                      background: COLORS.dangerDim, color: COLORS.danger,
                      border: `1px solid ${COLORS.danger}33`,
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}

            {yesterdayIncomplete.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px 20px", color: COLORS.textMuted }}>
                All caught up! Go to your day view.
                <div style={{ marginTop: 16 }}>
                  <button className="btn-primary" onClick={() => setScreen("day")}>
                    Start your day
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== SETTINGS ==================== */}
        {screen === "settings" && (
          <div className="focus-fade">
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, marginBottom: 24 }}>
              Settings
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={exportData}
                className="task-row"
                style={{ cursor: "pointer" }}
              >
                <Icons.download size={18} color={COLORS.accent} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Export data</div>
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>Download all tasks as JSON</div>
                </div>
                <Icons.chevronRight size={16} color={COLORS.textDim} />
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="task-row"
                style={{ cursor: "pointer" }}
              >
                <Icons.upload size={18} color={COLORS.accent} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Import data</div>
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>Restore from a backup file</div>
                </div>
                <Icons.chevronRight size={16} color={COLORS.textDim} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={importData}
              />

              <div style={{
                marginTop: 24, padding: "16px", borderRadius: 10,
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Stats</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: FONT_DISPLAY }}>{tasks.filter(t => t.status === "done").length}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim }}>Completed</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: FONT_DISPLAY }}>{inboxTasks.length}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim }}>In inbox</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: FONT_DISPLAY }}>{tasks.filter(t => t.status === "backlog").length}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim }}>In pipeline</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: FONT_DISPLAY }}>{somedayTasks.length}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim }}>Someday</div>
                  </div>
                </div>
              </div>

              {/* Install prompt */}
              {showInstallBanner && installPrompt && (
                <button
                  onClick={() => {
                    installPrompt.prompt();
                    installPrompt.userChoice.then(() => {
                      setInstallPrompt(null);
                      setShowInstallBanner(false);
                    });
                  }}
                  style={{
                    marginTop: 12, width: "100%", padding: "14px 16px", borderRadius: 10,
                    background: COLORS.accentDim, border: `1px solid ${COLORS.accent}33`,
                    display: "flex", alignItems: "center", gap: 12,
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <Icons.download size={18} color={COLORS.accent} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.accent }}>Install FocusFlow</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Add to your home screen for the best experience</div>
                  </div>
                </button>
              )}

              {/* iOS install hint (beforeinstallprompt doesn't fire on iOS) */}
              {!installPrompt && /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches && (
                <div style={{
                  marginTop: 12, padding: "14px 16px", borderRadius: 10,
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Install on iOS</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted, lineHeight: 1.5 }}>
                    Tap the Share button in Safari, then "Add to Home Screen" to install FocusFlow as an app.
                  </div>
                </div>
              )}

              <div style={{
                marginTop: 24, textAlign: "center", color: COLORS.textDim, fontSize: 10,
              }}>
                FocusFlow v1.0 &middot; All data stored on this device
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== BOTTOM NAV ==================== */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 480,
      }}>
        <div style={{
          display: "flex", alignItems: "stretch",
          background: "rgba(19, 23, 28, 0.88)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: `1px solid ${COLORS.border}`,
          padding: "4px 0 env(safe-area-inset-bottom, 8px)",
        }}>
          <button className={`nav-item${screen === "day" ? " active" : ""}`} onClick={() => setScreen("day")}>
            <Icons.sun size={22} />
            <span>Today</span>
          </button>
          <button className={`nav-item${screen === "inbox" ? " active" : ""}`} onClick={() => setScreen("inbox")}>
            <Icons.inbox size={22} />
            <span>Inbox</span>
            {inboxTasks.length > 0 && <span className="badge">{inboxTasks.length}</span>}
          </button>
          <button
            onClick={() => setCaptureOpen(true)}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <div style={{
              width: 46, height: 46, borderRadius: 14,
              background: `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentBright} 100%)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 20px ${COLORS.accent}55`,
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}>
              <Icons.plus size={22} color="#000" />
            </div>
          </button>
          <button className={`nav-item${screen === "backlog" ? " active" : ""}`} onClick={() => setScreen("backlog")}>
            <Icons.list size={22} />
            <span>Pipeline</span>
          </button>
          <button className={`nav-item${screen === "settings" ? " active" : ""}`} onClick={() => setScreen("settings")}>
            <Icons.settings size={22} />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* ==================== CAPTURE SHEET ==================== */}
      {captureOpen && (
        <div
          className="overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setCaptureOpen(false); }}
          style={{ paddingBottom: keyboardOffset, transition: "padding-bottom 0.15s ease" }}
        >
          <div className="sheet">
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 16,
            }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600 }}>
                Quick capture
              </div>
              <button onClick={() => setCaptureOpen(false)} style={{ padding: 4 }}>
                <Icons.x size={18} color={COLORS.textDim} />
              </button>
            </div>
            <textarea
              ref={captureRef}
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCapture(); } }}
              placeholder="What's on your mind?"
              autoFocus
              rows={3}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: 10,
                background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                color: COLORS.text, fontSize: 14, fontFamily: FONT,
                resize: "none", outline: "none",
              }}
            />
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={handleCaptureToday}
                disabled={!captureText.trim()}
                style={{
                  padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  background: COLORS.accentDim, color: COLORS.accent,
                  border: `1px solid ${COLORS.accent}33`,
                  opacity: captureText.trim() ? 1 : 0.4,
                  transition: "all 0.15s ease",
                }}
              >
                + Today
              </button>
              <button
                className="btn-primary"
                onClick={handleCapture}
                disabled={!captureText.trim()}
                style={{ opacity: captureText.trim() ? 1 : 0.4 }}
              >
                Inbox
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 10, color: COLORS.textDim, textAlign: "center" }}>
              Press Enter to save. Categorize later.
            </div>
          </div>
        </div>
      )}

      {/* ==================== SWAP SHEET ==================== */}
      {swapTask && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setSwapTask(null); }}>
          <div className="sheet">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Icons.swap size={18} color={COLORS.accent} />
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600 }}>
                Top 5 is full
              </div>
            </div>
            <div style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 20 }}>
              Pick a task to replace with "{swapTask.title}"
            </div>
            {top5Tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => handleSwap(task)}
                className="task-row"
                style={{ cursor: "pointer", width: "100%" }}
              >
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{task.title}</div>
                </div>
                <span style={{ fontSize: 10, color: COLORS.danger }}>Replace</span>
              </button>
            ))}
            <button
              onClick={() => setSwapTask(null)}
              style={{
                width: "100%", padding: "12px", borderRadius: 10, marginTop: 8,
                fontSize: 12, color: COLORS.textMuted,
                border: `1px solid ${COLORS.border}`, textAlign: "center",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ==================== SNOOZE SHEET ==================== */}
      {snoozeTask && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) { setSnoozeTask(null); setPendingSnooze(""); } }}>
          <div className="sheet">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600 }}>Not today</div>
              <button onClick={() => { setSnoozeTask(null); setPendingSnooze(""); }} style={{ padding: 4 }}>
                <Icons.x size={18} color={COLORS.textDim} />
              </button>
            </div>
            <div style={{
              fontSize: 13, fontWeight: 500, color: COLORS.textMuted,
              marginBottom: 20, padding: "12px 14px", borderRadius: 10,
              background: COLORS.bg, border: `1px solid ${COLORS.border}`,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {snoozeTask.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {[
                ["Tomorrow", tomorrowStr()],
                ["This weekend", nextWeekday(6)],
                ["Next week", nextWeekday(1)],
              ].map(([label, date]) => (
                <button key={label} className="btn-choice" onClick={() => applySnooze(date)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{label}</span>
                  <span style={{ color: COLORS.textDim, fontSize: 11, fontFamily: FONT }}>{formatDate(date)}</span>
                </button>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 8 }}>PICK A DATE</div>
              <input
                type="date"
                value={pendingSnooze}
                onChange={(e) => setPendingSnooze(e.target.value)}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                  color: COLORS.text, fontSize: 13, fontFamily: FONT,
                }}
              />
              <button
                className="btn-primary"
                disabled={!pendingSnooze}
                onClick={() => applySnooze(pendingSnooze)}
                style={{ marginTop: 10, width: "100%", opacity: pendingSnooze ? 1 : 0.4 }}
              >
                Snooze until this date
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== META EDITOR SHEET ==================== */}
      {metaTask && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setMetaTask(null); }}>
          <div className="sheet">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600 }}>Edit task</div>
              <button onClick={() => setMetaTask(null)} style={{ padding: 4 }}>
                <Icons.x size={18} color={COLORS.textDim} />
              </button>
            </div>
            <div style={{
              fontSize: 13, fontWeight: 500, color: COLORS.textMuted,
              marginBottom: 20, padding: "12px 14px", borderRadius: 10,
              background: COLORS.bg, border: `1px solid ${COLORS.border}`,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {metaTask.title}
            </div>

            {/* Context */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 8 }}>CONTEXT</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["work", "Work", COLORS.work], ["personal", "Personal", COLORS.personal]].map(([v, label, color]) => (
                  <button key={v} onClick={() => setPendingMeta(m => ({ ...m, context: v }))} style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: pendingMeta.context === v ? COLORS.accentDim : COLORS.surface,
                    border: `1px solid ${pendingMeta.context === v ? `${COLORS.accent}55` : COLORS.border}`,
                    color: pendingMeta.context === v ? color : COLORS.textMuted,
                    transition: "all 0.15s ease",
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Importance */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 8 }}>IMPORTANCE</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["critical", COLORS.danger], ["high", COLORS.warning], ["normal", COLORS.textMuted]].map(([v, color]) => (
                  <button key={v} onClick={() => setPendingMeta(m => ({ ...m, importance: v }))} style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: pendingMeta.importance === v ? COLORS.accentDim : COLORS.surface,
                    border: `1px solid ${pendingMeta.importance === v ? `${COLORS.accent}55` : COLORS.border}`,
                    color: pendingMeta.importance === v ? color : COLORS.textMuted,
                    transition: "all 0.15s ease",
                  }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Effort */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 8 }}>EFFORT</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["small", "medium", "large"].map(v => (
                  <button key={v} onClick={() => setPendingMeta(m => ({ ...m, effort: v }))} style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: pendingMeta.effort === v ? COLORS.accentDim : COLORS.surface,
                    border: `1px solid ${pendingMeta.effort === v ? `${COLORS.accent}55` : COLORS.border}`,
                    color: pendingMeta.effort === v ? COLORS.accent : COLORS.textMuted,
                    transition: "all 0.15s ease",
                  }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Deadline */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: "0.8px", marginBottom: 8 }}>DUE DATE</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={pendingMeta.deadline || ""}
                  onChange={(e) => setPendingMeta(m => ({ ...m, deadline: e.target.value }))}
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 10,
                    background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                    color: COLORS.text, fontSize: 13, fontFamily: FONT,
                  }}
                />
                {pendingMeta.deadline && (
                  <button
                    onClick={() => setPendingMeta(m => ({ ...m, deadline: "" }))}
                    style={{ padding: "10px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                      background: COLORS.dangerDim, color: COLORS.danger,
                      border: `1px solid ${COLORS.danger}33` }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <button className="btn-primary" onClick={saveMetaEdit} style={{ width: "100%" }}>
              Save changes
            </button>
          </div>
        </div>
      )}

      {/* ==================== TOAST ==================== */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          padding: "10px 20px", borderRadius: 10, fontSize: 12,
          fontWeight: 600, zIndex: 200, animation: "slideUp 0.2s ease-out",
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
