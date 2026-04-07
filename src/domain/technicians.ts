import { TechnicianProfile } from "./types.js";

export const TECHNICIANS: TechnicianProfile[] = [
  {
    name: "Nate",
    seniorityRank: 1,
    skills: ["senior", "commercial", "troubleshooting", "ev", "service-change", "residential"],
    bookingTargets: ["estimate"],
  },
  {
    name: "Steve",
    seniorityRank: 1,
    skills: ["senior", "commercial", "troubleshooting", "residential"],
  },
  {
    name: "Brandon",
    seniorityRank: 1,
    skills: ["senior", "commercial", "troubleshooting", "residential"],
  },
  {
    name: "Dave",
    seniorityRank: 2,
    skills: [
      "troubleshooting",
      "fixtures",
      "new-plugs",
      "recessed-lighting",
      "residential",
    ],
  },
  {
    name: "Lou",
    seniorityRank: 2,
    skills: [
      "ev",
      "service-change",
      "rough-wiring",
      "troubleshooting",
      "residential",
    ],
  },
];
