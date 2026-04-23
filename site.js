const environmentBadge = document.getElementById("environment-badge");
const handoffLinks = [
  document.getElementById("human-handoff-link-home"),
  document.getElementById("human-handoff-link-book"),
].filter(Boolean);
const handoffCopyBlocks = [
  document.getElementById("human-handoff-copy-home"),
  document.getElementById("human-handoff-copy-book"),
].filter(Boolean);

boot();

async function boot() {
  if (!environmentBadge) {
    return;
  }

  try {
    const response = await fetch("/api/public/runtime");
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error("Could not load runtime info.");
    }

    environmentBadge.textContent = formatEnvironmentLabel(payload.environment);
    environmentBadge.dataset.environment = String(payload.environment || "unknown");
    environmentBadge.hidden = false;
    applyHumanHandoffContact(payload);
  } catch {
    environmentBadge.hidden = true;
  }
}

function formatEnvironmentLabel(environment) {
  switch (String(environment || "").toLowerCase()) {
    case "production":
      return "Production";
    case "preview":
      return "Preview";
    case "development":
      return "Development";
    case "test":
      return "Test";
    default:
      return environment ? String(environment) : "Unknown";
  }
}

function applyHumanHandoffContact(payload) {
  const textHref = payload?.humanHandoffSmsHref || payload?.humanHandoffHref;
  if (!payload || !payload.humanHandoffPhone || !textHref) {
    return;
  }

  handoffLinks.forEach((link) => {
    link.href = textHref;
    link.textContent = `Text ${payload.humanHandoffPhone}`;
    link.hidden = false;
  });

  handoffCopyBlocks.forEach((block) => {
    block.textContent = `Prefer a human? Call or text ${payload.humanHandoffPhone}.`;
    block.hidden = false;
  });
}
