// Reader for the ASCII-armored private keys that `pokerchaind keys export`
// produces, so a player can bring a testnet key to the web client without a
// separate conversion step.
//
// The format is cosmos-sdk's crypto/armor.go (verified against v0.53.6):
//
//   -----BEGIN TENDERMINT PRIVATE KEY-----
//   kdf: argon2
//   salt: <uppercase hex, 16 bytes>
//   type: secp256k1
//
//   <base64 ciphertext, wrapped>
//   =<CRC24 of the ciphertext, base64>
//   -----END TENDERMINT PRIVATE KEY-----
//
//   key       = argon2id(passphrase, salt, t=1, m=64MiB, p=4, dkLen=32)
//   plaintext = chacha20poly1305(key, nonce = 12 zero bytes).decrypt(ciphertext)
//   plaintext = E1B0F79B (amino prefix for tendermint/PrivKeySecp256k1)
//               || 0x20 (length) || privkey(32)
//
// The zero nonce is safe here only because the salt — and therefore the key —
// is fresh per encryption; it is not a mistake to be "fixed" on our side.
//
// SDK versions before the argon2 switch used bcrypt + xsalsa20-poly1305 and
// wrote `kdf: bcrypt`. We reject those with a message telling the user to
// re-export rather than carrying a second KDF and its bcrypt dependency.
import { argon2id } from "@noble/hashes/argon2";
import { chacha20poly1305 } from "@noble/ciphers/chacha";

const BLOCK_TYPE_PRIV_KEY = "TENDERMINT PRIVATE KEY";

// cosmos-sdk crypto/armor.go: argon2Time / argon2Memory / argon2Threads.
const ARGON2_TIME = 1;
const ARGON2_MEMORY_KIB = 64 * 1024;
const ARGON2_THREADS = 4;
const ARGON2_KEY_LENGTH = 32;

// legacy.Cdc amino prefix for "tendermint/PrivKeySecp256k1".
const AMINO_PREFIX_SECP256K1_PRIV_KEY = [0xe1, 0xb0, 0xf7, 0x9b];
const PRIV_KEY_LENGTH = 32;

export interface ArmorBlock {
  blockType: string;
  headers: Record<string, string>;
  data: Uint8Array;
}

export class ArmorError extends Error {}
export class WrongPassphraseError extends ArmorError {
  constructor() {
    super("wrong passphrase, or the key file is corrupt");
  }
}

// OpenPGP's CRC-24 (RFC 4880 §6.1): init 0xB704CE, polynomial 0x1864CFB.
export function crc24(bytes: Uint8Array): number {
  let crc = 0xb704ce;
  for (const byte of bytes) {
    crc ^= byte << 16;
    for (let bit = 0; bit < 8; bit++) {
      crc <<= 1;
      if (crc & 0x1000000) {
        crc ^= 0x1864cfb;
      }
    }
  }
  return crc & 0xffffff;
}

function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function decodeArmor(armor: string): ArmorBlock {
  // Tolerate CRLF and stray indentation: key files travel through editors,
  // chat apps and clipboards before they reach us.
  const lines = armor
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  const beginIndex = lines.findIndex(
    (line) => line.startsWith("-----BEGIN ") && line.endsWith("-----")
  );
  if (beginIndex < 0) {
    throw new ArmorError("no armor header found — expected a -----BEGIN line");
  }
  const blockType = lines[beginIndex].slice("-----BEGIN ".length, -"-----".length);

  const endIndex = lines.findIndex(
    (line, i) =>
      i > beginIndex && line === `-----END ${blockType}-----`
  );
  if (endIndex < 0) {
    throw new ArmorError(`missing the -----END ${blockType}----- line`);
  }

  const headers: Record<string, string> = {};
  let cursor = beginIndex + 1;
  for (; cursor < endIndex; cursor++) {
    const line = lines[cursor];
    if (line === "") {
      cursor++;
      break;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      throw new ArmorError(`malformed armor header line: ${line}`);
    }
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }

  const bodyLines: string[] = [];
  let checksumLine = "";
  for (; cursor < endIndex; cursor++) {
    const line = lines[cursor];
    if (line.startsWith("=")) {
      checksumLine = line;
      continue;
    }
    if (line !== "") {
      bodyLines.push(line);
    }
  }
  if (bodyLines.length === 0) {
    throw new ArmorError("armor block has no payload");
  }

  let data: Uint8Array;
  try {
    data = base64Decode(bodyLines.join(""));
  } catch {
    throw new ArmorError("armor payload is not valid base64");
  }

  // The checksum is advisory in OpenPGP but it is the only cheap way to tell
  // "you pasted half the file" apart from "you typed the wrong passphrase",
  // and those two need very different error messages.
  if (checksumLine !== "") {
    const expected = base64Decode(checksumLine.slice(1));
    if (expected.length !== 3) {
      throw new ArmorError("armor checksum is malformed");
    }
    const actual = crc24(data);
    const expectedValue =
      (expected[0] << 16) | (expected[1] << 8) | expected[2];
    if (actual !== expectedValue) {
      throw new ArmorError(
        "armor checksum mismatch — the key file looks truncated or edited"
      );
    }
  }

  return { blockType, headers, data };
}

