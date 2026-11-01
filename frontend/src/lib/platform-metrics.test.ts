import { describe, expect, it } from "vitest";
import { RANGE_QUERIES, formatBytes, formatCores, formatLatency, formatRate, formatShare, isRange, isService, toSeries, toValues } from "./platform-metrics";

describe("reading a matrix", () => {
  const matrix = [
    { metric: { job: "user" }, values: [[1, "0.5"], [2, "NaN"], [3, "1.5"]] as [number, string][] },
    { metric: { job: "gateway" }, values: [[1, "2"]] as [number, string][] },
    { metric: { job: "ghost" }, values: [[1, "NaN"]] as [number, string][] },
  ];

  it("names series by the label, sorts them and drops empty ratios", () => {
    const series = toSeries(matrix, "job", "total");
    expect(series.map((entry) => entry.name)).toEqual(["gateway", "user"]);
    expect(series[1]!.points).toEqual([[1, 0.5], [3, 1.5]]);
  });

  it("uses the fallback name for a query with no label, and can filter names", () => {
    expect(toSeries([{ metric: {}, values: [[1, "3"]] }], "", "in")[0]!.name).toBe("in");
    expect(toSeries(matrix, "job", "x", (name) => name === "user")).toHaveLength(1);
  });
});

describe("reading a vector", () => {
  it("maps a label to its number and skips what is not a number", () => {
    const values = toValues([{ metric: { service: "user" }, value: [1, "0.25"] }, { metric: { service: "judge" }, value: [1, "NaN"] }, { metric: {}, value: [1, "9"] }], "service");
    expect([...values]).toEqual([["user", 0.25]]);
  });

  it("returns the single value of an unlabelled query", () => {
    expect(toValues([{ metric: {}, value: [1, "7"] }], "").get("value")).toBe(7);
  });
});

describe("what is allowed", () => {
  it("knows the ranges and the services", () => {
    expect(isRange("1h")).toBe(true);
    expect(isRange("30d")).toBe(false);
    expect(isRange(null)).toBe(false);
    expect(isService("question-bank")).toBe(true);
    expect(isService("nats")).toBe(false);
  });

  it("only queries the aethercode namespace", () => {
    for (const { query } of Object.values(RANGE_QUERIES)) {
      if (/container_|http_|db_pool/.test(query)) expect(query).toContain('namespace="aethercode"');
    }
  });
});

describe("formatting", () => {
  it("reads naturally", () => {
    expect(formatBytes(198_029_312)).toBe("189 MiB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatRate(0.456)).toBe("0.46/s");
    expect(formatRate(1234)).toBe("1234/s");
    expect(formatRate(12.34)).toBe("12/s");
    expect(formatRate(2.34)).toBe("2.3/s");
    expect(formatLatency(0.0421)).toBe("42 ms");
    expect(formatLatency(1.5)).toBe("1.50 s");
    expect(formatCores(0.002)).toBe("2m");
    expect(formatCores(1.2345)).toBe("1.23");
    expect(formatShare(0.0123)).toBe("1.2%");
    expect(formatShare(0.456)).toBe("46%");
  });
});
