import { DEFAULT_BOOKSMART_CONFIG } from "./defaultConfig.js";
import { bookSmartConfigSchema } from "./schema.js";
import { BookSmartConfig } from "./types.js";
import { AppError } from "../lib/errors.js";
import { StorageAdapter } from "../storage/types.js";

export async function loadBookSmartConfig(storage: StorageAdapter): Promise<BookSmartConfig> {
  const stored = await storage.getBookSmartConfig();
  if (!stored) {
    return DEFAULT_BOOKSMART_CONFIG;
  }

  return mergeBookSmartConfig(DEFAULT_BOOKSMART_CONFIG, stored);
}

export async function seedBookSmartConfig(storage: StorageAdapter): Promise<BookSmartConfig> {
  const existing = await storage.getBookSmartConfig();
  if (existing) {
    return mergeBookSmartConfig(DEFAULT_BOOKSMART_CONFIG, existing);
  }

  await storage.storeBookSmartConfig(DEFAULT_BOOKSMART_CONFIG);
  return DEFAULT_BOOKSMART_CONFIG;
}

export async function saveBookSmartConfig(
  storage: StorageAdapter,
  config: unknown,
): Promise<BookSmartConfig> {
  const parsed = bookSmartConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new AppError(
      "Invalid BookSmart config",
      400,
      "The BookSmart config payload is invalid.",
    );
  }

  const normalized = normalizeBookSmartConfig(parsed.data);
  await storage.storeBookSmartConfig(normalized);
  return normalized;
}

function mergeBookSmartConfig(
  defaults: BookSmartConfig,
  stored: BookSmartConfig,
): BookSmartConfig {
  return {
    serviceTypes: stored.serviceTypes?.length ? stored.serviceTypes : defaults.serviceTypes,
    serviceAreas: {
      ...defaults.serviceAreas,
      ...stored.serviceAreas,
      allowedCities: stored.serviceAreas?.allowedCities?.length
        ? stored.serviceAreas.allowedCities
        : defaults.serviceAreas.allowedCities,
      restrictedCities: stored.serviceAreas?.restrictedCities ?? defaults.serviceAreas.restrictedCities,
    },
    urgencyKeywords: stored.urgencyKeywords?.length
      ? stored.urgencyKeywords
      : defaults.urgencyKeywords,
    bookingRules: {
      ...defaults.bookingRules,
      ...stored.bookingRules,
      allowedWindows: stored.bookingRules?.allowedWindows?.length
        ? stored.bookingRules.allowedWindows
        : defaults.bookingRules.allowedWindows,
    },
    conversation: {
      ...defaults.conversation,
      ...stored.conversation,
      requestPhotosFor: stored.conversation?.requestPhotosFor?.length
        ? stored.conversation.requestPhotosFor
        : defaults.conversation.requestPhotosFor,
    },
  };
}

function normalizeBookSmartConfig(config: BookSmartConfig): BookSmartConfig {
  return {
    ...config,
    serviceTypes: config.serviceTypes.map((serviceType) => ({
      ...serviceType,
      displayName: serviceType.displayName.trim(),
      classifierPhrases: uniqStrings(serviceType.classifierPhrases),
      requestedServiceLabel: serviceType.requestedServiceLabel.trim(),
    })),
    serviceAreas: {
      ...config.serviceAreas,
      allowedCities: uniqStrings(config.serviceAreas.allowedCities).map(normalizeCity),
      restrictedCities: uniqStrings(config.serviceAreas.restrictedCities).map(normalizeCity),
    },
    urgencyKeywords: config.urgencyKeywords.map((keyword) => ({
      ...keyword,
      phrase: keyword.phrase.trim().toLowerCase(),
    })),
    conversation: {
      ...config.conversation,
      openingQuestion: config.conversation.openingQuestion.trim(),
      handoffMessage: config.conversation.handoffMessage.trim(),
    },
  };
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeCity(value: string): string {
  return value.trim().toLowerCase();
}
