import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockS3 } = vi.hoisted(() => ({
  mockPrisma: { appSetting: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() } },
  mockS3: { getObjectTextOrNull: vi.fn(), putObject: vi.fn(), deleteObject: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/s3", () => mockS3);

import {
  checkStorageMarker,
  createStorageMarker,
  STORAGE_MARKER_KEY,
  STORAGE_MARKER_SETTING,
} from "@/lib/storage-marker";

function state(db: string | null, bucket: string | null) {
  mockPrisma.appSetting.findUnique.mockResolvedValue(db === null ? null : { key: STORAGE_MARKER_SETTING, value: db });
  mockS3.getObjectTextOrNull.mockResolvedValue(bucket);
}
const json = (id: string) => JSON.stringify({ instanceId: id });

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.appSetting.create.mockResolvedValue({});
  mockPrisma.appSetting.delete.mockResolvedValue({});
  mockS3.putObject.mockResolvedValue(undefined);
  mockS3.deleteObject.mockResolvedValue(undefined);
});

describe("checkStorageMarker", () => {
  it("lives outside attachments/, so the cleanup listing never sees it", () => {
    expect(STORAGE_MARKER_KEY.startsWith("attachments/")).toBe(false);
  });

  it("ok when both halves hold the same id", async () => {
    state("abc", json("abc"));
    expect(await checkStorageMarker()).toEqual({ ok: true });
  });

  it.each([
    ["neither half", null, null, "marker_not_set_up"],
    ["bucket only", null, json("abc"), "marker_missing_in_database"],
    ["database only", "abc", null, "marker_missing_in_storage"],
    ["different ids", "abc", json("xyz"), "marker_mismatch"],
    ["unreadable bucket file", "abc", "not json", "marker_mismatch"],
    ["bucket file without an id", "abc", "{}", "marker_mismatch"],
  ])("%s → %s", async (_label, db, bucket, problem) => {
    state(db, bucket);
    expect(await checkStorageMarker()).toEqual({ ok: false, problem });
  });

  it("an unreadable bucket file with no database row is not 'not set up'", async () => {
    state(null, "garbage");
    expect(await checkStorageMarker()).toEqual({ ok: false, problem: "marker_missing_in_database" });
  });

  it("propagates read errors instead of treating them as a match", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ key: STORAGE_MARKER_SETTING, value: "abc" });
    mockS3.getObjectTextOrNull.mockRejectedValue(new Error("SignatureDoesNotMatch"));
    await expect(checkStorageMarker()).rejects.toThrow("SignatureDoesNotMatch");
  });
});

describe("createStorageMarker", () => {
  it("writes the same new id to the database and then the bucket", async () => {
    state(null, null);
    expect(await createStorageMarker()).toEqual({ created: true });

    const dbValue = mockPrisma.appSetting.create.mock.calls[0][0].data;
    expect(dbValue.key).toBe(STORAGE_MARKER_SETTING);
    expect(dbValue.value).toMatch(/^[0-9a-f-]{36}$/);

    const [key, body, type] = mockS3.putObject.mock.calls[0];
    expect(key).toBe(STORAGE_MARKER_KEY);
    expect(JSON.parse(body.toString())).toEqual({ instanceId: dbValue.value });
    expect(type).toBe("application/json");

    expect(mockPrisma.appSetting.create.mock.invocationCallOrder[0]).toBeLessThan(
      mockS3.putObject.mock.invocationCallOrder[0]
    );
  });

  it("refuses when already set up and writes nothing", async () => {
    state("abc", json("abc"));
    expect(await createStorageMarker()).toEqual({ created: false, problem: "already_set_up" });
    expect(mockPrisma.appSetting.create).not.toHaveBeenCalled();
    expect(mockS3.putObject).not.toHaveBeenCalled();
  });

  it.each([
    [null, json("abc"), "marker_missing_in_database"],
    ["abc", null, "marker_missing_in_storage"],
    ["abc", json("xyz"), "marker_mismatch"],
  ])("refuses to paper over a half-present marker (db=%s) → %s", async (db, bucket, problem) => {
    state(db, bucket);
    expect(await createStorageMarker()).toEqual({ created: false, problem });
    expect(mockPrisma.appSetting.create).not.toHaveBeenCalled();
    expect(mockS3.putObject).not.toHaveBeenCalled();
  });

  it("does not touch the bucket when the database write fails (e.g. a concurrent click)", async () => {
    state(null, null);
    mockPrisma.appSetting.create.mockRejectedValue(new Error("Unique constraint failed"));
    await expect(createStorageMarker()).rejects.toThrow("Unique constraint");
    expect(mockS3.putObject).not.toHaveBeenCalled();
  });

  it("rolls back the database row when the bucket write fails", async () => {
    state(null, null);
    mockS3.putObject.mockRejectedValue(new Error("bucket down"));
    await expect(createStorageMarker()).rejects.toThrow("bucket down");
    expect(mockPrisma.appSetting.delete).toHaveBeenCalledWith({ where: { key: STORAGE_MARKER_SETTING } });
    expect(mockS3.deleteObject).toHaveBeenCalledWith(STORAGE_MARKER_KEY);
  });

  it("does not create anything when the state cannot be read", async () => {
    mockPrisma.appSetting.findUnique.mockRejectedValue(new Error("db down"));
    mockS3.getObjectTextOrNull.mockResolvedValue(null);
    await expect(createStorageMarker()).rejects.toThrow("db down");
    expect(mockPrisma.appSetting.create).not.toHaveBeenCalled();
  });
});
