/**
 * Single mutable session state for the Cast receiver (explicit data model).
 * Modules import `state` and mutate fields — avoids implicit globals.
 */
import { CUSTOM_PLAYER_STUB_URL } from "./constants.js";

export const defaultContract = {
  schemaVersion: 1,
  auth: {},
  token: {},
  proxy: {},
  networkPolicy: {},
  hosting: {},
  playback: {},
  channelName: "",
  debug: {},
};

export const state = {
  useCastReceiver: false,
  context: null,
  playerManager: null,

  activeContract: { ...defaultContract },

  activeCandidates: [],
  activeCandidateIndex: 0,
  lastLoadTemplate: null,
  loadSessionPreferredStartIndex: 0,
  receiverBackwardFallbackUsed: false,
  candidatesExhausted: false,
  candidateAdvanceInFlight: false,

  activeIptvUaIndex: 0,

  hlsInstance: null,
  hlsJsInvocationCounter: 0,
  dashInstance: null,
  mpegtsInstance: null,

  activeCustomPlayer: null,
  activeCustomPlayerUrl: "",
  pendingCustomPlayerBoot: null,

  stallWatchdogTimer: null,
  stallWatchdogSerial: 0,
  stallWatchdogBootDeferCount: 0,

  shakaFilterRegistered: false,
  volumeBridgeInstalled: false,

  activeIptvNetworkShim: null,

  debugEnabled: false,
  debugSequence: 0,
  debugHistory: [],

  CUSTOM_PLAYER_STUB_URL,
};
