import { ServiceProfile } from "./types.js";

const SERVICE_CATALOG: ServiceProfile[] = [
  {
    category: "commercial-troubleshooting",
    title: "Commercial troubleshooting",
    durationMinutes: 180,
    requiredSkills: ["senior", "commercial", "troubleshooting"],
    preferredSkills: ["senior"],
    target: "job",
    complexityScore: 10,
  },
  {
    category: "complex-troubleshooting",
    title: "Complex troubleshooting",
    durationMinutes: 180,
    requiredSkills: ["senior", "troubleshooting"],
    preferredSkills: ["commercial"],
    target: "job",
    complexityScore: 9,
    escalationKeywords: ["fire", "smoke", "sparks"],
  },
  {
    category: "residential-troubleshooting",
    title: "Residential troubleshooting",
    durationMinutes: 120,
    requiredSkills: ["troubleshooting"],
    preferredSkills: ["senior"],
    target: "job",
    complexityScore: 7,
    escalationKeywords: ["fire", "smoke", "sparks"],
  },
  {
    category: "fixture-swap",
    title: "Fixture swap",
    durationMinutes: 60,
    requiredSkills: ["fixtures", "residential"],
    preferredSkills: [],
    target: "job",
    complexityScore: 3,
  },
  {
    category: "new-plug",
    title: "New outlet or plug",
    durationMinutes: 90,
    requiredSkills: ["new-plugs", "residential"],
    preferredSkills: [],
    target: "job",
    complexityScore: 4,
  },
  {
    category: "outlet-repair",
    title: "Outlet repair",
    durationMinutes: 60,
    requiredSkills: ["new-plugs", "residential"],
    preferredSkills: ["troubleshooting"],
    target: "job",
    complexityScore: 4,
  },
  {
    category: "recessed-lighting",
    title: "Recessed lighting",
    durationMinutes: 240,
    requiredSkills: ["recessed-lighting", "residential"],
    preferredSkills: [],
    target: "job",
    complexityScore: 6,
  },
  {
    category: "ev-charger",
    title: "EV charger installation",
    durationMinutes: 240,
    requiredSkills: ["ev"],
    preferredSkills: ["service-change"],
    target: "estimate",
    complexityScore: 8,
  },
  {
    category: "panel-upgrade",
    title: "Panel upgrade",
    durationMinutes: 360,
    requiredSkills: ["senior"],
    preferredSkills: ["service-change"],
    target: "estimate",
    complexityScore: 9,
  },
  {
    category: "service-change",
    title: "Small service change",
    durationMinutes: 240,
    requiredSkills: ["service-change"],
    preferredSkills: [],
    target: "job",
    complexityScore: 7,
  },
  {
    category: "rough-wiring",
    title: "Rough wiring",
    durationMinutes: 300,
    requiredSkills: ["rough-wiring"],
    preferredSkills: [],
    target: "job",
    complexityScore: 8,
  },
  {
    category: "renovation",
    title: "Large renovation electrical work",
    durationMinutes: 480,
    requiredSkills: ["senior"],
    preferredSkills: ["rough-wiring", "service-change"],
    target: "estimate",
    complexityScore: 9,
  },
  {
    category: "generic-electrical",
    title: "General electrical service",
    durationMinutes: 120,
    requiredSkills: ["residential"],
    preferredSkills: ["troubleshooting"],
    target: "job",
    complexityScore: 5,
  },
];

const KEYWORD_MAP: Array<{ matchers: string[]; category: ServiceProfile["category"] }> = [
  {
    category: "commercial-troubleshooting",
    matchers: ["commercial", "store", "office", "business", "troubleshoot"],
  },
  {
    category: "complex-troubleshooting",
    matchers: ["complex troubleshooting", "complex troubleshoot", "advanced troubleshoot"],
  },
  {
    category: "ev-charger",
    matchers: ["ev", "tesla", "charger", "car charger"],
  },
  {
    category: "panel-upgrade",
    matchers: ["panel", "breaker box", "service upgrade"],
  },
  {
    category: "renovation",
    matchers: ["renovation", "addition", "remodel", "rehab"],
  },
  {
    category: "rough-wiring",
    matchers: ["rough", "rough wiring", "new construction"],
  },
  {
    category: "service-change",
    matchers: ["service change", "meter", "mast"],
  },
  {
    category: "recessed-lighting",
    matchers: ["recessed", "can light", "pot light"],
  },
  {
    category: "fixture-swap",
    matchers: ["fixture", "fan", "chandelier", "light swap"],
  },
  {
    category: "outlet-repair",
    matchers: ["outlet repair", "bad outlet", "broken outlet"],
  },
  {
    category: "new-plug",
    matchers: ["new plug", "new outlet", "add outlet", "receptacle"],
  },
  {
    category: "residential-troubleshooting",
    matchers: ["troubleshoot", "diagnostic", "breaker keeps tripping", "flicker"],
  },
];

export function classifyService(requestedService: string): ServiceProfile {
  const normalized = requestedService.trim().toLowerCase();
  const matched = KEYWORD_MAP.find((entry) =>
    entry.matchers.some((matcher) => normalized.includes(matcher)),
  );

  const category = matched?.category ?? "generic-electrical";
  return SERVICE_CATALOG.find((service) => service.category === category)!;
}
