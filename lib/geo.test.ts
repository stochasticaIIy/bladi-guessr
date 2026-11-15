import { describe, expect, it } from "vitest";
import { haversineKm, isValidLatLng } from "./geo";

const MARRAKECH = { lat: 31.6295, lng: -7.9811 };
const CASABLANCA = { lat: 33.5731, lng: -7.5898 };

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(MARRAKECH, MARRAKECH)).toBe(0);
  });

  it("is symmetric", () => {
    expect(haversineKm(MARRAKECH, CASABLANCA)).toBeCloseTo(haversineKm(CASABLANCA, MARRAKECH), 9);
  });

  it("matches a known distance (~219 km Marrakech to Casablanca)", () => {
    const km = haversineKm(MARRAKECH, CASABLANCA);
    expect(km).toBeGreaterThan(210);
    expect(km).toBeLessThan(230);
  });

  it("handles antimeridian and pole distances", () => {
    expect(haversineKm({ lat: 0, lng: 179 }, { lat: 0, lng: -179 })).toBeCloseTo(222.4, 0);
    expect(haversineKm({ lat: -90, lng: 0 }, { lat: 90, lng: 0 })).toBeCloseTo(20015, -1);
  });
});

describe("isValidLatLng", () => {
  it("accepts real coordinates", () => {
    expect(isValidLatLng(MARRAKECH)).toBe(true);
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(true);
  });

  it("rejects out-of-range, non-numeric and malformed input", () => {
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidLatLng({ lat: "31", lng: "-7" })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: Number.POSITIVE_INFINITY, lng: 0 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng([])).toBe(false);
  });
});
