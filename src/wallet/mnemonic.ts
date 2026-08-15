// BIP39 mnemonic + BIP44 derivation for creating and recovering a testnet
// account in the page.
//
// The point of doing this here rather than sending people to `pokerchaind keys
// export` is that a browser visitor has no node. The point of doing it with the
// *same* parameters as every other client — 24 or 12 English words, cosmos coin
// type 118, path m/44'/118'/0'/0/0 — is that an account created here is not a
// browser-only account: the identical key comes back from `pokerchaind keys add
// --recover`, from the mobile app's recover flow, and from Keplr.
// bitpoker/include/wallet/hd_wallet.hpp is the native side of the same contract,
// and mnemonic.spec.ts pins both against one golden vector.
//
// The mnemonic never leaves the page and is never persisted — same rule as the
// key itself (see docs/webapp-threat-model.md). A generated account that the
// player does not write down is gone when the tab closes, which is why the UI
// makes recording it a step rather than a suggestion.
import { HDKey } from "@scure/bip32";
import {
  generateMnemonic as bip39Generate,
  mnemonicToSeedSync,
  validateMnemonic as bip39Validate,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

// Cosmos default: coin type 118, account 0, external chain, index 0.
export const COSMOS_DERIVATION_PATH = "m/44'/118'/0'/0/0";

// 256 bits of entropy = 24 words, matching the native clients' default
// (bitpoker/app/mobile CreateWalletPage). 128 bits (12 words) is also valid and
// accepted on the import side.
const DEFAULT_STRENGTH_BITS = 256;

export class MnemonicError extends Error {}

/** A fresh 24-word English mnemonic from the platform CSPRNG. */
export function generateMnemonic(strengthBits = DEFAULT_STRENGTH_BITS): string {
  return bip39Generate(wordlist, strengthBits);
}

/** BIP39 wordlist + checksum check. Does not say anything about derivation. */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39Validate(normalizeMnemonic(mnemonic), wordlist);
}

// Players paste mnemonics out of password managers, PDFs and chat windows, so
// the input arrives with newlines, tabs, double spaces and stray case. All of
// those are recoverable without ambiguity; anything else is a real typo and
// should fail the checksum rather than be guessed at.
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/u).join(" ");
}

/**
 * Derive the 32-byte secp256k1 private key for `mnemonic` at `path`.
 *
 * The caller owns the returned array and should hand it straight to
 * KeyHolder.load(), which takes ownership and zeroes it on unload.
 */
export function mnemonicToPrivKey(
  mnemonic: string,
  path: string = COSMOS_DERIVATION_PATH
): Uint8Array {
  const normalized = normalizeMnemonic(mnemonic);
  if (!bip39Validate(normalized, wordlist)) {
    throw new MnemonicError(
      "not a valid BIP39 mnemonic — check the word count and that every word is spelled correctly"
    );
  }
  // Empty BIP39 passphrase: this is what pokerchaind, Keplr and the mobile
  // client all use. A non-empty one would silently derive a different account
  // from the same words, which is a support nightmare, so it is not exposed.
  const seed = mnemonicToSeedSync(normalized, "");
  const derived = HDKey.fromMasterSeed(seed).derive(path);
  if (!derived.privateKey) {
    throw new MnemonicError(`derivation path ${path} produced no private key`);
  }
  // Copy out before the HDKey's own buffers go out of scope, so the value we
  // hand to KeyHolder is one we can zero later.
  return Uint8Array.from(derived.privateKey);
}
