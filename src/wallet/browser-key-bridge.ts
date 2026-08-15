// PokerWalletBridge backed by a key held in this page's memory.
//
// THREAT MODEL, IN ONE PARAGRAPH — do not extend this file without reading it.
// Unlike the extension's bridge, there is no process boundary here: the key,
// the game logic and the UI all run in one JS realm, so any code that achieves
// execution on this origin can both read the key and drive this bridge. The
// domain-prefix allowlist below therefore is NOT a security control the way its
// counterpart in the extension's background service is — it is a guard against
// our own mistakes (a caller accidentally signing the wrong thing), and an
// attacker in the page simply bypasses it by using the key directly. This is
// accepted: the web client is for testnet and small stakes, and says so on
// every screen. Real funds belong on the desktop or mobile client.
// Full write-up: docs/webapp-threat-model.md.
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import {
  OpenIntentArgs,
  PokerAccountKey,
  PokerTxResult,
  PokerWalletBridge,
  SubmitEvidenceArgs,
  SubmitResultArgs,
  SubmitSecretArgs,
} from "@bitpoker/poker-session/wallet-bridge";
import {
  adjustGas,
  Coin,
  feeForGas,
  fetchNodeGasPrice,
  GasPrice,
  simulateGasUsed,
} from "@bitpoker/poker-session/fees";
import { KeyHolder, toHex } from "./key-holder";
import {
  encodeAuthInfo,
  encodeMsgOpenGameIntent,
  encodeMsgSend,
  encodeMsgSubmitSessionEvidence,
  encodeMsgSubmitSessionResult,
  encodeMsgSubmitSessionSecret,
  encodeSignDoc,
  encodeTxBody,
  encodeTxRaw,
  MSG_OPEN_GAME_INTENT_TYPE_URL,
  MSG_SEND_TYPE_URL,
  MSG_SUBMIT_SESSION_EVIDENCE_TYPE_URL,
  MSG_SUBMIT_SESSION_RESULT_TYPE_URL,
  MSG_SUBMIT_SESSION_SECRET_TYPE_URL,
  POKERCHAIN_GAME_TYPE_TH,
} from "./chain-tx";

// Same list the extension's background service enforces: the raw signer signs
// sha256(payload) with the account key, so it must never be reachable for a
// Cosmos SignDoc, an ADR-36 doc, or any other byte string.
const ALLOWED_PAYLOAD_PREFIXES = [
  // Relay ClientHello auth ("cosmos-signature-v1"), relay_protocol.cpp
  "bitpoker-relay-client-hello-v1\n",
  // Relay reward receipt (ADR-005 / M5.3)
  "bitpoker-relay-receipt-v1\n",
  // submit-session-evidence authentication (ADR-003)
  "bitpoker-session-evidence-v1\n",
];

// Fallbacks only. The gas limit normally comes from simulating the tx against
// the node (see resolveGasLimit); these are what a tx pays when the node
// refuses to simulate — the numbers this client used to hard-code, and the
// ones the extension's background service still does. Evidence carries the
// full message-history payload, so it pays a per-byte write cost.
const GAS_LIMIT_DEFAULT = "400000";
const GAS_LIMIT_EVIDENCE = "3000000";

// A simulated tx is never verified, but the signature slot must exist and be
// the right length or the ante handler rejects the shape before measuring.
const DUMMY_SIGNATURE = new Uint8Array(64);

// The denom this wallet holds, and so the one it wants to pay fees in when a
// node advertises several prices.
const FEE_DENOM = "uchip";

export interface IntentApprovalRequest {
  chainId: string;
  signer: string;
  gameType: number;
  minStake: string;
  maxStake: string;
  opponent: string;
}

export interface BrowserKeyBridgeOptions {
  keyHolder: KeyHolder;
  // Where account number/sequence are read and transactions are posted. Kept
  // mutable via setLcdUrl so the page's endpoint field stays authoritative.
  lcdUrl: string;
  // Called before the one transaction that locks funds. Resolving true
  // proceeds. This is a UX confirmation, not a security boundary — see the
  // note at the top of this file.
  onApproveIntent?: (request: IntentApprovalRequest) => Promise<boolean>;
}

export class BrowserKeyBridge implements PokerWalletBridge {
  protected readonly keyHolder: KeyHolder;
  protected lcdUrl: string;
  protected gasPrice?: {
    lcdUrl: string;
    price: Promise<GasPrice | undefined>;
  };
  protected readonly onApproveIntent?: (
    request: IntentApprovalRequest
  ) => Promise<boolean>;

  constructor(options: BrowserKeyBridgeOptions) {
    this.keyHolder = options.keyHolder;
    this.lcdUrl = options.lcdUrl.replace(/\/+$/, "");
    this.onApproveIntent = options.onApproveIntent;
  }

  setLcdUrl(lcdUrl: string): void {
    this.lcdUrl = lcdUrl.replace(/\/+$/, "");
  }

  static isAllowedPayload(payload: string): boolean {
    return ALLOWED_PAYLOAD_PREFIXES.some((prefix) => payload.startsWith(prefix));
  }

