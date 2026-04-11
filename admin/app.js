const secretInput = document.getElementById("admin-secret");
const saveSecretButton = document.getElementById("save-secret");
const secretStatus = document.getElementById("secret-status");
const navButtons = Array.from(document.querySelectorAll(".nav-link"));
const views = Array.from(document.querySelectorAll(".view"));
const conversationList = document.getElementById("conversation-list");
const conversationDetail = document.getElementById("conversation-detail");
const detailId = document.getElementById("detail-id");
const copySummaryButton = document.getElementById("copy-summary");
const copyHandoffSummaryButton = document.getElementById("copy-handoff-summary");
const markReviewedButton = document.getElementById("mark-reviewed");
const copyTranscriptButton = document.getElementById("copy-transcript");
const openRelatedConfigButton = document.getElementById("open-related-config");
const conversationStats = document.getElementById("conversation-stats");
const refreshConversationsButton = document.getElementById("refresh-conversations");
const conversationLimitInput = document.getElementById("conversation-limit");
const conversationSearchInput = document.getElementById("conversation-search");
const conversationStatusFilter = document.getElementById("conversation-status-filter");
const conversationLeadFilter = document.getElementById("conversation-lead-filter");
const conversationSortSelect = document.getElementById("conversation-sort");
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
const bookingRulesSameDaySelect = document.getElementById("booking-rules-same-day");
const bookingRulesMinimumNoticeInput = document.getElementById("booking-rules-minimum-notice");
const bookingRulesWindowsContainer = document.getElementById("booking-rules-windows");
const urgencyKeywordsList = document.getElementById("urgency-keywords-list");
const addUrgencyKeywordButton = document.getElementById("add-urgency-keyword");
const serviceTypeList = document.getElementById("service-type-list");
const serviceTypeEditor = document.getElementById("service-type-editor");
const addServiceTypeButton = document.getElementById("add-service-type");

const SECRET_STORAGE_KEY = "booksmart_admin_secret";
const REVIEWED_STORAGE_KEY = "booksmart_reviewed_conversations";
const PHOTO_CATEGORIES = [
  { value: "service_call", label: "Service calls" },
  { value: "estimate", label: "Estimates" },
  { value: "urgent", label: "Urgent jobs" },
];
const BOOKING_WINDOWS = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
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
let currentOutcomes = [];
let currentConversationBundle = null;

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

  [conversationSearchInput, conversationStatusFilter, conversationLeadFilter, conversationSortSelect].forEach((element) => {
    element.addEventListener("input", renderConversationList);
    element.addEventListener("change", renderConversationList);
  });

  copySummaryButton.addEventListener("click", () => {
    copyConversationSummary().catch(showConversationError);
  });

  copyHandoffSummaryButton.addEventListener("click", () => {
    copyCurrentHandoffSummary().catch(showConversationError);
  });

  markReviewedButton.addEventListener("click", () => {
    toggleCurrentConversationReviewed();
  });

  copyTranscriptButton.addEventListener("click", () => {
    copyConversationTranscript().catch(showConversationError);
  });

  openRelatedConfigButton.addEventListener("click", () => {
    openRelatedConfigSection();
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
    bookingRulesSameDaySelect,
    bookingRulesMinimumNoticeInput,
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
  currentOutcomes = payload.outcomes ?? [];
  renderConversationLeadFilter(currentOutcomes);
  renderConversationStats(currentOutcomes);
  renderConversationList();
}

function renderConversationList() {
  const outcomes = sortConversationOutcomes(filterConversationOutcomes(currentOutcomes));

  if (!outcomes.length) {
    conversationList.innerHTML = '<div class="detail-empty">No conversations tracked yet.</div>';
    return;
  }

  conversationList.innerHTML = "";
  outcomes.forEach((outcome) => {
    const wrapper = document.createElement("article");
    wrapper.className = "list-item";
    const queueReason = deriveQueueReason(outcome);
    const previewSummary = deriveOutcomePreview(outcome);
    const reviewed = isConversationReviewed(outcome.conversationId);

    const button = document.createElement("button");
    button.className = "list-item-main";
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(outcome.conversationId)}</strong>
      <div class="badge-row">
        <span class="badge">${escapeHtml(outcome.leadSource)}</span>
        <span class="badge ${escapeHtml(statusBadgeClass(outcome))}">${escapeHtml(outcome.finalBookingStatus ?? "in_progress")}</span>
        ${queueReason ? `<span class="badge reason-badge">${escapeHtml(queueReason)}</span>` : ""}
        ${reviewed ? '<span class="badge reviewed-badge">reviewed</span>' : ""}
      </div>
      <p>${escapeHtml(outcome.classifiedServiceType ?? outcome.firstCustomerMessage)}</p>
      <div class="summary">${escapeHtml(previewSummary)}</div>
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
    const actions = document.createElement("div");
    actions.className = "list-item-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "inline-action";
    copyButton.textContent = "Copy handoff";
    copyButton.disabled = !outcome.handoffYesNo;
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(buildHandoffSummaryText(outcome));
      } catch (error) {
        showConversationError(error);
      }
    });

    const reviewButton = document.createElement("button");
    reviewButton.type = "button";
    reviewButton.className = "inline-action";
    reviewButton.textContent = reviewed ? "Unreview" : "Mark reviewed";
    reviewButton.addEventListener("click", () => {
      toggleConversationReviewed(outcome.conversationId);
      renderConversationList();
      if (currentConversationBundle?.conversationId === outcome.conversationId) {
        updateReviewedButtonState();
      }
    });

    actions.append(copyButton, reviewButton);
    wrapper.appendChild(actions);
    conversationList.appendChild(wrapper);
  });
}

