const thread = document.getElementById("chat-thread");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const sendButton = document.getElementById("chat-send");
const resetButton = document.getElementById("chat-reset");
const statusText = document.getElementById("chat-status");
const firstNameInput = document.getElementById("contact-first-name");
const phoneInput = document.getElementById("contact-phone");
const emailInput = document.getElementById("contact-email");

const SESSION_STORAGE_KEY = "booksmart_public_chat_session";
const HISTORY_STORAGE_KEY = "booksmart_public_chat_history";
const CONTACT_STORAGE_KEY = "booksmart_public_chat_contact";

boot();

function boot() {
  hydrateContactFields();
  ensureSeededHistory();
  renderHistory(loadHistory());
  form.addEventListener("submit", onSubmit);
  resetButton.addEventListener("click", resetConversation);
  [firstNameInput, phoneInput, emailInput].forEach((element) => {
    element.addEventListener("input", saveContactFields);
  });
}

async function onSubmit(event) {
  event.preventDefault();
  await sendMessage(input.value.trim());
}

async function sendMessage(text) {
  if (!text) {
    return;
  }

  appendHistoryEntry({ role: "user", text });
  input.value = "";
  setBusy(true, "Sending…");

  try {
    const response = await fetch("/api/public/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: getSessionId(),
        text,
        leadSource: readLeadSource(),
        contact: buildContactPayload(),
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "BookSmart could not process that message.");
    }

    appendHistoryEntry({
      role: "assistant",
      text: payload.replyText,
      kind: payload.bookingId ? "booked" : payload.handoffRequired ? "handoff" : "reply",
      options: Array.isArray(payload.options) ? payload.options : [],
      bookingId: payload.bookingId,
      handoffRequired: payload.handoffRequired,
    });

    setBusy(
      false,
      payload.bookingId
        ? `Booked successfully: ${payload.bookingId}`
        : payload.handoffRequired
          ? "A team member may need to review this request."
          : "Reply received.",
    );
  } catch (error) {
    appendHistoryEntry({
      role: "assistant",
      text: "Something went wrong while sending that. Please try again.",
      kind: "error",
    });
    setBusy(false, error instanceof Error ? error.message : "Something went wrong.");
  }
}

function renderHistory(history) {
  thread.innerHTML = "";

  history.forEach((entry, index) => {
    const item = document.createElement("article");
    item.className = `chat-bubble ${entry.role}${entry.kind ? ` ${entry.kind}` : ""}`;

    const text = document.createElement("div");
    text.className = "chat-bubble-text";
    text.textContent = entry.text;
    item.appendChild(text);

    if (entry.role === "assistant" && Array.isArray(entry.options) && entry.options.length) {
      const optionGroup = document.createElement("div");
      optionGroup.className = "chat-options";

      entry.options.forEach((option, optionIndex) => {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "option-button";
        optionButton.textContent = option.label;
        optionButton.addEventListener("click", () => {
          markOptionGroupUsed(index);
          sendMessage(optionIndex === 0 ? "first one" : optionIndex === 1 ? "second one" : option.label).catch(() => undefined);
        });
        optionGroup.appendChild(optionButton);
      });

      if (entry.optionsUsed) {
        optionGroup.classList.add("used");
        optionGroup.querySelectorAll("button").forEach((button) => {
          button.disabled = true;
        });
      }

      item.appendChild(optionGroup);
    }

    if (entry.role === "assistant" && entry.bookingId) {
      const tag = document.createElement("div");
      tag.className = "chat-note success";
      tag.textContent = `Booking ID: ${entry.bookingId}`;
      item.appendChild(tag);
    }

    if (entry.role === "assistant" && entry.handoffRequired) {
      const tag = document.createElement("div");
      tag.className = "chat-note warning";
      tag.textContent = "This request may need team review.";
      item.appendChild(tag);
    }

    thread.appendChild(item);
  });

  thread.scrollTop = thread.scrollHeight;
}

function appendHistoryEntry(entry) {
  const history = loadHistory();
  history.push(entry);
  saveHistory(history);
  renderHistory(history);
}

function loadHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(history) {
  sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(-40)));
}

function markOptionGroupUsed(index) {
  const history = loadHistory();
  if (history[index]) {
    history[index].optionsUsed = true;
    saveHistory(history);
    renderHistory(history);
  }
}

function getSessionId() {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const next = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem(SESSION_STORAGE_KEY, next);
  return next;
}

function readLeadSource() {
  const params = new URLSearchParams(window.location.search);
  return params.get("leadSource") || "website";
}

function buildContactPayload() {
  saveContactFields();

  const contact = {
    firstName: firstNameInput.value.trim(),
    phone: phoneInput.value.trim(),
    email: emailInput.value.trim(),
  };

  return Object.fromEntries(Object.entries(contact).filter(([, value]) => value));
}

function saveContactFields() {
  sessionStorage.setItem(
    CONTACT_STORAGE_KEY,
    JSON.stringify({
      firstName: firstNameInput.value.trim(),
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
    }),
  );
}

function hydrateContactFields() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CONTACT_STORAGE_KEY) ?? "{}");
    firstNameInput.value = stored.firstName ?? "";
    phoneInput.value = stored.phone ?? "";
    emailInput.value = stored.email ?? "";
  } catch {
    firstNameInput.value = "";
    phoneInput.value = "";
    emailInput.value = "";
  }
}

function setBusy(isBusy, message) {
  resetButton.disabled = isBusy;
  sendButton.disabled = isBusy;
  input.disabled = isBusy;
  statusText.textContent = message;
}

function resetConversation() {
  const confirmed = window.confirm("Start over and clear this conversation in this browser tab?");
  if (!confirmed) {
    return;
  }

  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem(HISTORY_STORAGE_KEY);
  sessionStorage.removeItem(CONTACT_STORAGE_KEY);
  firstNameInput.value = "";
  phoneInput.value = "";
  emailInput.value = "";
  input.value = "";
  ensureSeededHistory();
  renderHistory(loadHistory());
  setBusy(false, "Started over. You can begin again.");
}

function ensureSeededHistory() {
  const history = loadHistory();
  if (history.length) {
    return;
  }

  saveHistory([
    {
      role: "assistant",
      text: "What city is the project in?",
      kind: "prompt",
    },
  ]);
}
