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
const conversationOpeningQuestionInput = document.getElementById("conversation-opening-question");
const conversationAfterHoursSelect = document.getElementById("conversation-after-hours");
const conversationHandoffMessageInput = document.getElementById("conversation-handoff-message");
const conversationRequestPhotosContainer = document.getElementById("conversation-request-photos");
const allowedCitiesInput = document.getElementById("service-areas-allowed");
const restrictedCitiesInput = document.getElementById("service-areas-restricted");
const serviceAreaBehaviorSelect = document.getElementById("service-areas-behavior");
const urgencyKeywordsList = document.getElementById("urgency-keywords-list");
const addUrgencyKeywordButton = document.getElementById("add-urgency-keyword");
const serviceTypeList = document.getElementById("service-type-list");
const serviceTypeEditor = document.getElementById("service-type-editor");
const addServiceTypeButton = document.getElementById("add-service-type");

const SECRET_STORAGE_KEY = "booksmart_admin_secret";
const PHOTO_CATEGORIES = [
  { value: "service_call", label: "Service calls" },
  { value: "estimate", label: "Estimates" },
  { value: "urgent", label: "Urgent jobs" },
];
const SERVICE_TYPE_CATEGORIES = [
  { value: "service_call", label: "Service call" },
  { value: "estimate", label: "Estimate" },
  { value: "urgent", label: "Urgent" },
];
const SKILL_TAGS = [
  "service_calls",
  "troubleshooting",
  "panel_work",
  "ev_chargers",
  "lighting",
  "remodel_estimates",
  "generators",
  "smart_home",
];

