const ZIP_MAP: Record<string, { city: string; county: "Macomb" | "Oakland" }> = {
  // Macomb County
  "48001": { city: "Algonac", county: "Macomb" },
  "48002": { city: "Allenton", county: "Macomb" },
  "48003": { city: "Armada", county: "Macomb" },
  "48005": { city: "Armada", county: "Macomb" },
  "48014": { city: "Capac", county: "Macomb" },
  "48021": { city: "Eastpointe", county: "Macomb" },
  "48022": { city: "Emmett", county: "Macomb" },
  "48023": { city: "Fair Haven", county: "Macomb" },
  "48026": { city: "Fraser", county: "Macomb" },
  "48035": { city: "Clinton Township", county: "Macomb" },
  "48036": { city: "Clinton Township", county: "Macomb" },
  "48038": { city: "Clinton Township", county: "Macomb" },
  "48039": { city: "Marine City", county: "Macomb" },
  "48041": { city: "Memphis", county: "Macomb" },
  "48042": { city: "Macomb Township", county: "Macomb" },
  "48043": { city: "Mount Clemens", county: "Macomb" },
  "48044": { city: "Macomb Township", county: "Macomb" },
  "48045": { city: "Harrison Township", county: "Macomb" },
  "48047": { city: "New Baltimore", county: "Macomb" },
  "48048": { city: "New Haven", county: "Macomb" },
  "48050": { city: "New Haven", county: "Macomb" },
  "48051": { city: "New Baltimore", county: "Macomb" },
  "48059": { city: "Richmond", county: "Macomb" },
  "48062": { city: "Richmond", county: "Macomb" },
  "48065": { city: "Romeo", county: "Macomb" },
  "48066": { city: "Roseville", county: "Macomb" },
  "48080": { city: "St. Clair Shores", county: "Macomb" },
  "48081": { city: "St. Clair Shores", county: "Macomb" },
  "48082": { city: "St. Clair Shores", county: "Macomb" },
  "48088": { city: "Warren", county: "Macomb" },
  "48089": { city: "Warren", county: "Macomb" },
  "48090": { city: "Warren", county: "Macomb" },
  "48091": { city: "Warren", county: "Macomb" },
  "48092": { city: "Warren", county: "Macomb" },
  "48093": { city: "Warren", county: "Macomb" },
  "48094": { city: "Washington Township", county: "Macomb" },
  "48095": { city: "Washington Township", county: "Macomb" },
  "48096": { city: "Ray Township", county: "Macomb" },
  "48310": { city: "Sterling Heights", county: "Macomb" },
  "48311": { city: "Sterling Heights", county: "Macomb" },
  "48312": { city: "Sterling Heights", county: "Macomb" },
  "48313": { city: "Sterling Heights", county: "Macomb" },
  "48314": { city: "Sterling Heights", county: "Macomb" },
  "48315": { city: "Shelby Township", county: "Macomb" },
  "48316": { city: "Shelby Township", county: "Macomb" },
  "48317": { city: "Utica", county: "Macomb" },
  "48318": { city: "Utica", county: "Macomb" },
  // Oakland County
  "48009": { city: "Birmingham", county: "Oakland" },
  "48017": { city: "Clawson", county: "Oakland" },
  "48030": { city: "Hazel Park", county: "Oakland" },
  "48033": { city: "Southfield", county: "Oakland" },
  "48034": { city: "Southfield", county: "Oakland" },
  "48067": { city: "Royal Oak", county: "Oakland" },
  "48068": { city: "Royal Oak", county: "Oakland" },
  "48069": { city: "Pleasant Ridge", county: "Oakland" },
  "48070": { city: "Huntington Woods", county: "Oakland" },
  "48071": { city: "Madison Heights", county: "Oakland" },
  "48072": { city: "Berkley", county: "Oakland" },
  "48073": { city: "Royal Oak", county: "Oakland" },
  "48075": { city: "Southfield", county: "Oakland" },
  "48076": { city: "Southfield", county: "Oakland" },
  "48083": { city: "Troy", county: "Oakland" },
  "48084": { city: "Troy", county: "Oakland" },
  "48085": { city: "Troy", county: "Oakland" },
  "48098": { city: "Troy", county: "Oakland" },
  "48099": { city: "Troy", county: "Oakland" },
  "48220": { city: "Ferndale", county: "Oakland" },
  "48221": { city: "Detroit (Oakland border)", county: "Oakland" },
  "48237": { city: "Oak Park", county: "Oakland" },
  "48301": { city: "Bloomfield Hills", county: "Oakland" },
  "48302": { city: "Bloomfield Township", county: "Oakland" },
  "48303": { city: "Bloomfield Hills", county: "Oakland" },
  "48304": { city: "Bloomfield Hills", county: "Oakland" },
  "48306": { city: "Rochester Hills", county: "Oakland" },
  "48307": { city: "Rochester", county: "Oakland" },
  "48308": { city: "Rochester", county: "Oakland" },
  "48309": { city: "Rochester Hills", county: "Oakland" },
  "48320": { city: "Keego Harbor", county: "Oakland" },
  "48321": { city: "Auburn Hills", county: "Oakland" },
  "48322": { city: "West Bloomfield", county: "Oakland" },
  "48323": { city: "West Bloomfield", county: "Oakland" },
  "48324": { city: "West Bloomfield", county: "Oakland" },
  "48326": { city: "Auburn Hills", county: "Oakland" },
  "48327": { city: "Waterford", county: "Oakland" },
  "48328": { city: "Waterford", county: "Oakland" },
  "48329": { city: "Waterford", county: "Oakland" },
  "48330": { city: "Drayton Plains", county: "Oakland" },
  "48331": { city: "Farmington Hills", county: "Oakland" },
  "48332": { city: "Farmington", county: "Oakland" },
  "48333": { city: "Farmington", county: "Oakland" },
  "48334": { city: "Farmington Hills", county: "Oakland" },
  "48335": { city: "Farmington Hills", county: "Oakland" },
  "48336": { city: "Farmington", county: "Oakland" },
  "48340": { city: "Pontiac", county: "Oakland" },
  "48341": { city: "Pontiac", county: "Oakland" },
  "48342": { city: "Pontiac", county: "Oakland" },
  "48343": { city: "Pontiac", county: "Oakland" },
  "48346": { city: "Clarkston", county: "Oakland" },
  "48347": { city: "Clarkston", county: "Oakland" },
  "48348": { city: "Clarkston", county: "Oakland" },
  "48350": { city: "Davisburg", county: "Oakland" },
  "48356": { city: "Highland", county: "Oakland" },
  "48357": { city: "Highland", county: "Oakland" },
  "48359": { city: "Lake Orion", county: "Oakland" },
  "48360": { city: "Lake Orion", county: "Oakland" },
  "48361": { city: "Lake Orion", county: "Oakland" },
  "48362": { city: "Lake Orion", county: "Oakland" },
  "48363": { city: "Oakland Township", county: "Oakland" },
  "48366": { city: "Lakeville", county: "Oakland" },
  "48367": { city: "Leonard", county: "Oakland" },
  "48370": { city: "Oxford", county: "Oakland" },
  "48371": { city: "Oxford", county: "Oakland" },
  "48374": { city: "Novi", county: "Oakland" },
  "48375": { city: "Novi", county: "Oakland" },
  "48376": { city: "Novi", county: "Oakland" },
  "48377": { city: "Novi", county: "Oakland" },
  "48380": { city: "Milford", county: "Oakland" },
  "48381": { city: "Milford", county: "Oakland" },
  "48382": { city: "Commerce Township", county: "Oakland" },
  "48383": { city: "White Lake", county: "Oakland" },
  "48386": { city: "White Lake", county: "Oakland" },
  "48387": { city: "Union Lake", county: "Oakland" },
  "48390": { city: "Walled Lake", county: "Oakland" },
  "48391": { city: "Walled Lake", county: "Oakland" },
  "48393": { city: "Wixom", county: "Oakland" },
  "48442": { city: "Holly", county: "Oakland" },
  "48462": { city: "Ortonville", county: "Oakland" },
};

function zipKeyFromInput(zip: string | undefined): string | undefined {
  if (!zip?.trim()) {
    return undefined;
  }
  const digits = zip.replace(/\D/g, "");
  if (digits.length < 5) {
    return undefined;
  }
  return digits.slice(0, 5);
}

export function lookupZip(
  zip: string,
): { city: string; county: "Macomb" | "Oakland" } | undefined {
  const key = zipKeyFromInput(zip);
  if (!key) {
    return undefined;
  }
  return ZIP_MAP[key];
}

export function isValidServiceZip(zip: string): boolean {
  const key = zipKeyFromInput(zip);
  if (!key) {
    return false;
  }
  return key in ZIP_MAP;
}
