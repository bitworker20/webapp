import { afterEach, describe, expect, it, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { BrowserKeyBridge } from "./browser-key-bridge";
import { KeyHolder, toHex } from "./key-holder";

// Same account as armor.spec.ts / key-holder.spec.ts.
const FIXTURE_PRIV_KEY = Uint8Array.from(
  Buffer.from(
    "21B9CED055A26FCACFCA81C43BC63164EC45512C6EA0294E6DF4811D060C30E4",
    "hex"
  )
);
const FIXTURE_ADDRESS = "xpoker1uflvlfueyjkvpfmtgyzt6txskpqn3qchu5kqch";
const CHAIN_ID = "pokerchain-testnet-1";
const LCD = "http://lcd.test";

function makeBridge(
  onApproveIntent?: (r: any) => Promise<boolean>
): { bridge: BrowserKeyBridge; holder: KeyHolder } {
  const holder = new KeyHolder("xpoker");
  holder.load(FIXTURE_PRIV_KEY.slice());
  return {
    bridge: new BrowserKeyBridge({ keyHolder: holder, lcdUrl: LCD, onApproveIntent }),
    holder,
  };
}

// Minimal LCD double: account lookup, broadcast, then the by-hash query the
// bridge waits on for inclusion. Returns the posted tx_bytes so a test can
// pull the SignDoc apart.
function stubLcd(): { posted: () => Uint8Array } {
  let postedBytes = new Uint8Array(0);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/cosmos/auth/v1beta1/accounts/")) {
        return {
          ok: true,
          json: async () => ({
            account: { account_number: "12", sequence: "7" },
          }),
        } as any;
      }
      // Inclusion poll: the bridge asks for the tx by hash until it lands.
      if (url.includes("/cosmos/tx/v1beta1/txs/")) {
        return {
          ok: true,
          json: async () => ({
            tx_response: { txhash: "ABC123", code: 0, raw_log: "" },
          }),
        } as any;
      }
      if (url.includes("/cosmos/tx/v1beta1/txs")) {
        const body = JSON.parse(String(init?.body));
        postedBytes = Uint8Array.from(Buffer.from(body.tx_bytes, "base64"));
        return {
          ok: true,
          json: async () => ({
            tx_response: { txhash: "ABC123", code: 0, raw_log: "" },
          }),
        } as any;
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return { posted: () => postedBytes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getKey", () => {
  it("reports the loaded account", async () => {
    const { bridge } = makeBridge();
    await expect(bridge.getKey(CHAIN_ID)).resolves.toMatchObject({
      bech32Address: FIXTURE_ADDRESS,
    });
  });

  it("fails while locked instead of signing with nothing", async () => {
    const holder = new KeyHolder("xpoker");
    const bridge = new BrowserKeyBridge({ keyHolder: holder, lcdUrl: LCD });
    await expect(bridge.getKey(CHAIN_ID)).rejects.toThrow(/no key is loaded/);
  });
});

describe("signPayload", () => {
  const payload = "bitpoker-relay-client-hello-v1\nhello";

  it("returns pubkey(33) || r(32) || s(32) that verifies over sha256(payload)", async () => {
    const { bridge } = makeBridge();
    const { signature } = await bridge.signPayload(CHAIN_ID, payload);

    expect(signature.length).toBe(97 * 2);
    const bytes = Uint8Array.from(Buffer.from(signature, "hex"));
    const pubKey = bytes.slice(0, 33);
    const compact = bytes.slice(33);

    expect(toHex(pubKey)).toBe(toHex(secp256k1.getPublicKey(FIXTURE_PRIV_KEY, true)));
    const digest = sha256(new TextEncoder().encode(payload));
    expect(secp256k1.verify(compact, digest, pubKey)).toBe(true);
  });

  it("produces a low-S signature, which cosmos requires", async () => {
    const { bridge } = makeBridge();
    const { signature } = await bridge.signPayload(CHAIN_ID, payload);
    const s = BigInt(
      "0x" + signature.slice(33 * 2 + 32 * 2)
    );
    const halfOrder = secp256k1.CURVE.n / BigInt(2);
    expect(s <= halfOrder).toBe(true);
  });

  it("refuses payloads outside the bitpoker domain prefixes", async () => {
    const { bridge } = makeBridge();
    for (const bad of [
      "",
      "hello",
      // A Cosmos SignDoc or ADR-36 doc must never be reachable here.
      '{"chain_id":"pokerchain-testnet-1","msgs":[]}',
      " bitpoker-relay-client-hello-v1\nleading space",
    ]) {
      await expect(bridge.signPayload(CHAIN_ID, bad)).rejects.toThrow(
        /domain prefix/
      );
    }
  });

  it("accepts every prefix the relay and chain actually use", async () => {
    const { bridge } = makeBridge();
    for (const good of [
      "bitpoker-relay-client-hello-v1\nx",
      "bitpoker-relay-receipt-v1\nx",
      "bitpoker-session-evidence-v1\nx",
    ]) {
      await expect(bridge.signPayload(CHAIN_ID, good)).resolves.toBeTruthy();
    }
  });
});

describe("openIntent", () => {
  it("asks for approval, then broadcasts a signed tx", async () => {
    const lcd = stubLcd();
    const approve = vi.fn(async () => true);
    const { bridge } = makeBridge(approve);

    const result = await bridge.openIntent(CHAIN_ID, {
      gameType: 3,
      minStake: "100",
      maxStake: "5000",
      opponent: "",
      playerSessionPubkey: "02aabb",
      playerTransportPubkey: "03ccdd",
    });

    expect(result).toEqual({ txHash: "ABC123", code: 0, rawLog: "" });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: CHAIN_ID,
        signer: FIXTURE_ADDRESS,
        minStake: "100",
        maxStake: "5000",
      })
    );
    expect(lcd.posted().length).toBeGreaterThan(0);
  });

  it("does not broadcast when approval is declined", async () => {
    const lcd = stubLcd();
    const { bridge } = makeBridge(async () => false);

    await expect(
      bridge.openIntent(CHAIN_ID, {
        gameType: 3,
        minStake: "100",
        maxStake: "5000",
        opponent: "",
        playerSessionPubkey: "02aabb",
        playerTransportPubkey: "",
      })
    ).rejects.toThrow(/rejected/);
    expect(lcd.posted().length).toBe(0);
  });
});

