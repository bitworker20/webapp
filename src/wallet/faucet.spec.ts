import { describe, expect, it, vi } from "vitest";
import {
  claimFromFaucet,
  describeWait,
  FaucetError,
  faucetConfigured,
  fetchFaucetInfo,
} from "./faucet";

const BASE = "https://faucet.example";

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

describe("faucetConfigured", () => {
  it("treats an empty or blank endpoint as no faucet", () => {
    expect(faucetConfigured("")).toBe(false);
    expect(faucetConfigured("   ")).toBe(false);
    expect(faucetConfigured(BASE)).toBe(true);
  });
});

describe("fetchFaucetInfo", () => {
  it("reads the terms the faucet is offering", async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        grant_uchip: "5000000",
        invite_required: true,
        paused: false,
        address_cooldown_seconds: 86400,
        day_spent_uchip: "15000000",
        day_budget_uchip: "500000000",
      }),
    );

    const info = await fetchFaucetInfo(BASE, doFetch as unknown as typeof fetch);

    expect(doFetch).toHaveBeenCalledWith(
      "https://faucet.example/v1/info",
      expect.anything(),
    );
    expect(info).toEqual({
      grantUchip: "5000000",
      inviteRequired: true,
      paused: false,
      addressCooldownSeconds: 86400,
      daySpentUchip: "15000000",
      dayBudgetUchip: "500000000",
    });
  });

  it("reports no faucet rather than failing when there is none to reach", async () => {
    // A page that throws here would be a page that cannot render its wallet
    // because an optional service is down.
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new Error("network down");
      },
      async () => jsonResponse(503, { ok: false }),
      async () => jsonResponse(200, { ok: false }),
    ];
    for (const doFetch of cases) {
      expect(
        await fetchFaucetInfo(BASE, doFetch as unknown as typeof fetch),
      ).toBeUndefined();
    }
    expect(await fetchFaucetInfo("", vi.fn() as never)).toBeUndefined();
  });
});

describe("claimFromFaucet", () => {
  it("sends the address and, when given, the invitation code", async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        amount_uchip: "5000000",
        tx_hash: "ABCDEF",
        next_claim_at: "2026-08-17T12:00:00Z",
      }),
    );

    const payout = await claimFromFaucet(
      { address: "xpoker1player", code: "K7M2-9QXD-4T8B" },
      BASE,
      doFetch as unknown as typeof fetch,
    );

    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://faucet.example/v1/faucet/claim");
    expect(JSON.parse(String(init.body))).toEqual({
      address: "xpoker1player",
      code: "K7M2-9QXD-4T8B",
    });
    expect(payout).toEqual({
      amountUchip: "5000000",
      txHash: "ABCDEF",
      dryRun: false,
      nextClaimAt: "2026-08-17T12:00:00Z",
    });
  });

  it("omits the code entirely when there is none", async () => {
    const doFetch = vi.fn(async () => jsonResponse(200, { ok: true, amount_uchip: "1" }));
    await claimFromFaucet(
      { address: "xpoker1player" },
      BASE,
      doFetch as unknown as typeof fetch,
    );
    const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ address: "xpoker1player" });
  });

  it("carries the refusal's own code, sentence and retry hint", async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse(429, {
        ok: false,
        error: {
          code: "address_cooldown",
          message: "This address was topped up 1 hour ago.",
          retry_after_seconds: 82800,
        },
      }),
    );

    const failure = await claimFromFaucet(
      { address: "xpoker1player" },
      BASE,
      doFetch as unknown as typeof fetch,
    ).catch((e) => e);

    expect(failure).toBeInstanceOf(FaucetError);
    expect(failure.code).toBe("address_cooldown");
    expect(failure.message).toBe("This address was topped up 1 hour ago.");
    expect(failure.retryAfterSeconds).toBe(82800);
    expect(describeWait(failure.retryAfterSeconds)).toBe("23 hours");
  });

  it("turns an unreachable faucet into a refusal a player can read", async () => {
    const doFetch = vi.fn(async () => {
      throw new Error("connection refused");
    });

    const failure = await claimFromFaucet(
      { address: "xpoker1player" },
      BASE,
      doFetch as unknown as typeof fetch,
    ).catch((e) => e);

    expect(failure).toBeInstanceOf(FaucetError);
    expect(failure.code).toBe("unreachable");
  });

  it("refuses before sending anything when no faucet is configured", async () => {
    const doFetch = vi.fn();
    const failure = await claimFromFaucet(
      { address: "xpoker1player" },
      "",
      doFetch as unknown as typeof fetch,
    ).catch((e) => e);

    expect(failure.code).toBe("no_faucet");
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe("describeWait", () => {
  it("says how long in units a person uses", () => {
    expect(describeWait(0)).toBe("");
    expect(describeWait(30)).toBe("30 seconds");
    expect(describeWait(600)).toBe("10 minutes");
    expect(describeWait(7200)).toBe("2 hours");
    expect(describeWait(259200)).toBe("3 days");
  });
});
