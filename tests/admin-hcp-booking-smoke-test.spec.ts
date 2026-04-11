import { describe, expect, it, vi } from "vitest";
import handler from "../api/admin/hcp-booking-smoke-test.js";
import { HousecallProClient } from "../src/integrations/housecallPro.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(payload: string) {
      this.body = payload;
      return this;
    },
  };
}

describe("admin HCP booking smoke test API", () => {
  it("returns setup instructions on GET", async () => {
    const res = createResponseRecorder();

    await handler(
      {
        method: "GET",
        headers: {},
        query: {},
      } as never,
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("POST a fully specified smoke-test payload");
    expect(res.body).toContain("\"examplePayload\"");
  });

  it("attempts a real create through the HCP client on POST", async () => {
    const createSpy = vi.spyOn(HousecallProClient.prototype, "createBooking").mockResolvedValue({
      id: "job_smoke_123",
    });
    const res = createResponseRecorder();

    await handler(
      {
        method: "POST",
        headers: {},
        query: {},
        body: {
          firstName: "BookSmart",
          phone: "5551112222",
          zipCode: "48313",
          serviceName: "Breaker tripping smoke test",
          technician: "Nate",
          target: "job",
          start: "2026-04-12T13:00:00.000Z",
          end: "2026-04-12T17:00:00.000Z",
        },
      } as never,
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(createSpy).toHaveBeenCalledOnce();
    expect(res.body).toContain("\"id\":\"job_smoke_123\"");

    createSpy.mockRestore();
  });

  it("validates required payload fields", async () => {
    const res = createResponseRecorder();

    await handler(
      {
        method: "POST",
        headers: {},
        query: {},
        body: {
          firstName: "BookSmart",
        },
      } as never,
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Missing required field");
  });
});
