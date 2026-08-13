import { describe, expect, it } from "vitest";
import { KeyHolder, LockedError, deriveIdentity, toHex } from "./key-holder";

// Same account as armor.spec.ts's golden vector.
const FIXTURE_PRIV_KEY = Uint8Array.from(
  Buffer.from(
    "21B9CED055A26FCACFCA81C43BC63164EC45512C6EA0294E6DF4811D060C30E4",
    "hex"
  )
);
const FIXTURE_ADDRESS = "xpoker1uflvlfueyjkvpfmtgyzt6txskpqn3qchu5kqch";

describe("deriveIdentity", () => {
  it("derives the bech32 address pokerchaind reports for the key", () => {
    const identity = deriveIdentity(FIXTURE_PRIV_KEY, "xpoker");
    expect(identity.bech32Address).toBe(FIXTURE_ADDRESS);
    expect(identity.pubKey.length).toBe(33);
    expect(identity.pubKeyHex).toBe(toHex(identity.pubKey));
  });

  it("honours the chain's bech32 prefix", () => {
    expect(deriveIdentity(FIXTURE_PRIV_KEY, "cosmos").bech32Address).toMatch(
      /^cosmos1/
    );
  });
});

describe("KeyHolder", () => {
  it("throws until a key is loaded", () => {
    const holder = new KeyHolder("xpoker");
    expect(holder.isLoaded()).toBe(false);
    expect(() => holder.getIdentity()).toThrow(LockedError);
    expect(() => holder.withPrivKey((k) => k)).toThrow(LockedError);
  });

  it("exposes the identity once loaded", () => {
    const holder = new KeyHolder("xpoker");
    const identity = holder.load(FIXTURE_PRIV_KEY.slice());
    expect(identity.bech32Address).toBe(FIXTURE_ADDRESS);
    expect(holder.getIdentity().bech32Address).toBe(FIXTURE_ADDRESS);
  });

  it("zeroes the key material on unload", () => {
    const holder = new KeyHolder("xpoker");
    const owned = FIXTURE_PRIV_KEY.slice();
    holder.load(owned);
    holder.unload();
    expect(holder.isLoaded()).toBe(false);
    expect(Array.from(owned).every((byte) => byte === 0)).toBe(true);
  });

  it("zeroes the previous key when a second one is loaded", () => {
    const holder = new KeyHolder("xpoker");
    const first = FIXTURE_PRIV_KEY.slice();
    holder.load(first);
    holder.load(FIXTURE_PRIV_KEY.slice());
    expect(Array.from(first).every((byte) => byte === 0)).toBe(true);
    expect(holder.getIdentity().bech32Address).toBe(FIXTURE_ADDRESS);
  });

  it("notifies subscribers with the new state, once per transition", () => {
    const holder = new KeyHolder("xpoker");
    const seen: boolean[] = [];
    const unsubscribe = holder.subscribe(() => seen.push(holder.isLoaded()));

    holder.load(FIXTURE_PRIV_KEY.slice());
    holder.unload();
    // Replacing a key must not emit a transient "locked" frame in between.
    holder.load(FIXTURE_PRIV_KEY.slice());
    holder.load(FIXTURE_PRIV_KEY.slice());
    expect(seen).toEqual([true, false, true, true]);

    unsubscribe();
    holder.unload();
    expect(seen).toEqual([true, false, true, true]);
  });

  it("rejects a key of the wrong length", () => {
    const holder = new KeyHolder("xpoker");
    expect(() => holder.load(new Uint8Array(16))).toThrow(/32 bytes/);
  });
});
