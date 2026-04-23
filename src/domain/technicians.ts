import { TechnicianProfile } from "./types.js";

export const TECHNICIANS: TechnicianProfile[] = [
  {
    name: "Nate",
    seniorityRank: 1,
    skills: [
      "senior",
      "ev",
      "service-change",
      "rough-wiring",
      "remodel_estimates",
      "panel_work",
      "residential",
      "commercial",
      "troubleshooting",
    ],
    bookingTargets: ["estimate"],
  },
  {
    name: "Brandon",
    seniorityRank: 1,
    skills: ["senior", "commercial", "troubleshooting", "residential", "new-plugs", "recessed-lighting"],
  },
  {
    name: "Steve",
    seniorityRank: 1,
    skills: ["senior", "commercial", "troubleshooting", "residential", "new-plugs", "recessed-lighting"],
  },
  {
    name: "Dave",
    seniorityRank: 2,
    skills: ["senior", "troubleshooting", "residential", "fixtures", "new-plugs", "recessed-lighting"],
  },
  {
    name: "Lou",
    seniorityRank: 2,
    skills: ["senior", "commercial", "troubleshooting", "residential", "new-plugs", "ev"],
  },
];
