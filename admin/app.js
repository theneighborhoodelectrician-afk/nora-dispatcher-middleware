const secretInput = document.getElementById("admin-secret");
const saveSecretButton = document.getElementById("save-secret");
const secretStatus = document.getElementById("secret-status");
const navButtons = Array.from(document.querySelectorAll(".nav-link"));
const views = Array.from(document.querySelectorAll(".view"));
const conversationList = document.getElementById("conversation-list");
const conversationDetail = document.getElementById("conversation-detail");
const detailId = document.getElementById("detail-id");
const refreshConversationsButton = document.getElementById("refresh-conversations");
const conversationLimitInput = document.getElementById("conversation-limit");
const configEditor = document.getElementById("config-editor");
const configStatus = document.getElementById("config-status");
const loadConfigButton = document.getElementById("load-config");
const saveConfigButton = document.getElementById("save-config");

const SECRET_STORAGE_KEY = "booksmart_admin_secret";

boot();

function boot() {
  secretInput.value = sessionStorage.getItem(SECRET_STORAGE_KEY) ?? "";
  bindEvents();
  loadConversations().catch(showConversationError);
  loadConfig().catch(showConfigError);
}

function bindEvents() {
  saveSecretButton.addEventListener("click", () => {
    sessionStorage.setItem(SECRET_STORAGE_KEY, secretInput.value.trim());
    secretStatus.textContent = "Admin secret saved for this tab.";
  });

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      navButtons.forEach((item) => item.classList.toggle("active", item === button));
      views.forEach((view) => view.classList.toggle("active", view.id === `view-${button.dataset.view}`));
    });
  });

  refreshConversationsButton.addEventListener("click", () => {
    loadConversations().catch(showConversationError);
  });

  conversationLimitInput.addEventListener("change", () => {
    loadConversations().catch(showConversationError);
  });

  loadConfigButton.addEventListener("click", () => {
    loadConfig().catch(showConfigError);
  });

  saveConfigButton.addEventListener("click", () => {
    saveConfig().catch(showConfigError);
  });
}

async function loadConversations() {
  conversationList.innerHTML = '<div class="detail-empty">Loading conversations…</div>';
  const limit = Number(conversationLimitInput.value) || 25;
  const response = await adminFetch(`/api/admin/conversations?limit=${limit}`);
  const payload = await response.json();
  const outcomes = payload.outcomes ?? [];

  if (!outcomes.length) {
    conversationList.innerHTML = '<div class="detail-empty">No conversations tracked yet.</div>';
    return;
  }

  conversationList.innerHTML = "";
  outcomes.forEach((outcome) => {
    const wrapper = document.createElement("article");
    wrapper.className = "list-item";

    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(outcome.conversationId)}</strong>
      <div class="badge-row">
        <span class="badge">${escapeHtml(outcome.leadSource)}</span>
        <span class="badge">${escapeHtml(outcome.finalBookingStatus ?? "in_progress")}</span>
      </div>
      <p>${escapeHtml(outcome.classifiedServiceType ?? outcome.firstCustomerMessage)}</p>
      <div class="list-meta">
        <span>Booked: ${outcome.bookedYesNo ? "yes" : "no"}</span>
        <span>Handoff: ${outcome.handoffYesNo ? "yes" : "no"}</span>
        <span>Slots: ${outcome.slotsShownCount}</span>
      </div>
    `;
    button.addEventListener("click", () => {
      loadConversationDetail(outcome.conversationId).catch(showConversationError);
    });

    wrapper.appendChild(button);
    conversationList.appendChild(wrapper);
  });
}

async function loadConversationDetail(conversationId) {
  detailId.textContent = conversationId;
  conversationDetail.innerHTML = '<div class="detail-empty">Loading conversation detail…</div>';
  const response = await adminFetch(`/api/admin/conversations?conversationId=${encodeURIComponent(conversationId)}`);
  const payload = await response.json();

  const stages = payload.stages ?? [];
  const messages = payload.messages ?? [];
  const slots = payload.slots ?? [];
  const urgencyHits = payload.urgencyHits ?? [];
  const bookingEvents = payload.bookingEvents ?? [];
  const handoffEvents = payload.handoffEvents ?? [];
  const outcome = payload.outcome ?? {};

  conversationDetail.innerHTML = `
    <div class="detail-grid">
      ${renderBlock("Outcome", [
        `Lead source: ${escapeHtml(outcome.leadSource ?? "unknown")}`,
        `Service type: ${escapeHtml(outcome.classifiedServiceType ?? "n/a")}`,
        `Booking status: ${escapeHtml(outcome.finalBookingStatus ?? "n/a")}`,
        `HCP job type: ${escapeHtml(outcome.finalHcpJobType ?? "n/a")}`,
        `Booked: ${outcome.bookedYesNo ? "yes" : "no"}`,
        `Handoff: ${outcome.handoffYesNo ? "yes" : "no"}`,
      ])}
      ${renderBlock("Stages", stages.map((stage) => `${stage.stage} · ${formatTime(stage.timestamp)}`))}
      ${renderBlock("Transcript", messages.map((message) => `${message.direction}${message.toolName ? `:${message.toolName}` : ""} · ${message.text ?? message.toolCallSummary ?? ""}`))}
      ${renderBlock("Slot Exposure", slots.map((slot) => `${slot.slotOrderPresented}. ${slot.slotLabel} ${slot.selectedYesNo ? "(selected)" : ""}`))}
      ${renderBlock("Urgency Hits", urgencyHits.length ? urgencyHits.map((hit) => `${hit.keywordDetected} · ${hit.mappedUrgencyLevel}`) : ["None"])}
      ${renderBlock("Booking Events", bookingEvents.length ? bookingEvents.map((event) => `${event.bookingStatus} · ${event.bookingExternalId ?? "no external id"}`) : ["None"])}
      ${renderBlock("Handoff Events", handoffEvents.length ? handoffEvents.map((event) => `${event.reason} · ${formatTime(event.timestamp)}`) : ["None"])}
      ${renderBlock("Summary", [outcome.systemSummary ?? "No internal summary yet."])}
    </div>
  `;
}

async function loadConfig() {
  configStatus.textContent = "Loading config…";
  const response = await adminFetch("/api/admin/booksmart-config");
  const payload = await response.json();
  configEditor.value = JSON.stringify(payload.config, null, 2);
  configStatus.textContent = "Config loaded.";
}

async function saveConfig() {
  configStatus.textContent = "Saving config…";
  const parsed = JSON.parse(configEditor.value);
  const response = await adminFetch("/api/admin/booksmart-config", {
    method: "PUT",
    body: JSON.stringify(parsed),
  });
  const payload = await response.json();
  configEditor.value = JSON.stringify(payload.config, null, 2);
  configStatus.textContent = "Config saved.";
}

async function adminFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-secret": sessionStorage.getItem(SECRET_STORAGE_KEY) ?? "",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.message ?? message;
    } catch {
      // Ignore parse failure and keep fallback message.
    }
    throw new Error(message);
  }

  return response;
}

function renderBlock(title, items) {
  return `
    <section class="detail-block">
      <h4>${escapeHtml(title)}</h4>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function showConversationError(error) {
  conversationList.innerHTML = `<div class="detail-empty">${escapeHtml(error.message)}</div>`;
}

function showConfigError(error) {
  configStatus.textContent = error.message;
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "unknown";
  }

  return new Date(timestamp).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
