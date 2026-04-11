const environmentBadge = document.getElementById("environment-badge");

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