  async getKey(_chainId: string): Promise<PokerAccountKey> {
    const identity = this.keyHolder.getIdentity();
    return {
      bech32Address: identity.bech32Address,
      pubkeyHex: identity.pubKeyHex,
    };
  }

  // compressed_pubkey(33) || r(32) || s(32), hex — the 97-byte layout the
  // relay's cosmos-signature-v1 verifier and the chain's evidence check expect.
  async signPayload(
    _chainId: string,
    payload: string
  ): Promise<{ signature: string }> {
    if (!BrowserKeyBridge.isAllowedPayload(payload)) {
      throw new Error(
        "bitpoker sign payload must start with an allowed bitpoker domain prefix"
      );
    }
    const identity = this.keyHolder.getIdentity();
    const signature = this.signHash(sha256(new TextEncoder().encode(payload)));
    return { signature: toHex(identity.pubKey) + toHex(signature) };
  }

  async openIntent(
    chainId: string,
    args: OpenIntentArgs
  ): Promise<PokerTxResult> {
    const { bech32Address } = await this.getKey(chainId);
    const gameType = args.gameType || POKERCHAIN_GAME_TYPE_TH;

    if (this.onApproveIntent) {
      const approved = await this.onApproveIntent({
        chainId,
        signer: bech32Address,
        gameType,
        minStake: args.minStake,
        maxStake: args.maxStake,
        opponent: args.opponent,
      });
      if (!approved) {
        throw new Error("the game intent was rejected");
      }
    }

    return this.broadcast(
      chainId,
      MSG_OPEN_GAME_INTENT_TYPE_URL,
      encodeMsgOpenGameIntent({
        creator: bech32Address,
        gameType,
        minStake: args.minStake,
        maxStake: args.maxStake,
        opponent: args.opponent,
        playerSessionPubkey: args.playerSessionPubkey,
        playerTransportPubkey: args.playerTransportPubkey,
      }),
      GAS_LIMIT_DEFAULT
    );
  }

  async submitResult(
    chainId: string,
    args: SubmitResultArgs
  ): Promise<PokerTxResult> {
    const { bech32Address } = await this.getKey(chainId);
    return this.broadcast(
      chainId,
      MSG_SUBMIT_SESSION_RESULT_TYPE_URL,
      encodeMsgSubmitSessionResult({ creator: bech32Address, ...args }),
      GAS_LIMIT_DEFAULT
    );
  }

  async submitEvidence(
    chainId: string,
    args: SubmitEvidenceArgs
  ): Promise<PokerTxResult> {
    const { bech32Address } = await this.getKey(chainId);
    return this.broadcast(
      chainId,
      MSG_SUBMIT_SESSION_EVIDENCE_TYPE_URL,
      encodeMsgSubmitSessionEvidence({
        creator: bech32Address,
        sessionId: args.sessionId,
        evidenceHash: args.evidenceHash,
        evidencePayload: hexToBytes(args.payloadHex),
        evidenceSignature: args.signature,
        reason: args.reason,
      }),
      GAS_LIMIT_EVIDENCE
    );
  }

  async submitSecret(
    chainId: string,
    args: SubmitSecretArgs
  ): Promise<PokerTxResult> {
    const { bech32Address } = await this.getKey(chainId);
    return this.broadcast(
      chainId,
      MSG_SUBMIT_SESSION_SECRET_TYPE_URL,
      encodeMsgSubmitSessionSecret({
        creator: bech32Address,
        sessionId: args.sessionId,
        sessionSecretKey: hexToBytes(args.secretKeyHex),
        sessionPubkey: hexToBytes(args.pubkeyHex),
      }),
      GAS_LIMIT_DEFAULT
    );
  }

  // --- wallet operations (not part of PokerWalletBridge) ---------------------
  //
  // A plain bank transfer. It is on this class rather than on the shared
  // PokerWalletBridge interface because it has nothing to do with poker: the
  // extension's page never sends one, since Keplr already has a send screen.

  async sendCoins(
    chainId: string,
    args: { toAddress: string; amount: Coin; memo?: string }
  ): Promise<PokerTxResult> {
    const { bech32Address } = await this.getKey(chainId);
    return this.broadcast(
      chainId,
      MSG_SEND_TYPE_URL,
      encodeMsgSend({
        fromAddress: bech32Address,
        toAddress: args.toAddress,
        amount: [args.amount],
      }),
      GAS_LIMIT_DEFAULT,
      args.memo
    );
  }

  // What a transfer would cost, without sending it — so the UI can show the
  // fee next to the amount instead of surprising the player after the fact.
  // Same two questions to the chain as the real send, so the preview is the
  // number that will actually be paid (give or take a sequence bump).
  async estimateSend(
    chainId: string,
    args: { toAddress: string; amount: Coin; memo?: string }
  ): Promise<{ gasLimit: string; fee?: Coin }> {
    const { bech32Address } = await this.getKey(chainId);
    const { sequence } = await this.fetchAccount(bech32Address);
    const bodyBytes = encodeTxBody(
      MSG_SEND_TYPE_URL,
      encodeMsgSend({
        fromAddress: bech32Address,
        toAddress: args.toAddress,
        amount: [args.amount],
      }),
      args.memo
    );
    return this.resolveCost(bodyBytes, sequence, GAS_LIMIT_DEFAULT);
  }

