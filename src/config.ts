// Deployment configuration for the web client.
//
// These are the publisher's choice, not the player's: the deployed page does
// not offer an endpoint field, because a node the player was talked into
// pasting can lie about balances, session state and relay assignments. Point a
// build somewhere else with the Vite env vars below — for local development
// that means a `.env.local`, not typing into the page.
//
// (The same page rendered by the Keplr extension does show the field: it is
// passed no defaults, so that is the only way its endpoint gets set. See
// PokerPageProps.endpointsFixed.)
export const CHAIN_ID = import.meta.env["VITE_CHAIN_ID"] ?? "pokerchain-testnet-1";
export const BECH32_PREFIX = import.meta.env["VITE_BECH32_PREFIX"] ?? "xpoker";
export const DEFAULT_LCD_URL =
  import.meta.env["VITE_LCD_URL"] ?? "http://127.0.0.1:1317";
export const DEFAULT_RELAY_URL =
  import.meta.env["VITE_RELAY_URL"] ?? "ws://127.0.0.1:19910/relay";

// Where poker-faucetd answers, if this deployment has one. Empty is a normal
// configuration — the wallet then tells the player to get chips elsewhere
// instead of offering a button that cannot work. The faucet is invitation-only
// on the public testnet, so the claim form asks for the code the player was
// sent; see docs/faucet/README.md.
export const FAUCET_URL = import.meta.env["VITE_FAUCET_URL"] ?? "";

// Said on the risk gate and again in the banner, in the same words both times.
export const DESKTOP_CLIENT_NOTE =
  "For real funds use the desktop or mobile client, where the key lives outside the browser.";

// Above this balance the banner turns red and tells the player to move funds
// out. It is advice, not enforcement — nothing stops a player using a rich
// account, but nothing should let them do it without noticing either.
// 50 CHIP, in uchip.
export const OVERFUNDED_WARNING_UCHIP = "50000000";
