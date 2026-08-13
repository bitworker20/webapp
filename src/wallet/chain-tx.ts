// Cosmos SIGN_MODE_DIRECT transaction assembly for the pokerchain messages,
// with a hand-rolled proto3 writer.
//
// Why hand-rolled rather than cosmjs: the four pokerchain tx messages are flat
// scalar records that no published registry knows about, and SIGN_MODE_DIRECT
// only ever needs their encoded bytes inside an Any — so a ~100 line writer
// replaces a large dependency tree on a page that deliberately keeps its
// supply chain small (see docs/webapp-threat-model.md).
//
// This mirrors packages/background/src/bitpoker/{proto-writer,service}.ts in
// the Keplr fork, which does the same job for the extension. The two cannot
// share a file — that package compiles with `rootDir: "src"`, so it cannot
// include sources from outside itself — so they are pinned together instead by
// the golden vectors in ../poker/chain-tx-vectors.json, which both test suites
// assert against. If you change a field number here, that fixture must change
// too and the extension's spec will fail until its encoder matches.
//
// Field numbers come from pokerchain/proto/pokerchain/pokerchain/v1 and the
// standard cosmos.tx.v1beta1 / cosmos.crypto.secp256k1 protos.

export class ProtoWriter {
  protected readonly out: number[] = [];

  protected tag(field: number, wireType: number): void {
    this.varintValue((field << 3) | wireType);
  }

  protected varintValue(value: number | bigint): void {
    const zero = BigInt(0);
    const low7 = BigInt(0x7f);
    const shift = BigInt(7);
    let v = BigInt(value);
    if (v < zero) {
      throw new Error("negative varint is not supported");
    }
    for (;;) {
      const byte = Number(v & low7);
      v >>= shift;
      if (v === zero) {
        this.out.push(byte);
        return;
      }
      this.out.push(byte | 0x80);
    }
  }

  string(field: number, value?: string): this {
    if (!value) {
      return this;
    }
    return this.lengthDelimited(field, new TextEncoder().encode(value));
  }

  bytes(field: number, value?: Uint8Array): this {
    if (!value || value.length === 0) {
      return this;
    }
    return this.lengthDelimited(field, value);
  }

  // A nested message. Unlike bytes(), an empty encoding is still written: an
  // absent submessage and a present-but-default one are different on the wire,
  // and cosmos's SignDoc verification is byte-exact.
  message(field: number, value: Uint8Array): this {
    return this.lengthDelimited(field, value);
  }

  uint64(field: number, value?: number | string | bigint): this {
    if (value == null || value === 0 || value === "0") {
      return this;
    }
    this.tag(field, 0);
    this.varintValue(typeof value === "string" ? BigInt(value) : value);
    return this;
  }

  bool(field: number, value?: boolean): this {
    if (!value) {
      return this;
    }
    this.tag(field, 0);
    this.out.push(1);
    return this;
  }

  protected lengthDelimited(field: number, value: Uint8Array): this {
    this.tag(field, 2);
    this.varintValue(value.length);
    for (const byte of value) {
      this.out.push(byte);
    }
    return this;
  }

  finish(): Uint8Array {
    return new Uint8Array(this.out);
  }
}

// pokerchain GameType enum.
export const POKERCHAIN_GAME_TYPE_ZJH = 2;
export const POKERCHAIN_GAME_TYPE_TH = 3;

export const MSG_OPEN_GAME_INTENT_TYPE_URL =
  "/pokerchain.pokerchain.v1.MsgOpenGameIntent";
export const MSG_SUBMIT_SESSION_RESULT_TYPE_URL =
  "/pokerchain.pokerchain.v1.MsgSubmitSessionResult";
export const MSG_SUBMIT_SESSION_EVIDENCE_TYPE_URL =
  "/pokerchain.pokerchain.v1.MsgSubmitSessionEvidence";
export const MSG_SUBMIT_SESSION_SECRET_TYPE_URL =
  "/pokerchain.pokerchain.v1.MsgSubmitSessionSecret";

export function encodeMsgOpenGameIntent(msg: {
  creator: string;
  gameType: number;
  minStake: string;
  maxStake: string;
  opponent: string;
  playerSessionPubkey: string;
  // ADR-007: hex of a 33-byte compressed secp256k1 transport pubkey the
  // assigned relay encrypts this player's endpoint blob to.
  playerTransportPubkey?: string;
}): Uint8Array {
  return new ProtoWriter()
    .string(1, msg.creator)
    .uint64(2, msg.gameType)
    .uint64(3, msg.minStake)
    .uint64(4, msg.maxStake)
    .string(5, msg.opponent)
    .string(6, msg.playerSessionPubkey)
    .string(7, msg.playerTransportPubkey ?? "")
    .finish();
}

