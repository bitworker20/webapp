import { describe, expect, it } from "vitest";
import { bech32 } from "bech32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import {
  ArmorError,
  WrongPassphraseError,
  crc24,
  decodeArmor,
  decryptArmoredPrivKey,
} from "./armor";

// Golden vector produced by the real toolchain, so this test pins our reader
// against cosmos-sdk's writer rather than against itself:
//
//   pokerchaind keys add fixture --keyring-backend test --keyring-dir ./kh
//   pokerchaind keys export fixture --keyring-backend test --keyring-dir ./kh
//   (passphrase: testpass123)
//
// Regenerate the same way if the SDK ever changes its KDF or cipher — a
// failure here means the web client can no longer read exported keys.
const FIXTURE_PASSPHRASE = "testpass123";
const FIXTURE_ADDRESS = "xpoker1uflvlfueyjkvpfmtgyzt6txskpqn3qchu5kqch";
const FIXTURE_PUBKEY_BASE64 = "Ay+1xMnykleSIU4LabXtY8zj6zSlaFbIpKVPjEHn99Ui";
const FIXTURE_ARMOR = `-----BEGIN TENDERMINT PRIVATE KEY-----
kdf: argon2
salt: 9374F63E413933FF1F888E6EF9001728
type: secp256k1

qQTcf7tSYZ+8NYQVHTI1meYJwR5rit03lM6SIirS+8+B/RBVlPmjSV1NAJ5IBncp
H03hgFM=
=pgvk
-----END TENDERMINT PRIVATE KEY-----`;

function bech32AddressOf(privKey: Uint8Array): string {
  const pubKey = secp256k1.getPublicKey(privKey, true);
  return bech32.encode("xpoker", bech32.toWords(ripemd160(sha256(pubKey))));
}

describe("decodeArmor", () => {
  it("parses the block type, headers and payload", () => {
    const block = decodeArmor(FIXTURE_ARMOR);
    expect(block.blockType).toBe("TENDERMINT PRIVATE KEY");
    expect(block.headers).toEqual({
      kdf: "argon2",
      salt: "9374F63E413933FF1F888E6EF9001728",
      type: "secp256k1",
    });
    // 37 plaintext bytes + the 16-byte poly1305 tag.
    expect(block.data.length).toBe(53);
  });

  it("accepts CRLF line endings and surrounding whitespace", () => {
    const messy = `\n  ${FIXTURE_ARMOR.replace(/\n/g, "\r\n  ")}  \n`;
    expect(decodeArmor(messy).headers["kdf"]).toBe("argon2");
  });

  it("rejects a truncated payload via the CRC24 checksum", () => {
    const truncated = FIXTURE_ARMOR.replace("H03hgFM=", "H03hgA==");
    expect(() => decodeArmor(truncated)).toThrow(/checksum mismatch/);
  });

  it("rejects input with no armor header", () => {
    expect(() => decodeArmor("just some text")).toThrow(ArmorError);
  });

  it("computes the OpenPGP CRC-24 of the empty string", () => {
    // RFC 4880's initialisation value, unchanged by zero input.
    expect(crc24(new Uint8Array(0))).toBe(0xb704ce);
  });
});

describe("decryptArmoredPrivKey", () => {
  it("recovers the key that pokerchaind exported", () => {
    const { privKey, algo } = decryptArmoredPrivKey(
      FIXTURE_ARMOR,
      FIXTURE_PASSPHRASE
    );
    expect(algo).toBe("secp256k1");
    expect(privKey.length).toBe(32);

    const pubKey = secp256k1.getPublicKey(privKey, true);
    expect(Buffer.from(pubKey).toString("base64")).toBe(FIXTURE_PUBKEY_BASE64);
    expect(bech32AddressOf(privKey)).toBe(FIXTURE_ADDRESS);
  });

  it("reports a wrong passphrase distinctly from a corrupt file", () => {
    expect(() => decryptArmoredPrivKey(FIXTURE_ARMOR, "not-the-passphrase"))
      .toThrow(WrongPassphraseError);
  });

  it("tells the user to re-export a legacy bcrypt key file", () => {
    const legacy = FIXTURE_ARMOR.replace("kdf: argon2", "kdf: bcrypt");
    expect(() => decryptArmoredPrivKey(legacy, FIXTURE_PASSPHRASE)).toThrow(
      /re-export/i
    );
  });

  it("rejects an armored public key", () => {
    const pubBlock = FIXTURE_ARMOR.replace(
      /TENDERMINT PRIVATE KEY/g,
      "TENDERMINT PUBLIC KEY"
    );
    expect(() => decryptArmoredPrivKey(pubBlock, FIXTURE_PASSPHRASE)).toThrow(
      /unexpected armor type/
    );
  });
});
