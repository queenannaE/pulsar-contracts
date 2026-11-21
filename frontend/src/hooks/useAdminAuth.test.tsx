import { renderHook, act } from "@testing-library/react";
import { useAdminAuth } from "./useAdminAuth";

// ── SEC-021: setAllowed should not be called when already permitted ──────────

describe("useAdminAuth connect()", () => {
  afterEach(() => {
    delete (window as any).freighter;
    jest.clearAllMocks();
  });

  test("does not call setAllowed when permission is already granted", async () => {
    const setAllowed = jest.fn().mockResolvedValue(undefined);
    const isAllowed = jest.fn().mockResolvedValue(true);
    const getPublicKey = jest.fn().mockResolvedValue("GADMIN...");
    (window as any).freighter = { setAllowed, isAllowed, getPublicKey };

    const { result } = renderHook(() => useAdminAuth("GADMIN..."));

    await act(async () => {
      await result.current.connect();
    });

    expect(isAllowed).toHaveBeenCalledTimes(1);
    expect(setAllowed).not.toHaveBeenCalled();
    expect(result.current.address).toBe("GADMIN...");
    expect(result.current.isAdmin).toBe(true);
  });

  test("calls setAllowed when permission has not been granted yet", async () => {
    const setAllowed = jest.fn().mockResolvedValue(undefined);
    const isAllowed = jest.fn().mockResolvedValue(false);
    const getPublicKey = jest.fn().mockResolvedValue("GADMIN...");
    (window as any).freighter = { setAllowed, isAllowed, getPublicKey };

    const { result } = renderHook(() => useAdminAuth("GADMIN..."));

    await act(async () => {
      await result.current.connect();
    });

    expect(isAllowed).toHaveBeenCalledTimes(1);
    expect(setAllowed).toHaveBeenCalledTimes(1);
    expect(result.current.address).toBe("GADMIN...");
  });
});
