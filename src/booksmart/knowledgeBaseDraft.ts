export interface BookingPivotDraft {
  style: "soft" | "direct" | "neighborly";
  defaultPhrase: string;
  preferredPhrases: string[];
  dislikedPhrases: string[];
}

export interface PricingPolicyDraft {
  mentionServiceCallPriceOnlyWhenPressed: boolean;
  serviceCallPrice: string;
  serviceCallScript: string;
  freeEstimateCategories: string[];
  refuseDirectPricingQuestions: string[];
}

export interface FaqEntryDraft {
  question: string;
  answer: string;
  pivotToBooking?: boolean;
}

export interface SafetyPolicyDraft {
  urgentTriggers: string[];
  safetyInstruction: string;
  callInsteadOfText: string[];
}

export interface CompanyPolicyDraft {
  mentionOnlyIfAsked: string[];
  permits: string;
  financing: string;
  warranties: string;
}

export interface FallbackPolicyDraft {
  unknownAnswer: string;
  repeatedQuestioning: string;
}

export interface StormKnowledgeSectionDraft {
  title: string;
  primaryGoal: string;
  bookingRule: string;
  safetyWarnings?: string[];
  checklist: Array<{
    heading: string;
    guidance: string[];
  }>;
  bookServiceWhen?: string[];
}

export interface KnowledgeBaseDraft {
  businessName: string;
  serviceAreaPositioning: {
    confidentYes: string[];
    maybeCheck: string[];
    politelyDecline: string[];
  };
  serviceCatalog: {
    definitelyOffer: string[];
    definitelyDecline: string[];
    commonRequests: string[];
  };
  bookingPivot: BookingPivotDraft;
  pricing: PricingPolicyDraft;
  faq: FaqEntryDraft[];
  safety: SafetyPolicyDraft;
  policies: CompanyPolicyDraft;
  fallback: FallbackPolicyDraft;
  stormGuidance: {
    postStormReadiness: StormKnowledgeSectionDraft;
    preStormReadiness: StormKnowledgeSectionDraft;
  };
  notes: string[];
}