async function loadConversationDetail(conversationId) {
  detailId.textContent = conversationId;
  conversationDetail.innerHTML = '<div class="detail-empty">Loading conversation detail…</div>';
  const response = await adminFetch(`/api/admin/conversations?conversationId=${encodeURIComponent(conversationId)}`);
  const payload = await response.json();
  currentConversationBundle = payload;

  const stages = payload.stages ?? [];
  const messages = payload.messages ?? [];
  const slots = payload.slots ?? [];
  const urgencyHits = payload.urgencyHits ?? [];
  const bookingEvents = payload.bookingEvents ?? [];
  const handoffEvents = payload.handoffEvents ?? [];
  const outcome = payload.outcome ?? {};
  const lastStage = stages.at(-1)?.stage ?? "unknown";
  const aiDecisions = extractAiDecisionEntries(messages);
  updateReviewedButtonState();

  conversationDetail.innerHTML = `
    <div class="detail-grid">
      <section class="detail-summary">
        <div class="badge-row">
          <span class="badge">${escapeHtml(outcome.leadSource ?? "unknown")}</span>
          <span class="badge ${escapeHtml(statusBadgeClass(outcome))}">${escapeHtml(outcome.finalBookingStatus ?? "in_progress")}</span>
          <span class="badge">${escapeHtml(outcome.classifiedServiceType ?? "unclassified")}</span>
        </div>
        <p>${escapeHtml(outcome.systemSummary ?? "No internal summary yet.")}</p>
        <div class="list-meta">
          <span>Last stage: ${escapeHtml(lastStage)}</span>
          <span>Urgency: ${escapeHtml(outcome.urgencyLevel ?? "normal")}</span>
          <span>Abandonment stage: ${escapeHtml(outcome.abandonmentStage ?? "n/a")}</span>
        </div>
        <div class="detail-actions">
          <span class="status-text">Use the quick actions above to copy this review or jump to the related config section.</span>
        </div>
      </section>
      ${renderBlock("Outcome", [
        `Lead source: ${escapeHtml(outcome.leadSource ?? "unknown")}`,
        `Service type: ${escapeHtml(outcome.classifiedServiceType ?? "n/a")}`,
        `Booking status: ${escapeHtml(outcome.finalBookingStatus ?? "n/a")}`,
        `HCP job type: ${escapeHtml(outcome.finalHcpJobType ?? "n/a")}`,
        `Booked: ${outcome.bookedYesNo ? "yes" : "no"}`,
        `Handoff: ${outcome.handoffYesNo ? "yes" : "no"}`,
      ])}
      ${renderBlock("Stages", stages.map((stage) => `${stage.stage} · ${formatTime(stage.timestamp)}`))}
      ${renderAiDecisionBlock(aiDecisions)}
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

function renderConversationStats(outcomes) {
  const booked = outcomes.filter((outcome) => outcome.bookedYesNo).length;
  const handoff = outcomes.filter((outcome) => outcome.handoffYesNo).length;
  const urgent = outcomes.filter((outcome) => outcome.urgencyLevel === "urgent").length;
  const inProgress = outcomes.length - booked - handoff;

  conversationStats.innerHTML = [
    statCard("Tracked", outcomes.length, "Recent conversation outcomes in the selected sample."),
    statCard("Booked", booked, "Completed bookings from tracked flows."),
    statCard("Handoff", handoff, "Requests that escalated to a human."),
    statCard("Urgent", urgent, "Conversations marked urgent by configured signals."),
    statCard("In Progress", Math.max(inProgress, 0), "Conversations without a final booked or handoff outcome."),
  ].join("");
}

function renderConversationLeadFilter(outcomes) {
  const selected = conversationLeadFilter.value;
  const leadSources = [...new Set(outcomes.map((outcome) => outcome.leadSource).filter(Boolean))].sort();
  conversationLeadFilter.innerHTML = '<option value="">All lead sources</option>';
  leadSources.forEach((leadSource) => {
    const option = document.createElement("option");
    option.value = leadSource;
    option.textContent = leadSource;
    if (leadSource === selected) {
      option.selected = true;
    }
    conversationLeadFilter.appendChild(option);
  });
}

async function copyConversationSummary() {
  if (!currentConversationBundle?.outcome) {
    throw new Error("Load a conversation first.");
  }

  const outcome = currentConversationBundle.outcome;
  const stages = currentConversationBundle.stages ?? [];
  const summary = [
    `Conversation: ${currentConversationBundle.conversationId}`,
    `Lead source: ${outcome.leadSource ?? "unknown"}`,
    `Service type: ${outcome.classifiedServiceType ?? "n/a"}`,
    `Status: ${outcome.finalBookingStatus ?? "in_progress"}`,
    `Booked: ${outcome.bookedYesNo ? "yes" : "no"}`,
    `Handoff: ${outcome.handoffYesNo ? "yes" : "no"}`,
    `Urgency: ${outcome.urgencyLevel ?? "normal"}`,
    `Last stage: ${stages.at(-1)?.stage ?? "unknown"}`,
    `Summary: ${outcome.systemSummary ?? "No internal summary yet."}`,
  ].join("\n");

  await navigator.clipboard.writeText(summary);
  conversationDetail.dataset.notice = "Summary copied.";
}

async function copyConversationTranscript() {
  if (!currentConversationBundle?.messages?.length) {
    throw new Error("Load a conversation with transcript messages first.");
  }

  const transcript = currentConversationBundle.messages
    .map((message) => `[${formatTime(message.timestamp)}] ${message.direction}${message.toolName ? `:${message.toolName}` : ""} ${message.text ?? message.toolCallSummary ?? ""}`)
    .join("\n");

  await navigator.clipboard.writeText(transcript);
  conversationDetail.dataset.notice = "Transcript copied.";
}

async function copyCurrentHandoffSummary() {
  if (!currentConversationBundle?.outcome) {
    throw new Error("Load a conversation first.");
  }

  await navigator.clipboard.writeText(buildHandoffSummaryText(currentConversationBundle.outcome));
  conversationDetail.dataset.notice = "Handoff summary copied.";
}

function openRelatedConfigSection() {
  if (!currentConversationBundle?.outcome) {
    showConfigError(new Error("Load a conversation first."));
    return;
  }

  const outcome = currentConversationBundle.outcome;
  navButtons.forEach((item) => item.classList.toggle("active", item.dataset.view === "config"));
  views.forEach((view) => view.classList.toggle("active", view.id === "view-config"));

  if (outcome.handoffYesNo && outcome.urgencyLevel === "urgent") {
    urgencyKeywordsList.scrollIntoView({ behavior: "smooth", block: "start" });
    configStatus.textContent = "Jumped to urgency keywords for this conversation.";
    return;
  }

  if (outcome.classifiedServiceType) {
    const matchingServiceType = currentConfig?.serviceTypes?.find((serviceType) =>
      serviceType.id === outcome.classifiedServiceType ||
      serviceType.requestedServiceLabel === outcome.classifiedServiceType ||
      serviceType.displayName === outcome.classifiedServiceType,
    );
    if (matchingServiceType) {
      selectedServiceTypeId = matchingServiceType.id;
      renderServiceTypes(currentConfig.serviceTypes);
      serviceTypeEditor.scrollIntoView({ behavior: "smooth", block: "start" });
      configStatus.textContent = `Jumped to service type ${matchingServiceType.displayName}.`;
      return;
    }
  }

  if (outcome.handoffYesNo && outcome.abandonmentStage === "collect_city") {
    allowedCitiesInput.scrollIntoView({ behavior: "smooth", block: "start" });
    configStatus.textContent = "Jumped to service areas for this conversation.";
    return;
  }

  conversationOpeningQuestionInput.scrollIntoView({ behavior: "smooth", block: "start" });
  configStatus.textContent = "Jumped to conversation settings.";
}

function toggleCurrentConversationReviewed() {
  if (!currentConversationBundle?.conversationId) {
    showConversationError(new Error("Load a conversation first."));
    return;
  }

  toggleConversationReviewed(currentConversationBundle.conversationId);
  updateReviewedButtonState();
  renderConversationList();
}

function filterConversationOutcomes(outcomes) {
  const search = conversationSearchInput.value.trim().toLowerCase();
  const status = conversationStatusFilter.value;
  const leadSource = conversationLeadFilter.value;

  return outcomes.filter((outcome) => {
    const statusValue = normalizeOutcomeStatus(outcome);
    const searchTarget = [
      outcome.conversationId,
      outcome.classifiedServiceType,
      outcome.firstCustomerMessage,
      outcome.systemSummary,
      outcome.abandonmentStage,
      outcome.leadSource,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (search && !searchTarget.includes(search)) {
      return false;
    }
    if (status && statusValue !== status) {
      return false;
    }
    if (leadSource && outcome.leadSource !== leadSource) {
      return false;
    }
    return true;
  });
}

function sortConversationOutcomes(outcomes) {
  const mode = conversationSortSelect?.value ?? "recent";
  const sorted = [...outcomes];

  sorted.sort((left, right) => compareConversationOutcomes(left, right, mode));
  return sorted;
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
  currentConfig.bookingRules.sameDayAllowed = bookingRulesSameDaySelect.value === "true";
  currentConfig.bookingRules.minimumNoticeHours = Number(bookingRulesMinimumNoticeInput.value) || 0;
  currentConfig.bookingRules.allowedWindows = Array.from(
    bookingRulesWindowsContainer.querySelectorAll('input[type="checkbox"]:checked'),
  ).map((input) => input.value);
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
  bookingRulesSameDaySelect.value = String(config.bookingRules.sameDayAllowed ?? true);
  bookingRulesMinimumNoticeInput.value = String(config.bookingRules.minimumNoticeHours ?? 0);

  renderRequestPhotoCheckboxes(config.conversation.requestPhotosFor ?? []);
  renderBookingWindows(config.bookingRules.allowedWindows ?? []);
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

function renderBookingWindows(selectedValues) {
  bookingRulesWindowsContainer.innerHTML = "";
  BOOKING_WINDOWS.forEach((windowOption) => {
    const label = document.createElement("label");
    label.className = "checkbox-item";
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(windowOption.value)}" ${selectedValues.includes(windowOption.value) ? "checked" : ""} />
      <span>${escapeHtml(windowOption.label)}</span>
    `;
    label.querySelector("input").addEventListener("change", updateConfigFromForms);
    bookingRulesWindowsContainer.appendChild(label);
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

function renderAiDecisionBlock(aiDecisions) {
  if (!aiDecisions.length) {
    return renderBlock("AI Decisions", ["No AI decision trace recorded for this conversation."]);
  }

  return `
    <section class="detail-block ai-decision-block">
      <h4>AI Decisions</h4>
      <ul class="ai-decision-list">
        ${aiDecisions.map((decision) => `
          <li class="ai-decision-item">
            <div class="ai-decision-header">
              <span class="badge">AI turn</span>
              <span class="status-text">${escapeHtml(formatTime(decision.timestamp))}</span>
            </div>
            <p>${escapeHtml(decision.summary)}</p>
            <div class="ai-trace-list">
              ${(decision.trace ?? []).map((entry) => `
                <div class="ai-trace-entry">
                  <strong>${escapeHtml(entry.type)}</strong>
                  ${entry.name ? `<span class="badge">${escapeHtml(entry.name)}</span>` : ""}
                  <span>${escapeHtml(entry.summary ?? "")}</span>
                </div>
              `).join("")}
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function statCard(title, value, detail) {
  return `
    <section class="stat-card">
      <span class="eyebrow">${escapeHtml(title)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <div class="status-text">${escapeHtml(detail)}</div>
    </section>
  `;
}

function extractAiDecisionEntries(messages) {
  return (messages ?? [])
    .filter((message) => message.direction === "tool" && message.toolName === "openai_decision_trace")
    .map((message) => ({
      timestamp: message.timestamp,
      summary: message.toolCallSummary ?? "AI decision trace recorded.",
      trace: Array.isArray(message.metadata?.trace) ? message.metadata.trace : [],
    }));
}

function deriveOutcomePreview(outcome) {
  if (outcome.systemSummary) {
    return outcome.systemSummary;
  }

  if (outcome.handoffYesNo) {
    return `Needs review: ${deriveQueueReason(outcome) ?? "handoff"}.`;
  }

  if (outcome.availabilityShown) {
    return `Availability shown with ${outcome.slotsShownCount ?? 0} slots.`;
  }

  if (outcome.abandonmentStage) {
    return `Waiting at ${outcome.abandonmentStage}.`;
  }

  return "No summary yet.";
}

function deriveQueueReason(outcome) {
  const summary = String(outcome.systemSummary ?? "").toLowerCase();
  const status = String(outcome.finalBookingStatus ?? "").toLowerCase();

  if (outcome.bookedYesNo) {
    return "booked";
  }
  if (summary.includes("outside_service_area")) {
    return "outside area";
  }
  if (summary.includes("human_requested")) {
    return "human requested";
  }
  if (summary.includes("booking_fallback")) {
    return "booking fallback";
  }
  if (summary.includes("urgent")) {
    return "urgent";
  }
  if (status === "human_escalation_required") {
    return "hcp escalation";
  }
  if (outcome.handoffYesNo) {
    return "handoff";
  }
  if (outcome.availabilityShown) {
    return "slots shown";
  }
  return "";
}

function buildHandoffSummaryText(outcome) {
  const queueReason = deriveQueueReason(outcome) || "handoff";
  return [
    `Conversation: ${outcome.conversationId ?? currentConversationBundle?.conversationId ?? "unknown"}`,
    `Lead source: ${outcome.leadSource ?? "unknown"}`,
    `Service type: ${outcome.classifiedServiceType ?? "n/a"}`,
    `Reason: ${queueReason}`,
    `Urgency: ${outcome.urgencyLevel ?? "normal"}`,
    `Summary: ${outcome.systemSummary ?? "No internal summary yet."}`,
  ].join("\n");
}

function compareConversationOutcomes(left, right, mode) {
  if (mode === "urgent_first") {
    return (
      compareDescending(Number(isUrgentOutcome(left)), Number(isUrgentOutcome(right))) ||
      compareDescending(Number(left.handoffYesNo), Number(right.handoffYesNo)) ||
      compareDescending(left.timestampLastMessage ?? 0, right.timestampLastMessage ?? 0)
    );
  }

  if (mode === "handoff_first") {
    return (
      compareDescending(Number(left.handoffYesNo), Number(right.handoffYesNo)) ||
      compareDescending(Number(isUrgentOutcome(left)), Number(isUrgentOutcome(right))) ||
      compareDescending(left.timestampLastMessage ?? 0, right.timestampLastMessage ?? 0)
    );
  }

  if (mode === "booked_last") {
    return (
      compareAscending(Number(left.bookedYesNo), Number(right.bookedYesNo)) ||
      compareDescending(Number(left.handoffYesNo), Number(right.handoffYesNo)) ||
      compareDescending(left.timestampLastMessage ?? 0, right.timestampLastMessage ?? 0)
    );
  }

  return compareDescending(left.timestampLastMessage ?? 0, right.timestampLastMessage ?? 0);
}

function isUrgentOutcome(outcome) {
  return outcome.urgencyLevel === "urgent" || deriveQueueReason(outcome) === "urgent";
}

function compareDescending(left, right) {
  return right - left;
}

function compareAscending(left, right) {
  return left - right;
}

function getReviewedConversationMap() {
  try {
    return JSON.parse(localStorage.getItem(REVIEWED_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveReviewedConversationMap(value) {
  localStorage.setItem(REVIEWED_STORAGE_KEY, JSON.stringify(value));
}

function isConversationReviewed(conversationId) {
  const reviewed = getReviewedConversationMap();
  return Boolean(reviewed[conversationId]);
}

function toggleConversationReviewed(conversationId) {
  const reviewed = getReviewedConversationMap();
  if (reviewed[conversationId]) {
    delete reviewed[conversationId];
  } else {
    reviewed[conversationId] = {
      reviewedAt: Date.now(),
    };
  }
  saveReviewedConversationMap(reviewed);
}

function updateReviewedButtonState() {
  const conversationId = currentConversationBundle?.conversationId;
  const reviewed = conversationId ? isConversationReviewed(conversationId) : false;
  markReviewedButton.textContent = reviewed ? "Unreview" : "Mark Reviewed";
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

function normalizeOutcomeStatus(outcome) {
  if (outcome.bookedYesNo || outcome.finalBookingStatus === "booked") {
    return "booked";
  }
  if (outcome.handoffYesNo || outcome.finalBookingStatus === "handoff" || outcome.finalBookingStatus === "human_escalation_required") {
    return "handoff";
  }
  if (outcome.availabilityShown) {
    return "slots_available";
  }
  return "in_progress";
}

function statusBadgeClass(outcome) {
  const status = normalizeOutcomeStatus(outcome);
  if (status === "booked") {
    return "booked";
  }
  if (status === "handoff") {
    return "handoff";
  }
  return "in-progress";
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
