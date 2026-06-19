/**
 * Main Application — HeartbeatSDK Lifeguard Dashboard
 *
 * Orchestrates:
 * - Firebase initialization and real-time Firestore listeners
 * - Session list rendering with live status updates
 * - Map integration (device + station markers)
 * - Alert management
 * - Stats bar updates
 * - Clock display
 */

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
} from "firebase/firestore";

import { initMap, updateDeviceMarkers, focusOnDevice, resizeMap } from "./map.js";
import { configureAlerts, updateAlerts } from "./alerts.js";

// ═══════════════════════════════════════════════════════════
//  Firebase Configuration
//  Replace with your actual Firebase project config
// ═══════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// ═══════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════

/** @type {Array<Object>} All active sessions */
let sessions = [];

/** @type {Array<Object>} All closed sessions for history */
let closedSessions = [];

/** @type {Array<Object>} All alerts */
let alerts = [];

// ═══════════════════════════════════════════════════════════
//  Initialization
// ═══════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  console.log("🏖️ HeartbeatSDK Portal — Initializing...");

  // Start the clock
  updateClock();
  setInterval(updateClock, 1000);

  // Initialize the map
  initMap();

  // Try Firebase connection, fall back to demo mode
  try {
    if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
      initFirebase();
    } else {
      console.log("⚠️ Firebase not configured. Running in DEMO mode.");
      initDemoMode();
    }
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    initDemoMode();
  }

  // Handle window resize
  window.addEventListener("resize", () => {
    resizeMap();
  });

  // History Modal Event Listeners
  const btnShowHistory = document.getElementById("btn-show-history");
  const btnCloseHistory = document.getElementById("btn-close-history");
  const historyOverlay = document.getElementById("history-overlay");

  if (btnShowHistory && historyOverlay) {
    btnShowHistory.addEventListener("click", () => {
      renderHistoryTable();
      historyOverlay.classList.add("active");
    });
  }

  if (btnCloseHistory && historyOverlay) {
    btnCloseHistory.addEventListener("click", () => {
      historyOverlay.classList.remove("active");
    });
  }
});

// ═══════════════════════════════════════════════════════════
//  Firebase Real-Time Listeners
// ═══════════════════════════════════════════════════════════

function initFirebase() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  configureAlerts(firebaseConfig.projectId);
  setConnectionStatus(true);

  // Listen to deviceSessions collection
  const sessionsQuery = query(
    collection(db, "deviceSessions"),
    where("current_status", "!=", "closed")
  );

  onSnapshot(
    sessionsQuery,
    (snapshot) => {
      sessions = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      renderSessions(sessions);
      updateDeviceMarkers(sessions);
      updateStats();
    },
    (error) => {
      console.error("Sessions listener error:", error);
      setConnectionStatus(false);
    }
  );

  // Listen to alerts collection
  const alertsQuery = query(
    collection(db, "alerts"),
    orderBy("triggered_at", "desc")
  );

  onSnapshot(
    alertsQuery,
    (snapshot) => {
      alerts = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      updateAlerts(alerts);
      updateStats();
    },
    (error) => {
      console.error("Alerts listener error:", error);
    }
  );
}

// ═══════════════════════════════════════════════════════════
//  Session Rendering
// ═══════════════════════════════════════════════════════════

