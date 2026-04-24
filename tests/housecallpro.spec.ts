import { afterEach, describe, expect, it, vi } from "vitest";
import { HousecallProClient } from "../src/integrations/housecallPro.js";

describe("HousecallProClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("includes the customer's email and additional items in the submitted lead note", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "lead_123" }),
      text: async () => "",
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new HousecallProClient({
      token: "test-token",
      baseUrl: "https://example.com",
      customerPath: "/customers",
      createLeadPath: "/leads",
    } as never);

    vi.spyOn(client, "findOrCreateCustomer").mockResolvedValue("cust_123");

    const result = await client.createLead({
      customer: {
        firstName: "Nate",
        phone: "586-555-1212",
        email: "nate@example.com",
        address: "53617 Oak Grove",
        city: "Shelby Township",
        zipCode: "48315",
        bookSmartQualifiers: {
          relatedWork: "also wants two exterior outlets checked",
          customerConcerns: "asked whether surge protection makes sense",
        },
      },
      serviceName: "General troubleshooting",
      requestedWindow: "morning",
      notes: "The ceiling is pretty high",
    });

    expect(result.id).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      customer_id: "cust_123",
      note: expect.stringContaining("Email: nate@example.com"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      note: expect.stringContaining("Also wants looked at: also wants two exterior outlets checked"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      note: expect.stringContaining("Concerns/questions: asked whether surge protection makes sense"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      note: expect.stringContaining("Tech prep notes: The ceiling is pretty high"),
    });
  });

  it("best-effort syncs email onto an existing HCP customer before reusing the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cust_123" }),
      text: async () => "",
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new HousecallProClient({
      token: "test-token",
      baseUrl: "https://example.com",
      customerPath: "/customers",
      createLeadPath: "/leads",
    } as never);

    vi.spyOn(client as never, "findCustomer").mockResolvedValue({ id: "cust_123" });

    const result = await client.findOrCreateCustomer({
      firstName: "Nate",
      phone: "586-555-1212",
      email: "nate@example.com",
      address: "53617 Oak Grove",
      city: "Shelby Township",
      zipCode: "48315",
    });

    expect(result).toBe("cust_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/customers/cust_123");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      email: "nate@example.com",
    });
  });
});
