import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const gateway = vi.fn();
vi.mock("./gateway", () => ({ gateway: (...args: unknown[]) => gateway(...args) }));

import { MAX_PAGES, fetchAllPages } from "./fetch-all";

beforeEach(() => gateway.mockReset());

describe("fetchAllPages", () => {
  it("walks next_cursor until it is empty and joins the items", async () => {
    gateway
      .mockResolvedValueOnce({ items: [1, 2], next_cursor: "a b" })
      .mockResolvedValueOnce({ items: [3], next_cursor: "c" })
      .mockResolvedValueOnce({ items: [4] });
    expect(await fetchAllPages<number>("/x/list")).toEqual([1, 2, 3, 4]);
    expect(gateway.mock.calls.map((call) => call[0])).toEqual(["/x/list?limit=100", "/x/list?limit=100&cursor=a%20b", "/x/list?limit=100&cursor=c"]);
  });

  it("appends to an existing query and forwards headers", async () => {
    gateway.mockResolvedValueOnce({ items: [] });
    await fetchAllPages("/x/list?role=a", { headers: { "X-Tenant-ID": "t" } });
    expect(gateway).toHaveBeenCalledWith("/x/list?role=a&limit=100", { headers: { "X-Tenant-ID": "t" } });
  });

  it("propagates a gateway error instead of returning a partial list", async () => {
    gateway.mockResolvedValueOnce({ items: [1], next_cursor: "n" }).mockRejectedValueOnce(new Error("boom"));
    await expect(fetchAllPages("/x")).rejects.toThrow("boom");
  });

  it("refuses to truncate when the cap is hit", async () => {
    gateway.mockResolvedValue({ items: [1], next_cursor: "more" });
    await expect(fetchAllPages("/x")).rejects.toThrow(/truncated/);
    expect(gateway).toHaveBeenCalledTimes(MAX_PAGES);
  });
});
