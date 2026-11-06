export const TRACK_SLOT = {
  screenVideo: 0,
  screenAudio: 1,
  mic: 2,
} as const;

export type TrackSlot = (typeof TRACK_SLOT)[keyof typeof TRACK_SLOT];

export const SLOT_KINDS = ['video', 'audio', 'audio'] as const;

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
];

export const PEER_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  pingInterval: 5000,
  config: { iceServers: ICE_SERVERS },
};

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Low-power constraints for mobile to prevent overheating
export function getScreenConstraints(): DisplayMediaStreamOptions {
  if (isIOS()) {
    return {
      video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 10 } },
    };
  }
  return {
    video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } },
    audio: { echoCancellation: false, noiseSuppression: false },
  };
}

const PLACEHOLDER_TAG = '__placeholder__';
function tagPlaceholder(track: MediaStreamTrack) {
  (track as unknown as Record<string, unknown>)[PLACEHOLDER_TAG] = true;
}
export function isPlaceholderTrack(track: MediaStreamTrack): boolean {
  return !!(track as unknown as Record<string, unknown>)[PLACEHOLDER_TAG];
}

let _placeholderCtx: AudioContext | null = null;
let _placeholderDests: MediaStreamAudioDestinationNode[] = [];

export function createPlaceholderStream(): MediaStream {
  if (!_placeholderCtx) _placeholderCtx = new AudioContext();
  if (_placeholderDests.length === 0) {
    _placeholderDests = [
      _placeholderCtx.createMediaStreamDestination(),
      _placeholderCtx.createMediaStreamDestination(),
    ];
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (ctx) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 2, 2); }
  const [video] = canvas.captureStream(1).getVideoTracks();
  const a1 = _placeholderDests[0].stream.getAudioTracks()[0];
  const a2 = _placeholderDests[1].stream.getAudioTracks()[0];
  [video, a1, a2].forEach(t => t && tagPlaceholder(t));
  return new MediaStream([video, a1, a2].filter(Boolean));
}

function transceiversOfKind(pc: RTCPeerConnection, kind: string) {
  return pc.getTransceivers().filter(t => t.receiver.track.kind === kind);
}

// slot 0 -> 1st video, slot 1 -> 1st audio, slot 2 -> 2nd audio
export function getSlotTransceiver(pc: RTCPeerConnection, slot: TrackSlot) {
  const kind = SLOT_KINDS[slot];
  const nth = SLOT_KINDS.slice(0, slot).filter(k => k === kind).length;
  return transceiversOfKind(pc, kind)[nth];
}

export function slotForReceiver(pc: RTCPeerConnection, receiver: RTCRtpReceiver): TrackSlot | -1 {
  const kind = receiver.track.kind;
  const nth = transceiversOfKind(pc, kind).findIndex(t => t.receiver === receiver);
  if (nth === -1) return -1;
  let seen = -1;
  for (let s = 0; s < SLOT_KINDS.length; s++) {
    if (SLOT_KINDS[s] === kind && ++seen === nth) return s as TrackSlot;
  }
  return -1;
}

export function setSlotTrack(pc: RTCPeerConnection, slot: TrackSlot, track: MediaStreamTrack | null) {
  const transceiver = getSlotTransceiver(pc, slot);
  if (!transceiver) { console.warn('[watch] no transceiver for slot', slot); return; }
  transceiver.sender.replaceTrack(track).catch((err) =>
    console.warn('[watch] replaceTrack failed, slot', slot, err));
  if (track?.kind === 'video') {
    const params = transceiver.sender.getParameters();
    if (params.encodings?.length) {
      params.encodings[0].maxBitrate = isIOS() ? 150_000 : 200_000;
      params.encodings[0].scaleResolutionDownBy = isIOS() ? 2 : 1;
      transceiver.sender.setParameters(params).catch(() => {});
    }
  }
}

// Bitrate ladder: steps we move through as network improves/degrades
const BITRATE_STEPS = isIOS()
  ? [150_000, 250_000, 400_000]          // mobile: 150k → 250k → 400k
  : [200_000, 400_000, 700_000, 1_000_000]; // desktop: 200k → 400k → 700k → 1M

const SCALE_STEPS = isIOS() ? [2, 1.5, 1] : [1, 1, 1, 1];

// Starts adaptive bitrate polling on a peer connection.
// Returns a cleanup function to stop it.
export function adaptBitrate(pc: RTCPeerConnection): () => void {
  let stepIndex = 0;
  let prevPacketsLost = 0;
  let prevPacketsSent = 0;
  let stableCount = 0; // consecutive stable intervals before stepping up

  const applyStep = (index: number) => {
    pc.getSenders().forEach(sender => {
      if (sender.track?.kind !== 'video') return;
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      params.encodings[0].maxBitrate = BITRATE_STEPS[index];
      params.encodings[0].scaleResolutionDownBy = SCALE_STEPS[index];
      sender.setParameters(params).catch(() => {});
    });
  };

  const poll = async () => {
    const stats = await pc.getStats().catch(() => null);
    if (!stats) return;

    let packetsLost = 0;
    let packetsSent = 0;

    stats.forEach((report) => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        packetsSent = report.packetsSent ?? 0;
        packetsLost = report.retransmittedPacketsSent ?? 0; // proxy for loss
      }
      if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
        packetsLost = report.packetsLost ?? packetsLost;
      }
    });

    const sentDelta = packetsSent - prevPacketsSent;
    const lostDelta = packetsLost - prevPacketsLost;
    prevPacketsSent = packetsSent;
    prevPacketsLost = packetsLost;

    const lossRate = sentDelta > 0 ? lostDelta / sentDelta : 0;

    if (lossRate > 0.05) {
      // >5% loss — step down immediately, reset stable counter
      stableCount = 0;
      if (stepIndex > 0) {
        stepIndex--;
        applyStep(stepIndex);
      }
    } else {
      // Network is stable — wait 3 consecutive clean intervals before stepping up
      stableCount++;
      if (stableCount >= 3 && stepIndex < BITRATE_STEPS.length - 1) {
        stableCount = 0;
        stepIndex++;
        applyStep(stepIndex);
      }
    }
  };

  const interval = window.setInterval(poll, 3000);
  return () => window.clearInterval(interval);
}