describe("transaction signing", () => {
  it("signs sha256(SignDoc) so the chain's secp256k1 check passes", async () => {
    const lcd = stubLcd();
    const { bridge } = makeBridge();

    await bridge.submitSecret(CHAIN_ID, {
      sessionId: "42",
      secretKeyHex: "0102030405",
      pubkeyHex: "0a0b0c",
    });

    // TxRaw: field 1 body_bytes, field 2 auth_info_bytes, field 3 signature.
    // Pull the three length-delimited fields back out and re-derive the
    // SignDoc the chain will reconstruct, then verify the signature over it.
    const raw = lcd.posted();
    const fields = readLengthDelimited(raw);
    const bodyBytes = fields[1];
    const authInfoBytes = fields[2];
    const signature = fields[3];
    expect(signature.length).toBe(64);

    const signDoc = concat([
      tagged(1, bodyBytes),
      tagged(2, authInfoBytes),
      tagged(3, new TextEncoder().encode(CHAIN_ID)),
      // account_number 12, field 4 varint.
      Uint8Array.from([0x20, 12]),
    ]);
    const pubKey = secp256k1.getPublicKey(FIXTURE_PRIV_KEY, true);
    expect(secp256k1.verify(signature, sha256(signDoc), pubKey)).toBe(true);
  });

  it("sends an adjudication as MsgAdjudicateSession for that session", async () => {
    // The only message that releases a disputed escrow. Getting the type URL
    // or the session id wrong here is money that never comes back.
    const lcd = stubLcd();
    const { bridge } = makeBridge();

    const result = await bridge.adjudicateSession(CHAIN_ID, "42");
    expect(result.code).toBe(0);

    const body = new TextDecoder("latin1").decode(lcd.posted());
    expect(body).toContain("/pokerchain.pokerchain.v1.MsgAdjudicateSession");
    expect(body).toContain(FIXTURE_ADDRESS);
    // MsgAdjudicateSession.session_id: field 2, varint, 42.
    expect(body).toContain("\x10\x2a");
  });

  it("reports the DeliverTx outcome, not just CheckTx", async () => {
    // BROADCAST_MODE_SYNC answers before execution. A message that passes
    // CheckTx and then fails in the block (out of gas, insufficient escrow)
    // used to look like success.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/accounts/")) {
          return {
            ok: true,
            json: async () => ({ account: { account_number: "1", sequence: "0" } }),
          } as any;
        }
        if (url.includes("/cosmos/tx/v1beta1/txs/")) {
          return {
            ok: true,
            json: async () => ({
              tx_response: { txhash: "BEEF", code: 11, raw_log: "out of gas" },
            }),
          } as any;
        }
        return {
          ok: true,
          json: async () => ({
            tx_response: { txhash: "BEEF", code: 0, raw_log: "" },
          }),
        } as any;
      })
    );
    const { bridge } = makeBridge();
    const result = await bridge.cancelIntent(CHAIN_ID, "7");
    expect(result.code).toBe(11);
    expect(result.rawLog).toContain("out of gas");
  });

  it("surfaces a non-zero tx code instead of pretending it worked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/accounts/")) {
          return {
            ok: true,
            json: async () => ({ account: { account_number: "1", sequence: "0" } }),
          } as any;
        }
        return {
          ok: true,
          json: async () => ({
            tx_response: { txhash: "DEAD", code: 11, raw_log: "out of gas" },
          }),
        } as any;
      })
    );
    const { bridge } = makeBridge();
    await expect(
      bridge.submitSecret(CHAIN_ID, {
        sessionId: "1",
        secretKeyHex: "00",
        pubkeyHex: "00",
      })
    ).resolves.toEqual({ txHash: "DEAD", code: 11, rawLog: "out of gas" });
  });

  it("explains a missing account rather than failing opaquely", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 }) as any));
    const { bridge } = makeBridge();
    await expect(
      bridge.submitSecret(CHAIN_ID, {
        sessionId: "1",
        secretKeyHex: "00",
        pubkeyHex: "00",
      })
    ).rejects.toThrow(/does not exist on chain yet/);
  });
});

// --- tiny proto readers, only good enough for the assertions above ---------

function readLengthDelimited(bytes: Uint8Array): Record<number, Uint8Array> {
  const out: Record<number, Uint8Array> = {};
  let i = 0;
  while (i < bytes.length) {
    const key = bytes[i++];
    const field = key >> 3;
    if ((key & 0x07) !== 2) {
      throw new Error(`unexpected wire type in field ${field}`);
    }
    let length = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[i++];
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
    }
    out[field] = bytes.slice(i, i + length);
    i += length;
  }
  return out;
}

function tagged(field: number, value: Uint8Array): Uint8Array {
  const header: number[] = [(field << 3) | 2];
  let length = value.length;
  for (;;) {
    if (length < 0x80) {
      header.push(length);
      break;
    }
    header.push((length & 0x7f) | 0x80);
    length >>>= 7;
  }
  return concat([Uint8Array.from(header), value]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