function renderSessions(sessionList) {
  const container = document.getElementById("sessions-list");
  const countBadge = document.getElementById("sessions-count");

  if (!container) return;
  if (countBadge) countBadge.textContent = sessionList.length;

  if (sessionList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📡</div>
        <div class="empty-state__text">No active sessions<br/>Waiting for devices...</div>
      </div>
    `;
    return;
  }

  // Sort: emergency first, then warning, then normal
  const statusOrder = { emergency: 0, warning: 1, normal: 2 };
  const sorted = [...sessionList].sort(
    (a, b) =>
      (statusOrder[a.current_status] ?? 3) -
      (statusOrder[b.current_status] ?? 3)
  );

  container.innerHTML = sorted.map((s) => renderSessionCard(s)).join("");

  // Attach click handlers to focus on map
  container.querySelectorAll("[data-session-device]").forEach((card) => {
    card.addEventListener("click", () => {
      focusOnDevice(card.dataset.sessionDevice);
    });
  });
}

function renderSessionCard(session) {
  const status = session.current_status || "normal";
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const statusEmoji = { normal: "🟢", warning: "🟡", emergency: "🔴" };
  const duration = formatDuration(Date.now() - (session.session_start || Date.now()));

  const startTime = session.session_start ? new Date(session.session_start).toLocaleTimeString("en-US", {hour: "2-digit", minute: "2-digit"}) : "Unknown";
  const lastHeartbeat = session.last_heartbeat_timestamp ? new Date(session.last_heartbeat_timestamp).toLocaleTimeString("en-US", {hour: "2-digit", minute: "2-digit", second: "2-digit"}) : "Unknown";

  return `
    <div class="session-card session-card--${status}"
         data-session-device="${session.device_id}">
      <div class="session-card__top">
        <span class="session-card__device">${session.device_id}</span>
        <span class="session-card__status session-card__status--${status}">
          ${statusEmoji[status] || "⚪"} ${statusLabel}
        </span>
      </div>
      <div class="session-card__user">
        👤 ${session.user_id || "Unknown"}
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
          📱 App: ${session.app_id || "Unknown App"}
        </div>
      </div>
      <div class="session-card__meta" style="flex-wrap: wrap; gap: 8px;">
        <span>🏊 ${session.activity_type || "Unknown"}</span>
        <span>🔋 ${session.battery_level >= 0 ? Math.round(session.battery_level) + "%" : "N/A"}</span>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
        <div style="margin-bottom: 2px;">⏱️ <strong>Duration:</strong> ${duration}</div>
        <div style="margin-bottom: 2px;">🟢 <strong>Started:</strong> ${startTime}</div>
        <div>📡 <strong>Last Ping:</strong> ${lastHeartbeat}</div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
//  History Rendering
// ═══════════════════════════════════════════════════════════

function renderHistoryTable() {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) return;

  if (closedSessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 32px;">No connection history available.</td></tr>`;
    return;
  }

  const sorted = [...closedSessions].sort((a, b) => (b.session_start || 0) - (a.session_start || 0));

  tbody.innerHTML = sorted.map((s) => {
    const startStr = s.session_start ? new Date(s.session_start).toLocaleString("en-US", {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"}) : "Unknown";
    const endStr = s.session_closed_at ? new Date(s.session_closed_at).toLocaleString("en-US", {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"}) : "Unknown";

    return `
      <tr>
        <td class="hl-cyan">${s.device_id || "Unknown"}</td>
        <td>${s.app_id || "Unknown App"}</td>
        <td style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">${s.session_id}</td>
        <td>${startStr}</td>
        <td>${endStr}</td>
      </tr>
    `;
  }).join("");
}

// ═══════════════════════════════════════════════════════════
//  Stats Bar
// ═══════════════════════════════════════════════════════════

function updateStats() {
  // Active sessions
  const sessionsValue = document.getElementById("stat-sessions-value");
  if (sessionsValue) sessionsValue.textContent = sessions.length;

  // Emergency count
  const emergencyCount = sessions.filter(
    (s) => s.current_status === "emergency"
  ).length;
  const emergenciesValue = document.getElementById("stat-emergencies-value");
  if (emergenciesValue) emergenciesValue.textContent = emergencyCount;

  // Warning count
  const warningCount = sessions.filter(
    (s) => s.current_status === "warning"
  ).length;
  const warningsValue = document.getElementById("stat-warnings-value");
  if (warningsValue) warningsValue.textContent = warningCount;

  // Average battery
  const batteryLevels = sessions
    .filter((s) => s.battery_level >= 0)
    .map((s) => s.battery_level);
  const avgBattery =
    batteryLevels.length > 0
      ? Math.round(
          batteryLevels.reduce((a, b) => a + b, 0) / batteryLevels.length
        )
      : "--";
  const batteryValue = document.getElementById("stat-battery-value");
  if (batteryValue) batteryValue.textContent = `${avgBattery}%`;
}

// ═══════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════

function updateClock() {
  const el = document.getElementById("header-time");
  if (el) {
    el.textContent = new Date().toLocaleTimeString("en-IL", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
}

function setConnectionStatus(isConnected) {
  const indicator = document.getElementById("connection-dot");
  const text = document.getElementById("connection-text");

  if (indicator && text) {
    if (isConnected) {
      indicator.className = "connection-dot";
      text.textContent = "Live — Firebase Connected";
    } else {
      indicator.className = "connection-dot offline";
      text.textContent = "Disconnected / Error";
    }
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