let currentConfig = null;
let selectedServiceTypeId = null;

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

  addUrgencyKeywordButton.addEventListener("click", () => {
    ensureCurrentConfig();
    currentConfig.urgencyKeywords.push({
      phrase: "",
      level: "urgent",
    });
    syncConfigToEditorAndForms();
  });

  addServiceTypeButton.addEventListener("click", () => {
    ensureCurrentConfig();
    const source = currentConfig.serviceTypes.find((item) => item.id === selectedServiceTypeId) ?? currentConfig.serviceTypes[0];
    if (!source) {
      return;
    }

    const duplicate = {
      ...source,
      displayName: `${source.displayName} Copy`,
      classifierPhrases: [...source.classifierPhrases],
      requiredSkills: [...source.requiredSkills],
      requestedServiceLabel: `${source.requestedServiceLabel} Copy`,
    };
    currentConfig.serviceTypes.push(duplicate);
    selectedServiceTypeId = duplicate.id;
    syncConfigToEditorAndForms();
    configStatus.textContent = "Duplicated selected service type locally. Update the ID before saving.";
  });

  configEditor.addEventListener("change", () => {
    try {
      currentConfig = JSON.parse(configEditor.value);
      populateConfigForms(currentConfig);
      configStatus.textContent = "Config JSON updated locally.";
    } catch {
      configStatus.textContent = "Config JSON is invalid.";
    }
  });

  [
    conversationOpeningQuestionInput,
    conversationAfterHoursSelect,
    conversationHandoffMessageInput,
    allowedCitiesInput,
    restrictedCitiesInput,
    serviceAreaBehaviorSelect,
  ].forEach((element) => {
    element.addEventListener("input", updateConfigFromForms);
    element.addEventListener("change", updateConfigFromForms);
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
  currentConfig = payload.config;
  syncConfigToEditorAndForms();
  configStatus.textContent = "Config loaded.";
}

async function saveConfig() {
  ensureCurrentConfig();
  updateConfigFromForms();
  configStatus.textContent = "Saving config…";
  const response = await adminFetch("/api/admin/booksmart-config", {
    method: "PUT",
    body: JSON.stringify(currentConfig),
  });
  const payload = await response.json();
  currentConfig = payload.config;
  syncConfigToEditorAndForms();
  configStatus.textContent = "Config saved.";
}

function updateConfigFromForms() {
  ensureCurrentConfig();
  currentConfig.conversation.openingQuestion = conversationOpeningQuestionInput.value;
  currentConfig.conversation.afterHoursBehavior = conversationAfterHoursSelect.value;
  currentConfig.conversation.handoffMessage = conversationHandoffMessageInput.value;
  currentConfig.conversation.requestPhotosFor = Array.from(
    conversationRequestPhotosContainer.querySelectorAll('input[type="checkbox"]:checked'),
  ).map((input) => input.value);
  currentConfig.serviceAreas.allowedCities = textAreaToLines(allowedCitiesInput.value);
  currentConfig.serviceAreas.restrictedCities = textAreaToLines(restrictedCitiesInput.value);
  currentConfig.serviceAreas.outsideAreaBehavior = serviceAreaBehaviorSelect.value;
  currentConfig.urgencyKeywords = Array.from(urgencyKeywordsList.querySelectorAll(".stack-row")).map((row) => ({
    phrase: row.querySelector('[data-role="phrase"]').value,
    level: row.querySelector('[data-role="level"]').value,
  })).filter((keyword) => keyword.phrase.trim().length > 0);
  currentConfig.serviceTypes = currentConfig.serviceTypes.map((serviceType) => {
    if (serviceType.id !== selectedServiceTypeId) {
      return serviceType;
    }

    const editor = serviceTypeEditor;
    return {
      ...serviceType,
      id: editor.querySelector('[data-role="id"]').value,
      displayName: editor.querySelector('[data-role="displayName"]').value,
      category: editor.querySelector('[data-role="category"]').value,
      photoRequest: editor.querySelector('[data-role="photoRequest"]').value,
      priorityLevel: Number(editor.querySelector('[data-role="priorityLevel"]').value) || 0,
      requestedServiceLabel: editor.querySelector('[data-role="requestedServiceLabel"]').value,
      classifierPhrases: textAreaToCommaLines(editor.querySelector('[data-role="classifierPhrases"]').value),
      requiredSkills: Array.from(editor.querySelectorAll('[data-role="requiredSkills"] input:checked')).map((input) => input.value),
    };
  });
  configEditor.value = JSON.stringify(currentConfig, null, 2);
  configStatus.textContent = "Unsaved changes in forms.";
}

function populateConfigForms(config) {
  conversationOpeningQuestionInput.value = config.conversation.openingQuestion ?? "";
  conversationAfterHoursSelect.value = config.conversation.afterHoursBehavior ?? "continue";
  conversationHandoffMessageInput.value = config.conversation.handoffMessage ?? "";
  allowedCitiesInput.value = (config.serviceAreas.allowedCities ?? []).join("\n");
  restrictedCitiesInput.value = (config.serviceAreas.restrictedCities ?? []).join("\n");
  serviceAreaBehaviorSelect.value = config.serviceAreas.outsideAreaBehavior ?? "handoff";

  renderRequestPhotoCheckboxes(config.conversation.requestPhotosFor ?? []);
  renderUrgencyKeywords(config.urgencyKeywords ?? []);
  renderServiceTypes(config.serviceTypes ?? []);
}

function syncConfigToEditorAndForms() {
  configEditor.value = JSON.stringify(currentConfig, null, 2);
  populateConfigForms(currentConfig);
}

function renderServiceTypes(serviceTypes) {
  serviceTypeList.innerHTML = "";
  if (!serviceTypes.length) {
    serviceTypeList.innerHTML = '<div class="detail-empty">No service types configured.</div>';
    serviceTypeEditor.innerHTML = '<div class="detail-empty">No service type selected.</div>';
    return;
  }

  if (!selectedServiceTypeId || !serviceTypes.some((serviceType) => serviceType.id === selectedServiceTypeId)) {
    selectedServiceTypeId = serviceTypes[0].id;
  }

  serviceTypes.forEach((serviceType) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `service-type-item ${serviceType.id === selectedServiceTypeId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(serviceType.displayName)}</strong>
      <div class="badge-row">
        <span class="badge">${escapeHtml(serviceType.category)}</span>
        <span class="badge">P${escapeHtml(String(serviceType.priorityLevel))}</span>
      </div>
      <p>${escapeHtml(serviceType.id)}</p>
    `;
    button.addEventListener("click", () => {
      selectedServiceTypeId = serviceType.id;
      renderServiceTypes(currentConfig.serviceTypes);
    });
    serviceTypeList.appendChild(button);
  });

  const selected = serviceTypes.find((serviceType) => serviceType.id === selectedServiceTypeId) ?? serviceTypes[0];
  serviceTypeEditor.innerHTML = renderServiceTypeEditor(selected);
  bindServiceTypeEditor();
}