export function encodeMsgSubmitSessionResult(msg: {
  creator: string;
  sessionId: string;
  winner: string;
  loser: string;
  finalStake: string;
  transcriptHash: string;
  resultSignature: string;
  splitPot: boolean;
  playerAAmount: string;
  playerBAmount: string;
}): Uint8Array {
  return new ProtoWriter()
    .string(1, msg.creator)
    .uint64(2, msg.sessionId)
    .string(3, msg.winner)
    .string(4, msg.loser)
    .uint64(5, msg.finalStake)
    .string(6, msg.transcriptHash)
    .string(7, msg.resultSignature)
    .bool(8, msg.splitPot)
    .uint64(9, msg.playerAAmount)
    .uint64(10, msg.playerBAmount)
    .finish();
}

export function encodeMsgSubmitSessionEvidence(msg: {
  creator: string;
  sessionId: string;
  evidenceHash: string;
  evidencePayload: Uint8Array;
  evidenceSignature: string;
  reason: string;
}): Uint8Array {
  return new ProtoWriter()
    .string(1, msg.creator)
    .uint64(2, msg.sessionId)
    .string(3, msg.evidenceHash)
    .bytes(4, msg.evidencePayload)
    .string(5, msg.evidenceSignature)
    .string(6, msg.reason)
    .finish();
}

export function encodeMsgSubmitSessionSecret(msg: {
  creator: string;
  sessionId: string;
  sessionSecretKey: Uint8Array;
  sessionPubkey: Uint8Array;
}): Uint8Array {
  return new ProtoWriter()
    .string(1, msg.creator)
    .uint64(2, msg.sessionId)
    .bytes(3, msg.sessionSecretKey)
    .bytes(4, msg.sessionPubkey)
    .finish();
}

// --- cosmos.tx.v1beta1 assembly -------------------------------------------

const SIGN_MODE_DIRECT = 1;

// google.protobuf.Any
function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  return new ProtoWriter().string(1, typeUrl).bytes(2, value).finish();
}

// cosmos.crypto.secp256k1.PubKey
function encodeSecp256k1PubKey(pubKey: Uint8Array): Uint8Array {
  return new ProtoWriter().bytes(1, pubKey).finish();
}

export function encodeTxBody(
  typeUrl: string,
  msgValue: Uint8Array
): Uint8Array {
  // Single message per tx, no memo, no timeout height — matching the
  // extension's background service so both clients produce identical bodies.
  return new ProtoWriter()
    .message(1, encodeAny(typeUrl, msgValue))
    .finish();
}

export function encodeAuthInfo(args: {
  pubKey: Uint8Array;
  sequence: string;
  gasLimit: string;
}): Uint8Array {
  // ModeInfo{ single: Single{ mode: SIGN_MODE_DIRECT } }
  const single = new ProtoWriter().uint64(1, SIGN_MODE_DIRECT).finish();
  const modeInfo = new ProtoWriter().message(1, single).finish();
  const signerInfo = new ProtoWriter()
    .message(
      1,
      encodeAny(
        "/cosmos.crypto.secp256k1.PubKey",
        encodeSecp256k1PubKey(args.pubKey)
      )
    )
    .message(2, modeInfo)
    .uint64(3, args.sequence)
    .finish();
  // Fee carries a gas limit but no amount: pokerchain's dev/testnet gas price
  // is zero. A chain with a non-zero min gas price would need Coin entries in
  // field 1 here.
  const fee = new ProtoWriter().uint64(2, args.gasLimit).finish();
  return new ProtoWriter().message(1, signerInfo).message(2, fee).finish();
}

export function encodeSignDoc(args: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: string;
}): Uint8Array {
  return new ProtoWriter()
    .bytes(1, args.bodyBytes)
    .bytes(2, args.authInfoBytes)
    .string(3, args.chainId)
    .uint64(4, args.accountNumber)
    .finish();
}

export function encodeTxRaw(args: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  signature: Uint8Array;
}): Uint8Array {
  return new ProtoWriter()
    .bytes(1, args.bodyBytes)
    .bytes(2, args.authInfoBytes)
    .bytes(3, args.signature)
    .finish();
}
