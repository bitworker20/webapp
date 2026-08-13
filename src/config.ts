// Deployment configuration for the web client.
//
// Endpoints are defaults, not locks: the page lets the player point at another
// node or relay, which is what makes this client useful against a local dev
// chain as well as a shared testnet. Override at build time with Vite env vars
// (VITE_*) when deploying.
export const CHAIN_ID = import.meta.env["VITE_CHAIN_ID"] ?? "pokerchain-testnet-1";
export const BECH32_PREFIX = import.meta.env["VITE_BECH32_PREFIX"] ?? "xpoker";
export const DEFAULT_LCD_URL =
  import.meta.env["VITE_LCD_URL"] ?? "http://127.0.0.1:1317";
export const DEFAULT_RELAY_URL =
  import.meta.env["VITE_RELAY_URL"] ?? "ws://127.0.0.1:19910/relay";

// Above this balance the banner turns red and tells the player to move funds
// out. It is advice, not enforcement — nothing stops a player using a rich
// account, but nothing should let them do it without noticing either.
// 50 CHIP, in uchip.
export const OVERFUNDED_WARNING_UCHIP = "50000000";
