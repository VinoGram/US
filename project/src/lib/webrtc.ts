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
      video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } },
    };
  }
  return {
    video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } },
    audio: { echoCancellation: false, noiseSuppression: false },
  };
}

export function createPlaceholderStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const [video] = canvas.captureStream(0).getVideoTracks();
  const ctx = new AudioContext();
  const [a1] = ctx.createMediaStreamDestination().stream.getAudioTracks();
  const [a2] = ctx.createMediaStreamDestination().stream.getAudioTracks();
  return new MediaStream([video, a1, a2].filter(Boolean));
}

export function setSlotTrack(pc: RTCPeerConnection, slot: TrackSlot, track: MediaStreamTrack | null) {
  const transceiver = pc.getTransceivers()[slot];
  if (!transceiver) return;
  transceiver.sender.replaceTrack(track).catch(() => {});
  if (track?.kind === 'video') {
    const params = transceiver.sender.getParameters();
    if (params.encodings?.length) {
      // Always start low — adaptBitrate will ramp up when network is stable
      params.encodings[0].maxBitrate = isIOS() ? 300_000 : 500_000;
      params.encodings[0].scaleResolutionDownBy = isIOS() ? 2 : 1;
      transceiver.sender.setParameters(params).catch(() => {});
    }
  }
}

// Bitrate ladder: steps we move through as network improves/degrades
const BITRATE_STEPS = isIOS()
  ? [300_000, 500_000, 800_000]          // mobile: 300k → 500k → 800k
  : [500_000, 1_000_000, 2_000_000, 4_000_000]; // desktop: 500k → 1M → 2M → 4M

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
