import { vi } from "vitest";

vi.mock("../src/integrations/housecallPro.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/integrations/housecallPro.js")>();
  return {
    ...mod,
    lookupCustomerByPhone: vi.fn().mockResolvedValue({ found: false }),
  };
});
