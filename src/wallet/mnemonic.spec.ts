import { describe, expect, it } from "vitest";
import { deriveIdentity, toHex } from "./key-holder";
import {
  COSMOS_DERIVATION_PATH,
  MnemonicError,
  generateMnemonic,
  mnemonicToPrivKey,
  normalizeMnemonic,
  validateMnemonic,
} from "./mnemonic";

// The canonical all-"abandon" BIP39 vector, and the key/address pokerchaind
// derives from it. Identical constants to bitpoker/test/wallet/hd_wallet_test.cpp
// (CosmosPrivateKeyMatchesPokerchaind / DerivedAddressMatchesPokerchaind), which
// is the whole point: an account created in this page has to be the same account
// the CLI, the desktop client and the mobile app see.
const VECTOR_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const VECTOR_PRIVKEY_HEX =
  "c4a48e2fce1481cd3294b4490f6678090ea98d3d0e5cd984558ab0968741b104";
const VECTOR_ADDRESS = "xpoker19rl4cm2hmr8afy4kldpxz3fka4jguq0aesmg4r";

describe("mnemonicToPrivKey", () => {
  it("matches the key pokerchaind derives from the same words", () => {
    expect(toHex(mnemonicToPrivKey(VECTOR_MNEMONIC))).toBe(VECTOR_PRIVKEY_HEX);
  });

  it("matches the address pokerchaind derives from the same words", () => {
    const priv = mnemonicToPrivKey(VECTOR_MNEMONIC);
    expect(deriveIdentity(priv, "xpoker").bech32Address).toBe(VECTOR_ADDRESS);
  });

  it("uses the cosmos path by default", () => {
    expect(COSMOS_DERIVATION_PATH).toBe("m/44'/118'/0'/0/0");
    expect(toHex(mnemonicToPrivKey(VECTOR_MNEMONIC, COSMOS_DERIVATION_PATH))).toBe(
      VECTOR_PRIVKEY_HEX
    );
  });

  it("derives a different key off a different path", () => {
    const other = mnemonicToPrivKey(VECTOR_MNEMONIC, "m/44'/118'/0'/0/1");
    expect(toHex(other)).not.toBe(VECTOR_PRIVKEY_HEX);
  });

  it("tolerates the whitespace and case a paste brings with it", () => {
    const messy = `  ABANDON abandon\tabandon abandon abandon abandon
      abandon abandon abandon  abandon abandon ABOUT `;
    expect(toHex(mnemonicToPrivKey(messy))).toBe(VECTOR_PRIVKEY_HEX);
  });

  it("rejects a wrong checksum rather than deriving something plausible", () => {
    // Last word changed: still all wordlist words, still 12 of them.
    const bad = VECTOR_MNEMONIC.replace(/about$/u, "abandon");
    expect(() => mnemonicToPrivKey(bad)).toThrow(MnemonicError);
  });

  it("rejects a word that is not in the list", () => {
    expect(() => mnemonicToPrivKey(VECTOR_MNEMONIC.replace("about", "zzzz"))).toThrow(
      MnemonicError
    );
  });

  it("rejects a wrong word count", () => {
    expect(() => mnemonicToPrivKey("abandon about")).toThrow(MnemonicError);
  });
});

describe("generateMnemonic", () => {
  it("produces 24 words by default, matching the native clients", () => {
    expect(generateMnemonic().split(" ")).toHaveLength(24);
  });

  it("produces a mnemonic that validates and derives a 32-byte key", () => {
    const mnemonic = generateMnemonic();
    expect(validateMnemonic(mnemonic)).toBe(true);
    expect(mnemonicToPrivKey(mnemonic)).toHaveLength(32);
  });

  it("does not repeat itself", () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic());
  });

  it("still supports 12 words when asked", () => {
    expect(generateMnemonic(128).split(" ")).toHaveLength(12);
  });
});

describe("normalizeMnemonic", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeMnemonic("  One   TWO\tthree\n")).toBe("one two three");
  });
});