  // secp256k1 over a 32-byte digest, returned as r(32) || s(32). Cosmos
  // rejects high-S signatures; noble normalises to low-S by default.
  protected signHash(digest: Uint8Array): Uint8Array {
    return this.keyHolder.withPrivKey((privKey) =>
      secp256k1.sign(digest, privKey).toCompactRawBytes()
    );
  }

  protected async broadcast(
    chainId: string,
    typeUrl: string,
    msgValue: Uint8Array,
    fallbackGasLimit: string,
    memo?: string
  ): Promise<PokerTxResult> {
    const identity = this.keyHolder.getIdentity();
    const { accountNumber, sequence } = await this.fetchAccount(
      identity.bech32Address
    );
    const bodyBytes = encodeTxBody(typeUrl, msgValue, memo);
    const { gasLimit, fee } = await this.resolveCost(
      bodyBytes,
      sequence,
      fallbackGasLimit
    );

    const authInfoBytes = encodeAuthInfo({
      pubKey: identity.pubKey,
      sequence,
      gasLimit,
      feeAmount: fee ? [fee] : undefined,
    });
    const signDocBytes = encodeSignDoc({
      bodyBytes,
      authInfoBytes,
      chainId,
      accountNumber,
    });
    const txRawBytes = encodeTxRaw({
      bodyBytes,
      authInfoBytes,
      signature: this.signHash(sha256(signDocBytes)),
    });

    return this.broadcastTxRaw(txRawBytes);
  }

  // What this tx will cost, both numbers asked of the chain rather than
  // guessed: gas from a simulated run, price from the node's own config.
  //
  // Either question may go unanswered — an older SDK, a gateway that hides the
  // node service, a simulation the node declines — and neither is worth
  // failing a transaction over, so each falls back to what this client did
  // before it learned to ask: the caller's fixed gas limit, and no fee coin.
  protected async resolveCost(
    bodyBytes: Uint8Array,
    sequence: string,
    fallbackGasLimit: string
  ): Promise<{ gasLimit: string; fee?: Coin }> {
    const [gasLimit, price] = await Promise.all([
      this.resolveGasLimit(bodyBytes, sequence, fallbackGasLimit),
      this.resolveGasPrice(),
    ]);
    return { gasLimit, fee: price ? feeForGas(gasLimit, price) : undefined };
  }

  protected async resolveGasLimit(
    bodyBytes: Uint8Array,
    sequence: string,
    fallbackGasLimit: string
  ): Promise<string> {
    const identity = this.keyHolder.getIdentity();
    // Gas limit 0 in the simulated tx: the simulation runs on an infinite
    // meter, and passing the number we are trying to compute would be circular.
    const authInfoBytes = encodeAuthInfo({
      pubKey: identity.pubKey,
      sequence,
      gasLimit: "0",
    });
    try {
      const used = await simulateGasUsed(
        this.lcdUrl,
        base64Encode(
          encodeTxRaw({ bodyBytes, authInfoBytes, signature: DUMMY_SIGNATURE })
        )
      );
      return adjustGas(used);
    } catch {
      return fallbackGasLimit;
    }
  }

  // Cached per endpoint: a node's minimum gas price comes from its app.toml
  // and changes on restart, not between transactions.
  protected async resolveGasPrice(): Promise<GasPrice | undefined> {
    if (this.gasPrice?.lcdUrl !== this.lcdUrl) {
      this.gasPrice = {
        lcdUrl: this.lcdUrl,
        price: fetchNodeGasPrice(this.lcdUrl, FEE_DENOM),
      };
    }
    return this.gasPrice.price;
  }

  protected async fetchAccount(
    address: string
  ): Promise<{ accountNumber: string; sequence: string }> {
    const res = await fetch(
      `${this.lcdUrl}/cosmos/auth/v1beta1/accounts/${address}`
    );
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? `account ${address} does not exist on chain yet — fund it first`
          : `account lookup failed: ${res.status}`
      );
    }
    const body = await res.json();
    const account = body?.account ?? {};
    // A vesting or module account nests the base account one level down.
    const base = account.base_account ?? account;
    return {
      accountNumber: String(base.account_number ?? "0"),
      sequence: String(base.sequence ?? "0"),
    };
  }

  protected async broadcastTxRaw(txRawBytes: Uint8Array): Promise<PokerTxResult> {
    const res = await fetch(`${this.lcdUrl}/cosmos/tx/v1beta1/txs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_bytes: base64Encode(txRawBytes),
        mode: "BROADCAST_MODE_SYNC",
      }),
    });
    if (!res.ok) {
      throw new Error(`broadcast failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    const response = body?.tx_response;
    if (!response) {
      throw new Error("broadcast response had no tx_response");
    }
    return {
      txHash: String(response.txhash ?? ""),
      code: Number(response.code ?? 0),
      rawLog: String(response.raw_log ?? ""),
    };
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("hex string has an odd length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
