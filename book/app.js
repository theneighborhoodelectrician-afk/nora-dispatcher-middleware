const thread = document.getElementById("chat-thread");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const sendButton = document.getElementById("chat-send");
const statusText = document.getElementById("chat-status");

const SESSION_STORAGE_KEY = "booksmart_public_chat_session";
const HISTORY_STORAGE_KEY = "booksmart_public_chat_history";

boot();

function boot() {
  const history = loadHistory();
  if (!history.length) {
    history.push({
      role: "assistant",
      text: "What city is the project in?",
    });
    saveHistory(history);
  }

  renderHistory(history);
  form.addEventListener("submit", onSubmit);
}

async function onSubmit(event) {
  event.preventDefault();

  const text = input.value.trim();
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
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "BookSmart could not process that message.");
    }

    appendHistoryEntry({
      role: "assistant",
      text: payload.replyText,
    });
    setBusy(false, payload.handoffRequired ? "A team member may need to review this request." : "Reply received.");
  } catch (error) {
    appendHistoryEntry({
      role: "assistant",
      text: "Something went wrong while sending that. Please try again.",
    });
    setBusy(false, error instanceof Error ? error.message : "Something went wrong.");
  }
}

function renderHistory(history) {
  thread.innerHTML = "";
  history.forEach((entry) => {
    const item = document.createElement("article");
    item.className = `chat-bubble ${entry.role}`;
    item.textContent = entry.text;
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

function setBusy(isBusy, message) {
  sendButton.disabled = isBusy;
  input.disabled = isBusy;
  statusText.textContent = message;
}
