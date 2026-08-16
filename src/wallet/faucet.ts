// Talking to poker-faucetd.
//
// The faucet is optional: a build with no VITE_FAUCET_URL simply has none, and
// the wallet says so in words instead of showing a button that cannot work.
// Everything here therefore returns "no faucet" rather than throwing when the
// endpoint is unset or unreachable — the only errors worth surfacing to a
// player are the ones the faucet itself gave a reason for.
import { FAUCET_URL } from "../config";

export interface FaucetInfo {
  grantUchip: string;
  inviteRequired: boolean;
  paused: boolean;
  addressCooldownSeconds: number;
  daySpentUchip: string;
  dayBudgetUchip: string;
}

export interface FaucetPayout {
  amountUchip: string;
  txHash: string;
  dryRun: boolean;
  nextClaimAt: string;
}

// FaucetError carries the daemon's own machine code alongside its sentence, so
// the caller can act on "the code is wrong" differently from "come back later"
// without parsing English.
export class FaucetError extends Error {
  readonly code: string;
  readonly retryAfterSeconds: number;

  constructor(code: string, message: string, retryAfterSeconds = 0) {
    super(message);
    this.name = "FaucetError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type Fetch = typeof fetch;

const endpoint = (base: string, path: string): string =>
  `${base.replace(/\/+$/, "")}${path}`;

export const faucetConfigured = (base: string = FAUCET_URL): boolean =>
  base.trim() !== "";

/** Reads what the faucet is currently offering, or undefined if there is none. */
export const fetchFaucetInfo = async (
  base: string = FAUCET_URL,
  doFetch: Fetch = fetch,
): Promise<FaucetInfo | undefined> => {
  if (!faucetConfigured(base)) {
    return undefined;
  }
  try {
    const response = await doFetch(endpoint(base, "/v1/info"), {
      headers: { Accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok || !body?.ok) {
      return undefined;
    }
    return {
      grantUchip: String(body.grant_uchip ?? "0"),
      inviteRequired: Boolean(body.invite_required),
      paused: Boolean(body.paused),
      addressCooldownSeconds: Number(body.address_cooldown_seconds ?? 0),
      daySpentUchip: String(body.day_spent_uchip ?? "0"),
      dayBudgetUchip: String(body.day_budget_uchip ?? ""),
    };
  } catch {
    // Unreachable, blocked, CORS: for this page that is the same as absent.
    return undefined;
  }
};

/**
 * Asks the faucet to fund an address. Rejects with a FaucetError describing
 * which limit refused, so the caller can print the daemon's own sentence.
 */
export const claimFromFaucet = async (
  request: { address: string; code?: string },
  base: string = FAUCET_URL,
  doFetch: Fetch = fetch,
): Promise<FaucetPayout> => {
  if (!faucetConfigured(base)) {
    throw new FaucetError("no_faucet", "This build has no faucet configured.");
  }

  let response: Response;
  try {
    response = await doFetch(endpoint(base, "/v1/faucet/claim"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: request.address,
        ...(request.code ? { code: request.code } : {}),
      }),
    });
  } catch {
    throw new FaucetError(
      "unreachable",
      "Could not reach the faucet. Try again in a moment.",
    );
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new FaucetError("unreadable", "The faucet answered with nonsense.");
  }

  if (!response.ok || !body?.ok) {
    const error = body?.error ?? {};
    throw new FaucetError(
      String(error.code ?? "refused"),
      String(error.message ?? "The faucet said no."),
      Number(error.retry_after_seconds ?? 0),
    );
  }

  return {
    amountUchip: String(body.amount_uchip ?? "0"),
    txHash: String(body.tx_hash ?? ""),
    dryRun: Boolean(body.dry_run),
    nextClaimAt: String(body.next_claim_at ?? ""),
  };
};

/** "in 24 hours" — for appending to a refusal that carries a retry hint. */
export const describeWait = (seconds: number): string => {
  if (seconds <= 0) {
    return "";
  }
  if (seconds < 90) {
    return `${Math.max(1, Math.round(seconds))} seconds`;
  }
  if (seconds < 5400) {
    return `${Math.round(seconds / 60)} minutes`;
  }
  if (seconds < 172800) {
    return `${Math.round(seconds / 3600)} hours`;
  }
  return `${Math.round(seconds / 86400)} days`;
};
