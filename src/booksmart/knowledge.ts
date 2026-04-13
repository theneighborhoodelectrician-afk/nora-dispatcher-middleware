import { KNOWLEDGE_BASE_DRAFT } from "./knowledgeBaseDraft.js";

export interface KnowledgeAnswerMatch {
  answer: string;
  pivotOverride?: string;
  serviceSignal?: boolean;
  suppressAutoPivot?: boolean;
}

export function findKnowledgeAnswer(text: string): KnowledgeAnswerMatch | undefined {
  const normalized = text.trim().toLowerCase();

  const matchers: Array<{ patterns: RegExp[]; answer: string; pivotOverride?: string; serviceSignal?: boolean; suppressAutoPivot?: boolean }> = [
    {
      patterns: [/\b(ask some questions first|have some questions first|questions first)\b/],
      answer: "yep - ask away.",
      suppressAutoPivot: true,
    },
    {
      patterns: [/\b(is that all you can ask|that all you can ask|all you can ask me)\b/],
      answer: "no - ask whatever you want.",
      suppressAutoPivot: true,
    },
    {
      patterns: [/\b(do you service|service my area|serve my area|service area)\b/],
      answer: "Yep, we cover Macomb and Oakland County.",
    },
    {
      patterns: [/\blicensed\b/, /\binsured\b/],
      answer: "Yep - licensed and insured.",
    },
    {
      patterns: [/\bwhat kind of electrical work\b/, /\bwhat kind of work\b/, /\bwhat do you do\b/],
      answer: "Mostly residential repairs, upgrades, lighting, EV chargers, panels, troubleshooting, and remodel work.",
    },
    {
      patterns: [/\bhow soon\b/, /\bsoonest\b/, /\bwhen can someone come\b/],
      answer: "Usually pretty quick. I can get it moving now.",
    },
    {
      patterns: [/\bresidential\b/, /\bhomes only\b/],
      answer: "Yep - residential only.",
    },
    {
      patterns: [/\bhow much (do you charge|is it to come out)\b/, /\bservice call\b/, /\bdiagnostic\b/],
      answer: "For troubleshooting or smaller repairs, it's $229 to come out, look through everything, make sure it's safe, and give you options.",
    },
    {
      patterns: [/\bfree estimate\b/, /\bdo you give free estimates\b/],
      answer: "Yep - bigger jobs like panels, EV chargers, generators, and renovations are free estimates.",
    },
    {
      patterns: [/\bprice over the phone\b/, /\bquote over the phone\b/, /\bhow much is this going to cost\b/],
      answer: "Not exactly. We need to see it first so we can price it right.",
    },
    {
      patterns: [/\bflat rate\b/, /\bby the hour\b/],
      answer: "We give upfront options after the inspection so there aren't surprises.",
    },
    {
      patterns: [/\bprice before work\b/, /\bknow the price before\b/],
      answer: "Yep - you'll have pricing before anything starts.",
    },
    {
      patterns: [/\bguarantee\b/, /\bwarranty\b/, /\bwarranties\b/],
      answer: "Yep - warranty depends on the work, but we stand behind it.",
    },
    {
      patterns: [/\bexplain everything\b/, /\bwalk me through\b/, /\bapprove the work\b/],
      answer: "Yep - nothing starts until you approve it.",
    },
    {
      patterns: [/\bclean up\b/, /\bcleanup\b/],
      answer: "Yep - we clean up after ourselves.",
    },
    {
      patterns: [/\bev charger\b/, /\btesla charger\b/, /\bcar charger\b/],
      answer: "Yep - we do EV chargers. That's usually a free estimate.",
      serviceSignal: true,
    },
    {
      patterns: [/\bpanel upgrade\b/, /\bpanel replacement\b/, /\bnew panel\b/],
      answer: "Yep - we do panel upgrades and replacements. That's usually a free estimate.",
      serviceSignal: true,
    },
    {
      patterns: [/\brecessed lighting\b/, /\bcan lights\b/, /\bpot lights\b/, /\boutlets\b/, /\blighting\b/],
      answer: "Yep - we do outlets, switches, recessed lighting, and other upgrades.",
      serviceSignal: true,
    },
    {
      patterns: [/\bflickering\b/, /\btripping breaker\b/, /\bpower issue\b/, /\bplug(s)? not working\b/],
      answer: "Yep - that's the kind of thing we handle all the time.",
      serviceSignal: true,
    },
    {
      patterns: [/\bgenerator\b/, /\binterlock\b/],
      answer: "Yep - we do generator hookups and interlocks. That's usually a free estimate.",
      serviceSignal: true,
    },
    {
      patterns: [/\bpermit\b/, /\bpermitting\b/],
      answer: "We're licensed and can take care of permitting if you want one.",
    },
    {
      patterns: [/\bfinancing\b/, /\bfinance\b/],
      answer: "Yep - we offer financing options.",
    },
    {
      patterns: [/\bcall me\b/, /\bphone call\b/, /\btalk over the phone\b/],
      answer: "yep, call 586-489-1504 and we can handle it there.",
      pivotOverride: "want to get it scheduled?",
    },
    {
      patterns: [/\bafter a storm\b/, /\bpost storm\b/, /\bafter the power outage\b/],
      answer: "First thing - stay clear of any damaged wires or flooding near outlets. If the mast, meter, breakers, or outlets look damaged, we should get it scheduled.",
    },
    {
      patterns: [/\bbefore a storm\b/, /\bpre storm\b/, /\bhigh wind\b/, /\bstorm prep\b/],
      answer: "Best quick checks are the mast, nearby tree limbs, sump pump, and surge protection. If anything looks loose or sketchy, we should get it scheduled.",
    },
    {
      patterns: [/\bdowned line\b/, /\bwire down\b/],
      answer: "Stay at least 25 feet away and treat it like it's live.",
    },
    {
      patterns: [/\bflooded basement\b/, /\bwater reached outlets\b/],
      answer: "Don't go in if water reached outlets or cords.",
    },
    {
      patterns: [/\bburning smell\b/, /\bburnt plastic\b/, /\bozone smell\b/, /\bfishy smell\b/],
      answer: "Turn off the main if it's safe, then get outside.",
    },
    {
      patterns: [/\bbreaker.*reset\b/, /\btrips again\b/],
      answer: "Flip it fully off, then back on once. If it trips again, stop there.",
    },
    {
      patterns: [/\bgfci\b/, /\breset outlet\b/],
      answer: "Check the GFCIs in the kitchen, bath, garage, and outside first.",
    },
    {
      patterns: [/\bsump pump\b/],
      answer: "Make sure it's plugged in and the outlet didn't trip. If it got submerged, it needs to be checked before using it.",
    },
  ];

  for (const matcher of matchers) {
    if (matcher.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        answer: matcher.answer,
        pivotOverride: matcher.pivotOverride,
        serviceSignal: matcher.serviceSignal,
        suppressAutoPivot: matcher.suppressAutoPivot,
      };
    }
  }

  return undefined;
}

export function buildKnowledgePivot(): string {
  return KNOWLEDGE_BASE_DRAFT.bookingPivot.defaultPhrase;
}
