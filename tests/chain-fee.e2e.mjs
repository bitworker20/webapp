// Live-chain test for fee discovery: does this client pay what the node asks?
//
// Unit tests pin the arithmetic (packages/poker-session/src/fees.spec.ts), but
// only a running node proves the part that matters — that
// /cosmos/base/node/v1beta1/config and /cosmos/tx/v1beta1/simulate exist on
// pokerchaind, that a fee computed from them is *accepted*, and that a client
// which ignores them is rejected on a chain with a non-zero minimum gas price.
// That last check is the regression guard: it is exactly what this client did
// before, and it fails silently in dev because the dev chain charges nothing.
//
// Usage — needs a node started with a NON-ZERO minimum gas price:
//
//   pokerchain/scripts/testnet_genesis.sh --home $H --force
//   pokerchain/build/pokerchaind --home $H start \
//       --api.enable --grpc.enable --minimum-gas-prices 0.025uchip
//   PRIV_KEY_HEX=$(pokerchaind keys export tom --unarmored-hex --unsafe ...) \
//   TO_ADDRESS=$(pokerchaind keys show jerry -a ...) \
//       node tests/chain-fee.e2e.mjs
//
// LCD_URL defaults to http://127.0.0.1:1317.
import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const LCD_URL = process.env.LCD_URL ?? "http://127.0.0.1:1317";
const CHAIN_ID = process.env.CHAIN_ID ?? "pokerchain-testnet-1";
const PRIV_KEY_HEX = process.env.PRIV_KEY_HEX;
const TO_ADDRESS = process.env.TO_ADDRESS;

if (!PRIV_KEY_HEX || !TO_ADDRESS) {
  console.error("set PRIV_KEY_HEX and TO_ADDRESS (see the header comment)");
  process.exit(2);
}

// The client's own modules, bundled as they ship rather than reimplemented
// here — a test that rebuilt the tx would prove nothing about the client.
const entry = `
import { KeyHolder } from ${JSON.stringify(join(root, "src/wallet/key-holder"))};
import { BrowserKeyBridge } from ${JSON.stringify(
  join(root, "src/wallet/browser-key-bridge")
)};
import {
  encodeAuthInfo, encodeMsgSend, encodeSignDoc, encodeTxBody, encodeTxRaw,
  MSG_SEND_TYPE_URL,
} from ${JSON.stringify(join(root, "src/wallet/chain-tx"))};
import { fetchNodeGasPrice } from "@bitpoker/poker-session/fees";
export { KeyHolder, BrowserKeyBridge, fetchNodeGasPrice,
         encodeAuthInfo, encodeMsgSend, encodeSignDoc, encodeTxBody, encodeTxRaw,
         MSG_SEND_TYPE_URL };
`;

const dir = await mkdtemp(join(tmpdir(), "bitpoker-fee-e2e-"));
const bundlePath = join(dir, "bundle.mjs");
await build({
  // stdin with resolveDir, not a file in the temp dir: bare imports like
  // @bitpoker/poker-session resolve relative to the importer, which has to be
  // inside this workspace.
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  outfile: bundlePath,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  absWorkingDir: root,
  logLevel: "warning",
});
const client = await import(bundlePath);

const hexToBytes = (hex) =>
  Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// --- 1. the node tells us its price ----------------------------------------
const price = await client.fetchNodeGasPrice(LCD_URL, "uchip");
check(
  "node advertises a minimum gas price",
  !!price,
  price ? `${price.amount}${price.denom}` : "no price — start the node with --minimum-gas-prices"
);
if (!price || price.amount === "0") {
  console.error(
    "this test needs a chain with a NON-ZERO minimum gas price; see the header"
  );
  process.exit(1);
}

const keyHolder = new client.KeyHolder("xpoker");
const identity = keyHolder.load(hexToBytes(PRIV_KEY_HEX));
const bridge = new client.BrowserKeyBridge({ keyHolder, lcdUrl: LCD_URL });
console.log(`      from ${identity.bech32Address} to ${TO_ADDRESS}`);

const amount = { denom: "uchip", amount: "1234" };

// --- 2. the estimate is a real measurement, not a constant ------------------
const estimate = await bridge.estimateSend(CHAIN_ID, {
  toAddress: TO_ADDRESS,
  amount,
  memo: "fee discovery",
});
check(
  "simulate returns a gas limit below the old hard-coded 400000",
  Number(estimate.gasLimit) > 0 && Number(estimate.gasLimit) < 400000,
  `gas ${estimate.gasLimit}`
);
check(
  "the fee is derived from that gas at the node's price",
  !!estimate.fee &&
    BigInt(estimate.fee.amount) ===
      (BigInt(estimate.gasLimit) * 25n + 999n) / 1000n,
  estimate.fee ? `${estimate.fee.amount}${estimate.fee.denom}` : "no fee"
);

// --- 3. a tx built this way is accepted -------------------------------------
const balanceOf = async (address) => {
  const res = await fetch(
    `${LCD_URL}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=uchip`
  );
  return BigInt((await res.json())?.balance?.amount ?? "0");
};
const before = await balanceOf(TO_ADDRESS);
const sent = await bridge.sendCoins(CHAIN_ID, {
  toAddress: TO_ADDRESS,
  amount,
  memo: "fee discovery",
});
check(
  "the chain accepts a tx whose fee came from the node",
  sent.code === 0,
  `code ${sent.code} ${sent.rawLog.slice(0, 120)}`
);

// BROADCAST_MODE_SYNC returns before the tx is in a block.
for (let i = 0; i < 40 && (await balanceOf(TO_ADDRESS)) === before; i++) {
  await new Promise((r) => setTimeout(r, 250));
}
check(
  "the recipient is credited",
  (await balanceOf(TO_ADDRESS)) - before === 1234n,
  `delta ${(await balanceOf(TO_ADDRESS)) - before}`
);

// --- 4. the regression guard: no fee is rejected here ------------------------
// Built by hand, because the client can no longer produce this tx.
{
  const account = await (
    await fetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${identity.bech32Address}`)
  ).json();
  const base = account.account.base_account ?? account.account;
  const bodyBytes = client.encodeTxBody(
    client.MSG_SEND_TYPE_URL,
    client.encodeMsgSend({
      fromAddress: identity.bech32Address,
      toAddress: TO_ADDRESS,
      amount: [amount],
    })
  );
  const authInfoBytes = client.encodeAuthInfo({
    pubKey: identity.pubKey,
    sequence: String(base.sequence),
    gasLimit: "400000",
  });
  const signDoc = client.encodeSignDoc({
    bodyBytes,
    authInfoBytes,
    chainId: CHAIN_ID,
    accountNumber: String(base.account_number),
  });
  const { sha256 } = await import("@noble/hashes/sha256");
  const { secp256k1 } = await import("@noble/curves/secp256k1");
  const signature = keyHolder.withPrivKey((priv) =>
    secp256k1.sign(sha256(signDoc), priv).toCompactRawBytes()
  );
  const res = await fetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_bytes: b64(client.encodeTxRaw({ bodyBytes, authInfoBytes, signature })),
      mode: "BROADCAST_MODE_SYNC",
    }),
  });
  const rejected = (await res.json())?.tx_response ?? {};
  check(
    "a zero-fee tx is rejected on this chain (what the old client sent)",
    rejected.code !== 0 && /insufficient fee/i.test(rejected.raw_log ?? ""),
    `code ${rejected.code} ${(rejected.raw_log ?? "").slice(0, 120)}`
  );
}

console.log(failures === 0 ? "\nfee discovery OK" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
