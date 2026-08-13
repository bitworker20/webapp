// The account key while the tab is open.
//
// SCOPE OF PROTECTION — read this before adding a feature that touches it.
// This holder is NOT a security boundary. The key lives in the page's own JS
// heap, so any code running on this origin (an XSS, a poisoned dependency, a
// content script from a browser extension the user installed) can read it.
// That is an accepted, documented property of the web client, which is why the
// client is testnet / small-stakes only and the UI says so on every screen.
// See docs/webapp-threat-model.md.
//
// What the holder DOES buy:
//   - no persistence at all (no localStorage, no IndexedDB, no cookies), so
//     closing the tab really does end the exposure window, and an XSS has to
//     land while the user is playing rather than at any later visit;
//   - a single choke point where the key can be zeroed on logout;
//   - one place that owns address derivation, so the rest of the app passes
//     around a bech32 string instead of secret bytes.
//
// Do not add a "remember me" here. If that is ever wanted, it belongs behind a
// non-extractable WebCrypto key on a separate origin, not in this file.
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { bech32 } from "bech32";

export interface AccountIdentity {
  bech32Address: string;
  pubKey: Uint8Array;
  pubKeyHex: string;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export function deriveIdentity(
  privKey: Uint8Array,
  bech32Prefix: string
): AccountIdentity {
  const pubKey = secp256k1.getPublicKey(privKey, true);
  const address = ripemd160(sha256(pubKey));
  return {
    bech32Address: bech32.encode(bech32Prefix, bech32.toWords(address)),
    pubKey,
    pubKeyHex: toHex(pubKey),
  };
}

export class LockedError extends Error {
  constructor() {
    super("no key is loaded — import a key file first");
  }
}

export class KeyHolder {
  protected privKey: Uint8Array | null = null;
  protected identity: AccountIdentity | null = null;
  protected readonly listeners = new Set<() => void>();

  constructor(protected readonly bech32Prefix: string) {}

  // Takes ownership of privKey: the caller must not keep or reuse the array,
  // because unload() zeroes it in place.
  load(privKey: Uint8Array): AccountIdentity {
    if (privKey.length !== 32) {
      throw new Error(`private key must be 32 bytes, got ${privKey.length}`);
    }
    // Zero any previous key without going through unload(), so subscribers see
    // one transition (locked -> loaded) instead of a spurious unloaded frame.
    this.privKey?.fill(0);
    this.privKey = privKey;
    this.identity = deriveIdentity(privKey, this.bech32Prefix);
    this.notify();
    return this.identity;
  }

  unload(): void {
    if (this.privKey) {
      // Best effort only. JS gives us no way to chase copies the engine may
      // have made, so this shortens the window rather than closing it.
      this.privKey.fill(0);
    }
    this.privKey = null;
    this.identity = null;
    this.notify();
  }

  isLoaded(): boolean {
    return this.privKey !== null;
  }

  getIdentity(): AccountIdentity {
    if (!this.identity) {
      throw new LockedError();
    }
    return this.identity;
  }

  getIdentityOrNull(): AccountIdentity | null {
    return this.identity;
  }

  // Runs fn with the raw key. Kept as a callback rather than a getter so that
  // grepping for `withPrivKey` lists every site that touches secret material.
  withPrivKey<T>(fn: (privKey: Uint8Array) => T): T {
    if (!this.privKey) {
      throw new LockedError();
    }
    return fn(this.privKey);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