export interface DecryptedPrivKey {
  privKey: Uint8Array;
  algo: string;
}

// Decrypts an armored key. The returned privKey is live secret material: the
// caller owns its lifetime and should zero it on logout (see KeyHolder).
export function decryptArmoredPrivKey(
  armor: string,
  passphrase: string
): DecryptedPrivKey {
  const block = decodeArmor(armor);
  if (block.blockType !== BLOCK_TYPE_PRIV_KEY) {
    throw new ArmorError(
      `unexpected armor type "${block.blockType}" — expected "${BLOCK_TYPE_PRIV_KEY}". ` +
        "Export the key with: pokerchaind keys export <name>"
    );
  }

  const kdf = block.headers["kdf"];
  if (kdf === "bcrypt") {
    throw new ArmorError(
      "this key was exported by an older pokerchaind (kdf: bcrypt). " +
        "Re-export it with the current binary to get an argon2 key file."
    );
  }
  if (kdf !== "argon2") {
    throw new ArmorError(`unsupported kdf "${kdf ?? ""}" in the key file`);
  }

  const saltHex = block.headers["salt"];
  if (!saltHex) {
    throw new ArmorError("key file is missing its salt header");
  }
  if (!/^[0-9a-fA-F]+$/.test(saltHex) || saltHex.length % 2 !== 0) {
    throw new ArmorError("key file salt is not valid hex");
  }
  const salt = new Uint8Array(saltHex.length / 2);
  for (let i = 0; i < salt.length; i++) {
    salt[i] = parseInt(saltHex.slice(i * 2, i * 2 + 2), 16);
  }

  const key = argon2id(new TextEncoder().encode(passphrase), salt, {
    t: ARGON2_TIME,
    m: ARGON2_MEMORY_KIB,
    p: ARGON2_THREADS,
    dkLen: ARGON2_KEY_LENGTH,
  });

  let plaintext: Uint8Array;
  try {
    plaintext = chacha20poly1305(key, new Uint8Array(12)).decrypt(block.data);
  } catch {
    // Poly1305 rejected the tag. With a correct file that means the passphrase
    // is wrong; a corrupt file would normally have failed the CRC above.
    throw new WrongPassphraseError();
  } finally {
    key.fill(0);
  }

  const expectedLength =
    AMINO_PREFIX_SECP256K1_PRIV_KEY.length + 1 + PRIV_KEY_LENGTH;
  if (plaintext.length !== expectedLength) {
    plaintext.fill(0);
    throw new ArmorError(
      `decrypted key has unexpected length ${plaintext.length} (want ${expectedLength})`
    );
  }
  const prefixMatches = AMINO_PREFIX_SECP256K1_PRIV_KEY.every(
    (byte, i) => plaintext[i] === byte
  );
  if (!prefixMatches || plaintext[4] !== PRIV_KEY_LENGTH) {
    plaintext.fill(0);
    throw new ArmorError(
      "decrypted key is not a secp256k1 private key — only secp256k1 accounts are supported"
    );
  }

  const privKey = plaintext.slice(5);
  plaintext.fill(0);

  return { privKey, algo: block.headers["type"] || "secp256k1" };
}
