import { County } from "./types.js";

const MACOMB_ZIPS = new Set([
  "48005", "48015", "48021", "48026", "48035", "48036", "48038", "48042",
  "48043", "48044", "48045", "48047", "48048", "48051", "48062", "48065",
  "48066", "48080", "48081", "48082", "48088", "48089", "48091", "48092",
  "48093", "48094", "48310", "48312", "48313", "48314", "48315", "48316",
  "48317",
]);

const OAKLAND_ZIPS = new Set([
  "48009", "48012", "48017", "48025", "48030", "48033", "48034", "48037",
  "48067", "48069", "48071", "48073", "48075", "48076", "48083", "48084",
  "48085", "48098", "48301", "48302", "48304", "48306", "48307", "48309",
  "48320", "48322", "48323", "48324", "48326", "48327", "48328", "48329",
  "48331", "48334", "48335", "48336", "48340", "48341", "48342", "48346",
  "48348", "48356", "48357", "48359", "48360", "48362", "48363", "48367",
  "48371", "48374", "48375", "48377", "48381", "48382", "48383", "48386",
  "48390", "48393",
]);

const ZIP_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "48009": { lat: 42.5467, lng: -83.2166 },
  "48017": { lat: 42.5378, lng: -83.1346 },
  "48021": { lat: 42.4653, lng: -82.9493 },
  "48035": { lat: 42.5515, lng: -82.9076 },
  "48036": { lat: 42.5931, lng: -82.8906 },
  "48038": { lat: 42.6054, lng: -82.9704 },
  "48042": { lat: 42.6178, lng: -82.9893 },
  "48044": { lat: 42.6283, lng: -82.9333 },
  "48045": { lat: 42.5764, lng: -82.8402 },
  "48066": { lat: 42.4792, lng: -82.9387 },
  "48071": { lat: 42.5031, lng: -83.1030 },
  "48073": { lat: 42.5173, lng: -83.1473 },
  "48076": { lat: 42.5280, lng: -83.2291 },
  "48080": { lat: 42.4645, lng: -82.9007 },
  "48081": { lat: 42.4921, lng: -82.9005 },
  "48082": { lat: 42.5298, lng: -82.8843 },
  "48083": { lat: 42.5570, lng: -83.1144 },
  "48084": { lat: 42.5595, lng: -83.1846 },
  "48085": { lat: 42.5804, lng: -83.1272 },
  "48088": { lat: 42.5140, lng: -82.9670 },
  "48089": { lat: 42.4681, lng: -82.9933 },
  "48091": { lat: 42.4734, lng: -83.0587 },
  "48092": { lat: 42.5145, lng: -83.0637 },
  "48093": { lat: 42.5150, lng: -83.0303 },
  "48094": { lat: 42.6832, lng: -83.0368 },
  "48301": { lat: 42.5466, lng: -83.3020 },
  "48302": { lat: 42.5839, lng: -83.2910 },
  "48304": { lat: 42.5902, lng: -83.2294 },
  "48306": { lat: 42.7318, lng: -83.1459 },
  "48307": { lat: 42.6658, lng: -83.1285 },
  "48309": { lat: 42.6512, lng: -83.1803 },
  "48310": { lat: 42.5647, lng: -83.0697 },
  "48312": { lat: 42.5607, lng: -83.0315 },
  "48313": { lat: 42.6074, lng: -83.0363 },
  "48314": { lat: 42.6107, lng: -83.0093 },
  "48315": { lat: 42.6658, lng: -82.9933 },
  "48316": { lat: 42.6877, lng: -83.0535 },
  "48317": { lat: 42.6344, lng: -83.0578 },
  "48320": { lat: 42.6126, lng: -83.3360 },
  "48322": { lat: 42.5427, lng: -83.3832 },
  "48323": { lat: 42.5718, lng: -83.3791 },
  "48324": { lat: 42.5932, lng: -83.4013 },
  "48326": { lat: 42.6698, lng: -83.2451 },
  "48327": { lat: 42.6461, lng: -83.4370 },
  "48328": { lat: 42.6456, lng: -83.3505 },
  "48329": { lat: 42.6933, lng: -83.3890 },
  "48331": { lat: 42.5166, lng: -83.4031 },
  "48334": { lat: 42.5048, lng: -83.3344 },
  "48335": { lat: 42.4643, lng: -83.3966 },
  "48336": { lat: 42.4616, lng: -83.3499 },
  "48340": { lat: 42.6753, lng: -83.2916 },
  "48341": { lat: 42.6566, lng: -83.2990 },
  "48342": { lat: 42.6737, lng: -83.2753 },
  "48346": { lat: 42.6554, lng: -83.3713 },
  "48348": { lat: 42.7702, lng: -83.3669 },
  "48356": { lat: 42.6561, lng: -83.6346 },
  "48357": { lat: 42.6475, lng: -83.5253 },
  "48359": { lat: 42.7149, lng: -83.2746 },
  "48360": { lat: 42.7427, lng: -83.2728 },
  "48362": { lat: 42.7787, lng: -83.2483 },
  "48363": { lat: 42.7801, lng: -83.1607 },
  "48367": { lat: 42.6966, lng: -83.1383 },
  "48371": { lat: 42.8448, lng: -83.2932 },
  "48374": { lat: 42.4624, lng: -83.5279 },
  "48375": { lat: 42.4618, lng: -83.4702 },
  "48377": { lat: 42.4982, lng: -83.4740 },
  "48381": { lat: 42.5722, lng: -83.5986 },
  "48382": { lat: 42.5614, lng: -83.5300 },
  "48383": { lat: 42.6738, lng: -83.5417 },
  "48386": { lat: 42.6718, lng: -83.4823 },
  "48390": { lat: 42.5625, lng: -83.4794 },
  "48393": { lat: 42.5125, lng: -83.5245 },
};

export function detectCounty(zipCode: string): County {
  const normalized = normalizeZip(zipCode);
  if (MACOMB_ZIPS.has(normalized)) {
    return "macomb";
  }
  if (OAKLAND_ZIPS.has(normalized)) {
    return "oakland";
  }
  return "other";
}

export function normalizeZip(zipCode: string): string {
  return zipCode.replace(/\D/g, "").slice(0, 5);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMiles(fromZip: string, toZip: string): number | null {
  const from = ZIP_COORDINATES[normalizeZip(fromZip)];
  const to = ZIP_COORDINATES[normalizeZip(toZip)];

  if (!from || !to) {
    return null;
  }

  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

export function estimateDriveMinutes(fromZip: string, toZip: string): number {
  const miles = distanceMiles(fromZip, toZip);
  if (miles !== null) {
    return Math.max(15, Math.round((miles / 28) * 60));
  }

  const fromCounty = detectCounty(fromZip);
  const toCounty = detectCounty(toZip);
  if (fromCounty === toCounty && fromCounty !== "other") {
    return 30;
  }
  if (fromCounty !== "other" && toCounty !== "other") {
    return 45;
  }
  return 60;
}