function renderServiceTypeEditor(serviceType) {
  return `
    <div class="service-type-form">
      <label class="field">
        <span>Service type ID</span>
        <input data-role="id" type="text" value="${escapeHtml(serviceType.id)}" />
      </label>
      <label class="field">
        <span>Display name</span>
        <input data-role="displayName" type="text" value="${escapeHtml(serviceType.displayName)}" />
      </label>
      <label class="field">
        <span>Category</span>
        <select data-role="category">
          ${SERVICE_TYPE_CATEGORIES.map((option) => `<option value="${escapeHtml(option.value)}" ${serviceType.category === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Photo request</span>
        <select data-role="photoRequest">
          <option value="never" ${serviceType.photoRequest === "never" ? "selected" : ""}>Never</option>
          <option value="recommended" ${serviceType.photoRequest === "recommended" ? "selected" : ""}>Recommended</option>
        </select>
      </label>
      <label class="field">
        <span>Priority level</span>
        <input data-role="priorityLevel" type="number" min="0" value="${escapeHtml(String(serviceType.priorityLevel))}" />
      </label>
      <label class="field">
        <span>Requested service label</span>
        <input data-role="requestedServiceLabel" type="text" value="${escapeHtml(serviceType.requestedServiceLabel)}" />
      </label>
      <label class="field field-wide">
        <span>Classifier phrases</span>
        <textarea data-role="classifierPhrases" rows="4" placeholder="Comma-separated phrases">${escapeHtml((serviceType.classifierPhrases ?? []).join(", "))}</textarea>
      </label>
      <fieldset class="field field-wide">
        <legend>Required skills</legend>
        <div class="chip-grid" data-role="requiredSkills">
          ${SKILL_TAGS.map((skill) => `
            <label class="chip">
              <input type="checkbox" value="${escapeHtml(skill)}" ${(serviceType.requiredSkills ?? []).includes(skill) ? "checked" : ""} />
              <span>${escapeHtml(skill)}</span>
            </label>
          `).join("")}
        </div>
      </fieldset>
    </div>
  `;
}

function bindServiceTypeEditor() {
  Array.from(serviceTypeEditor.querySelectorAll("input, textarea, select")).forEach((element) => {
    element.addEventListener("input", updateConfigFromForms);
    element.addEventListener("change", updateConfigFromForms);
  });
}

function renderRequestPhotoCheckboxes(selectedValues) {
  conversationRequestPhotosContainer.innerHTML = "";
  PHOTO_CATEGORIES.forEach((category) => {
    const label = document.createElement("label");
    label.className = "checkbox-item";
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(category.value)}" ${selectedValues.includes(category.value) ? "checked" : ""} />
      <span>${escapeHtml(category.label)}</span>
    `;
    label.querySelector("input").addEventListener("change", updateConfigFromForms);
    conversationRequestPhotosContainer.appendChild(label);
  });
}

function renderUrgencyKeywords(keywords) {
  urgencyKeywordsList.innerHTML = "";
  if (!keywords.length) {
    urgencyKeywordsList.innerHTML = '<div class="detail-empty">No urgency keywords configured.</div>';
    return;
  }

  keywords.forEach((keyword, index) => {
    const row = document.createElement("div");
    row.className = "stack-row";
    row.innerHTML = `
      <input data-role="phrase" type="text" placeholder="Keyword or phrase" value="${escapeHtml(keyword.phrase ?? "")}" />
      <select data-role="level">
        <option value="urgent" ${keyword.level === "urgent" ? "selected" : ""}>urgent</option>
      </select>
      <button type="button" data-role="remove">Remove</button>
    `;
    row.querySelector('[data-role="phrase"]').addEventListener("input", updateConfigFromForms);
    row.querySelector('[data-role="level"]').addEventListener("change", updateConfigFromForms);
    row.querySelector('[data-role="remove"]').addEventListener("click", () => {
      ensureCurrentConfig();
      currentConfig.urgencyKeywords.splice(index, 1);
      syncConfigToEditorAndForms();
      configStatus.textContent = "Unsaved urgency keyword changes.";
    });
    urgencyKeywordsList.appendChild(row);
  });
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

function textAreaToLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function textAreaToCommaLines(value) {
  return value
    .split(",")
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensureCurrentConfig() {
  if (!currentConfig) {
    currentConfig = {
      serviceTypes: [],
      serviceAreas: {
        allowedCities: [],
        restrictedCities: [],
        outsideAreaBehavior: "handoff",
      },
      urgencyKeywords: [],
      bookingRules: {
        sameDayAllowed: true,
        minimumNoticeHours: 2,
        allowedWindows: ["morning", "afternoon"],
      },
      conversation: {
        openingQuestion: "",
        afterHoursBehavior: "continue",
        requestPhotosFor: [],
        handoffMessage: "",
      },
    };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
