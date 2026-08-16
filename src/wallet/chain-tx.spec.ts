import { describe, expect, it } from "vitest";
import vectors from "@bitpoker/poker-session/fixtures/chain-tx-vectors.json";
import {
  encodeAuthInfo,
  encodeMsgCancelGameIntent,
  encodeMsgClaimSessionTimeout,
  encodeMsgOpenGameIntent,
  encodeMsgSubmitSessionEvidence,
  encodeMsgSubmitSessionResult,
  encodeMsgSubmitSessionSecret,
  encodeSignDoc,
  encodeTxBody,
  encodeTxRaw,
  MSG_OPEN_GAME_INTENT_TYPE_URL,
  ProtoWriter,
} from "./chain-tx";

const hex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");
const fromHex = (text: string): Uint8Array =>
  Uint8Array.from(Buffer.from(text, "hex"));

// The vectors were produced by the Keplr extension's background encoder
// (packages/background/src/bitpoker/proto-writer.ts), which is the one the
// chain e2es have been running against. Asserting against them here means this
// client cannot silently disagree with the extension about the wire format.
// The extension has a matching spec reading this same fixture.
describe("pokerchain message encoding matches the extension's encoder", () => {
  it("encodes MsgOpenGameIntent", () => {
    const v = vectors.openGameIntent;
    expect(hex(encodeMsgOpenGameIntent(v.input))).toBe(v.hex);
  });

  it("omits empty opponent and transport pubkey (proto3 defaults)", () => {
    const v = vectors.openGameIntentOpenMatch;
    expect(hex(encodeMsgOpenGameIntent(v.input))).toBe(v.hex);
  });

  it("encodes MsgCancelGameIntent", () => {
    const v = vectors.cancelGameIntent;
    expect(hex(encodeMsgCancelGameIntent(v.input))).toBe(v.hex);
  });

  it("encodes MsgClaimSessionTimeout", () => {
    const v = vectors.claimSessionTimeout;
    expect(hex(encodeMsgClaimSessionTimeout(v.input))).toBe(v.hex);
  });

  it("encodes MsgSubmitSessionResult", () => {
    const v = vectors.submitSessionResult;
    expect(hex(encodeMsgSubmitSessionResult(v.input))).toBe(v.hex);
  });

  it("encodes a split pot, and a session id beyond 2^53", () => {
    const v = vectors.submitSessionResultSplit;
    expect(hex(encodeMsgSubmitSessionResult(v.input))).toBe(v.hex);
  });

  it("encodes MsgSubmitSessionEvidence", () => {
    const v = vectors.submitSessionEvidence;
    expect(
      hex(
        encodeMsgSubmitSessionEvidence({
          ...v.input,
          evidencePayload: fromHex(v.input.evidencePayloadHex),
        })
      )
    ).toBe(v.hex);
  });

  it("encodes MsgSubmitSessionSecret", () => {
    const v = vectors.submitSessionSecret;
    expect(
      hex(
        encodeMsgSubmitSessionSecret({
          ...v.input,
          sessionSecretKey: fromHex(v.input.sessionSecretKeyHex),
          sessionPubkey: fromHex(v.input.sessionPubkeyHex),
        })
      )
    ).toBe(v.hex);
  });
});

describe("ProtoWriter", () => {
  it("writes multi-byte varints", () => {
    // 300 = 0xAC 0x02 little-endian base-128.
    expect(hex(new ProtoWriter().uint64(1, 300).finish())).toBe("08ac02");
  });

  it("carries uint64 values past 2^53 without precision loss", () => {
    const big = "18446744073709551615"; // 2^64 - 1
    expect(hex(new ProtoWriter().uint64(1, big).finish())).toBe(
      "08ffffffffffffffffff01"
    );
  });

  it("omits proto3 default values but keeps empty submessages", () => {
    expect(hex(new ProtoWriter().string(1, "").uint64(2, 0).bool(3, false).finish())).toBe("");
    // field 1, length 0 — present but empty, unlike bytes().
    expect(hex(new ProtoWriter().message(1, new Uint8Array(0)).finish())).toBe(
      "0a00"
    );
  });

  it("rejects negative varints rather than emitting garbage", () => {
    expect(() => new ProtoWriter().uint64(1, -1).finish()).toThrow(/negative/);
  });
});

describe("SIGN_MODE_DIRECT assembly", () => {
  const pubKey = fromHex(
    "032fb5c4c9f2925792214e0b69b5ed63cce3eb34a56856c8a4a54f8c41e7f7d522"
  );

  it("wraps the message in a TxBody with a single Any", () => {
    const msg = fromHex("0a0568656c6c6f");
    const body = encodeTxBody(MSG_OPEN_GAME_INTENT_TYPE_URL, msg);
    // 0a = field 1 (messages), then an Any whose field 1 is the type URL.
    expect(hex(body).startsWith("0a")).toBe(true);
    expect(hex(body)).toContain(
      Buffer.from(MSG_OPEN_GAME_INTENT_TYPE_URL, "utf8").toString("hex")
    );
    expect(hex(body)).toContain(hex(msg));
  });

  it("builds an AuthInfo carrying the pubkey, SIGN_MODE_DIRECT and gas", () => {
    const authInfo = encodeAuthInfo({
      pubKey,
      sequence: "7",
      gasLimit: "400000",
    });
    const encoded = hex(authInfo);
    expect(encoded).toContain(hex(pubKey));
    expect(encoded).toContain(
      Buffer.from("/cosmos.crypto.secp256k1.PubKey", "utf8").toString("hex")
    );
    // mode_info: field 2, len 4 -> ModeInfo{ single: Single{ mode: 1 } }.
    expect(encoded).toContain("12040a020801");
    // sequence: field 3 varint 7.
    expect(encoded).toContain("1807");
    // Fee: gas_limit 400000 (field 2 varint 80 b5 18), no Coin amounts.
    expect(encoded).toContain("1080b518");
  });

  it("puts body, auth info, chain id and account number in the SignDoc", () => {
    const bodyBytes = fromHex("0a01ff");
    const authInfoBytes = fromHex("0a02aabb");
    const signDoc = encodeSignDoc({
      bodyBytes,
      authInfoBytes,
      chainId: "pokerchain-testnet-1",
      accountNumber: "12",
    });
    const encoded = hex(signDoc);
    expect(encoded).toContain(hex(bodyBytes));
    expect(encoded).toContain(hex(authInfoBytes));
    expect(encoded).toContain(
      Buffer.from("pokerchain-testnet-1", "utf8").toString("hex")
    );
    expect(encoded.endsWith("200c")).toBe(true);
  });

  it("omits account number 0, matching proto3 defaults", () => {
    const signDoc = encodeSignDoc({
      bodyBytes: fromHex("0a01ff"),
      authInfoBytes: fromHex("0a02aabb"),
      chainId: "c",
      accountNumber: "0",
    });
    expect(hex(signDoc)).not.toContain("2000");
  });

  it("assembles a TxRaw with the 64-byte signature", () => {
    const signature = new Uint8Array(64).fill(7);
    const raw = encodeTxRaw({
      bodyBytes: fromHex("0a01ff"),
      authInfoBytes: fromHex("0a02aabb"),
      signature,
    });
    expect(hex(raw)).toContain("1a40" + hex(signature));
  });
});
