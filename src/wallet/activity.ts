// Recent transactions for the account, read from the node's tx index.
//
// The chain is the only history this client has — it stores nothing locally —
// so "activity" is two indexed queries (txs this account signed, and txs that
// paid it) merged on hash. A node with indexing disabled returns nothing,
// which the UI shows as an empty list rather than an error: history is a
// convenience, and losing it must not look like losing money.

export type ActivityKind =
  | "send"
  | "receive"
  | "open-intent"
  | "settle"
  | "dispute"
  | "other";

export interface ActivityEntry {
  hash: string;
  height: number;
  timestamp: string;
  kind: ActivityKind;
  // What the account's uchip balance did, fees included. Signed decimal string.
  deltaUchip: string;
  feeUchip: string;
  counterparty: string;
  memo: string;
  failed: boolean;
  rawType: string;
}

const KIND_BY_TYPE: Record<string, ActivityKind> = {
  "/cosmos.bank.v1beta1.MsgSend": "send",
  "/pokerchain.pokerchain.v1.MsgOpenGameIntent": "open-intent",
  "/pokerchain.pokerchain.v1.MsgCancelGameIntent": "open-intent",
  "/pokerchain.pokerchain.v1.MsgSubmitSessionResult": "settle",
  "/pokerchain.pokerchain.v1.MsgSubmitSessionEvidence": "dispute",
  "/pokerchain.pokerchain.v1.MsgSubmitSessionSecret": "dispute",
};

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  send: "Sent",
  receive: "Received",
  "open-intent": "Game intent",
  settle: "Game settled",
  dispute: "Dispute",
  other: "Transaction",
};

export async function fetchActivity(
  lcdUrl: string,
  address: string,
  denom: string,
  limit = 20
): Promise<ActivityEntry[]> {
  const base = lcdUrl.replace(/\/+$/, "");
  const [sent, received] = await Promise.all([
    queryTxs(base, `message.sender='${address}'`, limit),
    queryTxs(base, `transfer.recipient='${address}'`, limit),
  ]);

  const byHash = new Map<string, ActivityEntry>();
  for (const tx of [...sent, ...received]) {
    const entry = summarise(tx, address, denom);
    if (entry && !byHash.has(entry.hash)) {
      byHash.set(entry.hash, entry);
    }
  }
  return [...byHash.values()]
    .sort((a, b) => b.height - a.height)
    .slice(0, limit);
}

async function queryTxs(
  base: string,
  query: string,
  limit: number
): Promise<any[]> {
  const url =
    `${base}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}` +
    `&order_by=ORDER_BY_DESC&limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return [];
    }
    const body = await res.json();
    return Array.isArray(body?.tx_responses) ? body.tx_responses : [];
  } catch {
    return [];
  }
}

function summarise(
  tx: any,
  address: string,
  denom: string
): ActivityEntry | undefined {
  const hash = String(tx?.txhash ?? "");
  if (!hash) {
    return undefined;
  }
  const messages: any[] = tx?.tx?.body?.messages ?? [];
  const rawType = String(messages[0]?.["@type"] ?? "");
  const failed = Number(tx?.code ?? 0) !== 0;

  let kind: ActivityKind = KIND_BY_TYPE[rawType] ?? "other";
  let counterparty = "";
  if (kind === "send") {
    const msg = messages[0];
    const from = String(msg?.from_address ?? "");
    const to = String(msg?.to_address ?? "");
    // The same MsgSend is "Sent" to its signer and "Received" to the other
    // side; this list is one account's view, so pick by who we are.
    kind = from === address ? "send" : "receive";
    counterparty = from === address ? to : from;
  } else {
    counterparty = String(messages[0]?.creator ?? "");
  }

  return {
    hash,
    height: Number(tx?.height ?? 0),
    timestamp: String(tx?.timestamp ?? ""),
    kind,
    deltaUchip: netDelta(tx, address, denom),
    feeUchip: feeAmount(tx, denom),
    counterparty,
    memo: String(tx?.tx?.body?.memo ?? ""),
    failed,
    rawType,
  };
}

// Net movement across every `transfer` event that touched this account —
// which is what makes escrow and settlement legible: the message says
// "submit session result", the events say the account got 1,900 uchip back.
function netDelta(tx: any, address: string, denom: string): string {
  let net = 0n;
  for (const event of allEvents(tx)) {
    if (event?.type !== "transfer") {
      continue;
    }
    const attrs = attributes(event);
    const amount = parseCoins(attrs.amount ?? "", denom);
    if (amount === 0n) {
      continue;
    }
    if (attrs.recipient === address) {
      net += amount;
    }
    if (attrs.sender === address) {
      net -= amount;
    }
  }
  return net.toString();
}

function feeAmount(tx: any, denom: string): string {
  const coins: any[] = tx?.tx?.auth_info?.fee?.amount ?? [];
  const coin = coins.find((c) => c?.denom === denom);
  return String(coin?.amount ?? "0");
}

function allEvents(tx: any): any[] {
  const top: any[] = Array.isArray(tx?.events) ? tx.events : [];
  if (top.length > 0) {
    return top;
  }
  // Older nodes only populate the per-message logs.
  const logs: any[] = Array.isArray(tx?.logs) ? tx.logs : [];
  return logs.flatMap((log) => (Array.isArray(log?.events) ? log.events : []));
}

function attributes(event: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of event?.attributes ?? []) {
    const key = String(attr?.key ?? "");
    if (key) {
      out[key] = String(attr?.value ?? "");
    }
  }
  return out;
}

// "1234uchip" or "1234uchip,5stake" -> the amount in `denom`.
function parseCoins(spec: string, denom: string): bigint {
  let total = 0n;
  for (const part of spec.split(",")) {
    const match = new RegExp(`^([0-9]+)${denom}$`).exec(part.trim());
    if (match) {
      total += BigInt(match[1]);
    }
  }
  return total;
}
