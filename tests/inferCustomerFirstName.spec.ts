import { describe, expect, it } from "vitest";
import {
  inferCustomerFirstName,
  needsExplicitFirstNameCollection,
  resolveCustomerFirstName,
  tryAcceptFirstNameWithoutAsking,
} from "../src/lib/inferCustomerFirstName.js";

describe("inferCustomerFirstName", () => {
  it("parses introduction patterns", () => {
    expect(inferCustomerFirstName("I'm Marshall")).toBe("Marshall");
    expect(inferCustomerFirstName("my name is jane")).toBe("Jane");
    expect(inferCustomerFirstName("call me Sam")).toBe("Sam");
  });

  it("does not use greetings or fillers as names", () => {
    expect(inferCustomerFirstName("Hi, I need someone for an outlet")).toBe("Neighbor");
    expect(inferCustomerFirstName("So we're having breaker issues")).toBe("Neighbor");
    expect(inferCustomerFirstName("Well the lights flicker")).toBe("Neighbor");
  });

  it("uses channel email when the message reads like a job description", () => {
    expect(
      inferCustomerFirstName("So my breaker keeps tripping", "marshall.ochylski@gmail.com"),
    ).toBe("Marshall");
  });

  it("still prefers an explicit introduction over email fallback", () => {
    expect(
      inferCustomerFirstName("I'm Alex — breaker blew", "other@example.com"),
    ).toBe("Alex");
  });

  it("accepts a plain single-name reply", () => {
    expect(inferCustomerFirstName("Pat")).toBe("Pat");
    expect(inferCustomerFirstName("  O'Brien ")).toBe("O'Brien");
  });

  it("falls back politely when inference fails", () => {
    expect(inferCustomerFirstName("yeah idk")).toBe("Neighbor");
    expect(inferCustomerFirstName("", "noreply@gmail.com")).toBe("Neighbor");
  });

  it("does not treat 'Looking to get…' job description as a first name", () => {
    const msg =
      "Looking to get 2 smart switches and 1 replacement regular switch";
    expect(inferCustomerFirstName(msg)).toBe("Neighbor");
    expect(inferCustomerFirstName(msg, "johnk8684@yahoo.com")).toBe("Johnk");
  });

  it("does not use the word Looking as a name when it is a sentence starter", () => {
    expect(inferCustomerFirstName("Looking for an electrician this week")).toBe("Neighbor");
    expect(inferCustomerFirstName("Looking")).toBe("Neighbor");
  });
});

describe("needsExplicitFirstNameCollection", () => {
  it("treats placeholder inference garbage as missing", () => {
    expect(needsExplicitFirstNameCollection(undefined)).toBe(true);
    expect(needsExplicitFirstNameCollection("")).toBe(true);
    expect(needsExplicitFirstNameCollection("Looking")).toBe(true);
    expect(needsExplicitFirstNameCollection("neighbor")).toBe(true);
    expect(needsExplicitFirstNameCollection("John")).toBe(false);
  });
});

describe("tryAcceptFirstNameWithoutAsking", () => {
  it("accepts introductions and single-token names only", () => {
    expect(tryAcceptFirstNameWithoutAsking("I'm Kerry")).toBe("Kerry");
    expect(tryAcceptFirstNameWithoutAsking("Lou")).toBe("Lou");
    expect(
      tryAcceptFirstNameWithoutAsking(
        "Looking to get 2 smart switches and a replacement",
      ),
    ).toBeUndefined();
    expect(
      tryAcceptFirstNameWithoutAsking("I'd like an electrician sometime next week"),
    ).toBeUndefined();
  });
});

describe("resolveCustomerFirstName", () => {
  it("prefers email local when stored first name is a placeholder", () => {
    expect(resolveCustomerFirstName("Looking", "johnk8684@yahoo.com")).toBe("Johnk");
    expect(resolveCustomerFirstName("Neighbor", "johnk8684@yahoo.com")).toBe("Johnk");
  });

  it("keeps an explicit first name when email is present", () => {
    expect(resolveCustomerFirstName("John", "johnk8684@yahoo.com")).toBe("John");
  });
});