// Draft knowledge layer only. This is intentionally not wired into the live bot yet.
export const KNOWLEDGE_BASE_DRAFT: KnowledgeBaseDraft = {
  businessName: "The Neighborhood Electrician",
  serviceAreaPositioning: {
    confidentYes: ["Macomb County", "Oakland County"],
    maybeCheck: [],
    politelyDecline: ["Wayne County", "Detroit"],
  },
  serviceCatalog: {
    definitelyOffer: ["Panel upgrades", "Recessed lighting"],
    definitelyDecline: ["Ethernet lines", "Cable jacks"],
    commonRequests: ["Plugs not working"],
  },
  bookingPivot: {
    style: "direct",
    defaultPhrase: "want to get it scheduled?",
    preferredPhrases: [
      "Would you like us to get it scheduled?",
      "want to get it scheduled?",
    ],
    dislikedPhrases: [],
  },
  pricing: {
    mentionServiceCallPriceOnlyWhenPressed: true,
    serviceCallPrice: "$229",
    serviceCallScript:
      "We charge $229 to come out and look through everything to make sure it’s safe then give you options to get everything taken care of.",
    freeEstimateCategories: [
      "Panel upgrade",
      "EV charger",
      "Large renovation",
      "Kitchen remodel",
      "Bathroom remodel",
    ],
    refuseDirectPricingQuestions: ["How much is this going to cost?"],
  },
  faq: [
    {
      question: "Do you service my area?",
      answer:
        "Yes — we service Shelby Township and surrounding Metro Detroit areas. I can help get you scheduled.",
      pivotToBooking: true,
    },
    {
      question: "Are you licensed and insured?",
      answer:
        "Yes — all of our electricians are licensed, insured, and experienced residential service professionals.",
      pivotToBooking: true,
    },
    {
      question: "What kind of electrical work do you do?",
      answer:
        "We specialize in residential electrical repairs, upgrades, lighting, EV chargers, panel replacements, troubleshooting, and renovations.",
      pivotToBooking: true,
    },
    {
      question: "How soon can someone come out?",
      answer: "We often have appointments available within the next day or two. I can check the next opening for you now.",
      pivotToBooking: true,
    },
    {
      question: "Do you work on residential homes only?",
      answer:
        "Yes — we focus on residential electrical work so homeowners get specialists for their type of project.",
      pivotToBooking: true,
    },
    {
      question: "How much do you charge to come out?",
      answer:
        "For troubleshooting and smaller repairs, we charge $229 for the visit. That includes a full electrical inspection and the $229 is applied toward the work if you move forward.",
      pivotToBooking: true,
    },
    {
      question: "Do you give free estimates?",
      answer:
        "Yes — larger projects like panel upgrades, EV chargers, generators, and renovations include a free estimate.",
      pivotToBooking: true,
    },
    {
      question: "Can you give me a price over the phone?",
      answer:
        "Exact pricing depends on what we find on-site, but your electrician will provide clear options with upfront pricing before any work begins.",
      pivotToBooking: true,
    },
    {
      question: "Do you charge by the hour or flat rate?",
      answer: "We provide upfront option-based pricing after the inspection so there are no surprises.",
      pivotToBooking: true,
    },
    {
      question: "Do you offer options before starting work?",
      answer: "Yes — your electrician will walk you through repair or upgrade options and pricing before anything begins.",
      pivotToBooking: true,
    },
    {
      question: "Will I know the price before work starts?",
      answer: "Yes — we always review pricing with you before any work begins.",
      pivotToBooking: true,
    },
    {
      question: "Do you guarantee your work?",
      answer: "Yes — we stand behind our workmanship and want you to feel confident in the work completed.",
      pivotToBooking: true,
    },
    {
      question: "Will the electrician explain everything first?",
      answer: "Yes — your electrician will explain what they find and walk you through the best solutions.",
      pivotToBooking: true,
    },
    {
      question: "Do I have to approve the work before it begins?",
      answer: "Yes — nothing starts until you approve the option you choose.",
      pivotToBooking: true,
    },
    {
      question: "Do you clean up after the job?",
      answer: "Yes — we treat your home with care and leave the workspace clean when finished.",
      pivotToBooking: true,
    },
    {
      question: "Can you install an EV charger?",
      answer: "Yes — we install EV chargers and provide free estimates for those projects.",
      pivotToBooking: true,
    },
    {
      question: "Can you replace or upgrade my panel?",
      answer: "Yes — we provide free estimates for panel replacements and service upgrades.",
      pivotToBooking: true,
    },
    {
      question: "Can you add outlets or lighting?",
      answer: "Yes — we install outlets, switches, recessed lighting, and many other electrical upgrades.",
      pivotToBooking: true,
    },
    {
      question: "Can you fix flickering lights, tripping breakers, or power issues?",
      answer:
        "Yes — that’s exactly what our $229 diagnostic visit is designed for. We inspect the system and apply that toward the repair if you move forward.",
      pivotToBooking: true,
    },
    {
      question: "Can you install generators or interlock kits?",
      answer:
        "Yes — we install generator connections and interlock systems and provide free estimates for those installations.",
      pivotToBooking: true,
    },
  ],
  safety: {
    urgentTriggers: ["Fire", "Sparks", "Burning"],
    safetyInstruction: "Turn off the main and go outside.",
    callInsteadOfText: ["Emergency"],
  },
  policies: {
    mentionOnlyIfAsked: ["Permits", "Inspections", "Financing", "Warranties"],
    permits: "We are licensed and will take care of permitting if you want one.",
    financing: "We offer awesome options for financing.",
    warranties: "We offer different levels of warranties depending on the work done.",
  },
  fallback: {
    unknownAnswer: "Can we discuss this over the phone?",
    repeatedQuestioning: "Call 586-489-1504 and we can talk it through.",
  },
  stormGuidance: {
    postStormReadiness: {
      title: "Pre-Storm Electrical Readiness",
      primaryGoal:
        "Guide customers through a safe visual inspection after a storm and identify when a professional repair by The Neighborhood Electrician is legally and technically required.",
      bookingRule: "If a customer asks to book, never say you cannot book appointments.",
      safetyWarnings: [
        "Never enter a flooded basement or room if the water level has reached electrical outlets, baseboard heaters, or extension cords.",
        "Stay at least 25 feet away from downed lines and assume all downed wires are live.",
        "An ozone, fishy, or burnt plastic smell can mean an active electrical arc. Turn off the main breaker immediately if it is safe to reach.",
      ],
      checklist: [
        {
          heading: "Exterior inspection",
          guidance: [
            "Check the electrical mast on the roof. If it is bent, leaning, or pulled away from the house, the utility cannot reconnect power until a licensed contractor repairs it and it passes inspection.",
            "Check the service drop and make sure the cables from the pole to the house are not sagging or caught in tree limbs.",
            "Check the meter box for damage or if it has pulled away from the siding.",
          ],
        },
        {
          heading: "Interior inspection",
          guidance: [
            "If only part of the house has power or large appliances will not start, one leg of power may be down. Turn off sensitive electronics to avoid undervoltage damage.",
            "If a breaker trips, flip it fully OFF before turning it back ON. If it trips again immediately, stop and do not try a third reset.",
            "Test and reset GFCI outlets in kitchens, baths, garages, and outside areas.",
            "Make sure the sump pump is plugged in and the outlet has not tripped. If the pump was submerged, it needs an inspection before use.",
          ],
        },
      ],
      bookServiceWhen: [
        "The mast or meter housing is physically damaged or detached.",
        "Breakers will not stay reset.",
        "Outlets or switches are warm to the touch or discolored.",
        "Lights are flickering excessively or humming.",
      ],
    },
    preStormReadiness: {
      title: "Pre-Storm Electrical Readiness",
      primaryGoal:
        "Help customers minimize potential damage and safety hazards before a severe weather event or high-wind storm occurs.",
      bookingRule: "If a customer asks to book, never say you cannot book appointments.",
      checklist: [
        {
          heading: "Outdoor preparation",
          guidance: [
            "Visually inspect the electrical mast on the roof. If it looks loose or the brackets are rusting, high winds can pull it down and cause a long outage.",
            "Tree branches should stay at least 10 feet away from service lines running to the house.",
            "Unplug and store outdoor electronics and make sure outdoor GFCI covers are snapped shut.",
          ],
        },
        {
          heading: "Surge and asset protection",
          guidance: [
            "Whole-home surge protection at the main panel is the best way to protect 220V appliances like HVAC systems and washers or dryers.",
            "If a major lightning storm is coming, physically unplug computers, gaming consoles, and high-end TVs.",
            "Take a quick photo of the main electrical panel and major appliances for insurance records.",
          ],
        },
        {
          heading: "Essential systems readiness",
          guidance: [
            "Test the sump pump by pouring a bucket of water into the pit and making sure the float switch turns the pump on.",
            "Check the batteries in smoke detectors and CO alarms.",
            "Keep the path to the main panel clear and store a flashlight nearby. Never use candles near the panel.",
          ],
        },
        {
          heading: "Generator safety",
          guidance: [
            "Keep the area around a standby generator clear of debris or snow.",
            "For portable generators, keep fresh fuel on hand and make sure the unit starts.",
            "Never run a generator in a garage and never back-feed a house through a dryer outlet.",
          ],
        },
      ],
      bookServiceWhen: [
        "The main panel makes a humming or buzzing sound.",
        "Lights flicker when the wind blows.",
        "The sump pump is more than 7 to 10 years old.",
        "The homeowner wants to discuss a manual transfer switch for a portable generator.",
      ],
    },
  },
  notes: [
    "Keep booking and lead capture as the default priority.",
    "Answer briefly when needed, then pivot back toward scheduling.",
    "Do not wire this into live behavior until the booking-first flow is fully settled.",
    "County-level service-area wording can stay customer-facing while underlying routing remains city-based.",
  ],
};
