/** @type {readonly string[]} */
export const IPTV_USER_AGENTS = [
  "VLC/3.0.20 LibVLC/3.0.20",
  "Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "PreetTV Cast/1.0",
];

export const DEFAULT_IPTV_USER_AGENT = IPTV_USER_AGENTS[1];
export const CUSTOM_PLAYER_STUB_URL = "about:blank";
export const DEBUG_HISTORY_LIMIT = 200;

export const STALL_WATCHDOG_MS = 22000;
export const STALL_WATCHDOG_BOOT_DEFER_MAX = 6;
export const HLS_BOOT_TIMEOUT_MS = 35000;
export const MPEGTS_BOOT_WALL_MS = 55000;
