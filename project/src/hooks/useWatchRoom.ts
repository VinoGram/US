import { useEffect, useRef, useState, useMemo } from 'react';
import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
import { TRACK_SLOT, type TrackSlot, SLOT_KINDS, PEER_CONFIG, setSlotTrack, getScreenConstraints, isIOS, adaptBitrate } from '@/lib/webrtc';

export type ConnectionStatus = 'connecting' | 'connected' | 'error';

interface PresenceMeta {
  sharing: boolean;
  micOn: boolean;
}

const DEFAULT_META: PresenceMeta = { sharing: false, micOn: false };

function slotId(roomCode: string, slot: number) {
  return `${roomCode}-${slot}`;
}

interface PeerState {
  dataConn: DataConnection | null;
  mediaConn: MediaConnection | null;
  meta: PresenceMeta;
  tracks: Partial<Record<TrackSlot, MediaStreamTrack>>;
}

export function useWatchRoom(roomCode: string, maxPeers: number) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [peers, setPeers] = useState<Record<string, PeerState>>({});
  const [selfMeta, setSelfMeta] = useState<PresenceMeta>(DEFAULT_META);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const selfMetaRef = useRef<PresenceMeta>(DEFAULT_META);
  const isHostRef = useRef(false);
  const localTracksRef = useRef<Record<TrackSlot, MediaStreamTrack | null>>({
    [TRACK_SLOT.screenVideo]: null,
    [TRACK_SLOT.screenAudio]: null,
    [TRACK_SLOT.mic]: null,
  });
  const localStreamRef = useRef<MediaStream>(new MediaStream());
  const peersRef = useRef<Record<string, PeerState>>({});

  const updatePeer = (peerId: string, patch: Partial<PeerState>) => {
    peersRef.current = { ...peersRef.current, [peerId]: { ...peersRef.current[peerId], ...patch } };
    setPeers({ ...peersRef.current });
  };

  const removePeer = (peerId: string) => {
    const { [peerId]: _, ...rest } = peersRef.current;
    peersRef.current = rest;
    setPeers({ ...rest });
  };

  const broadcastMeta = (patch: Partial<PresenceMeta>) => {
    selfMetaRef.current = { ...selfMetaRef.current, ...patch };
    setSelfMeta(selfMetaRef.current);
    Object.values(peersRef.current).forEach(p =>
      p.dataConn?.send({ type: 'meta', payload: selfMetaRef.current })
    );
  };

  // Host pushes screen+mic. Guests push mic only.
  const setLocalTrack = (slot: TrackSlot, track: MediaStreamTrack | null) => {
    const prev = localTracksRef.current[slot];
    if (prev) localStreamRef.current.removeTrack(prev);
    localTracksRef.current[slot] = track;
    if (track) localStreamRef.current.addTrack(track);
    // Guests only allowed to push mic slot
    if (!isHostRef.current && slot !== TRACK_SLOT.mic) return;
    Object.values(peersRef.current).forEach(p => {
      if (p.mediaConn) setSlotTrack(p.mediaConn.peerConnection, slot, track);
    });
  };

  const releaseLocalTrack = (slot: TrackSlot) => {
    localTracksRef.current[slot]?.stop();
    setLocalTrack(slot, null);
  };

  const stopShare = () => {
    releaseLocalTrack(TRACK_SLOT.screenVideo);
    releaseLocalTrack(TRACK_SLOT.screenAudio);
    setLocalScreen(null);
    broadcastMeta({ sharing: false });
  };

  const startShare = async () => {
    if (!isHostRef.current) return; // guests cannot share
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError(isIOS()
        ? 'Screen sharing requires Safari on iOS 16.4 or later.'
        : "Screen sharing isn't supported in this browser."
      );
      return;
    }
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(getScreenConstraints());
      const [video] = stream.getVideoTracks();
      const [audio] = stream.getAudioTracks();
      if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
      stopShare();
      video.addEventListener('ended', stopShare);
      setLocalTrack(TRACK_SLOT.screenVideo, video);
      setLocalTrack(TRACK_SLOT.screenAudio, audio ?? null);
      setLocalScreen(new MediaStream([video]));
      broadcastMeta({ sharing: true });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      setMediaError('Could not start screen sharing. Please try again.');
    }
  };

  const toggleMic = async () => {
    if (localTracksRef.current[TRACK_SLOT.mic]) {
      releaseLocalTrack(TRACK_SLOT.mic);
      broadcastMeta({ micOn: false });
      return;
    }
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(isIOS() ? { sampleRate: 16000 } : {}),
        },
      });
      const [track] = stream.getAudioTracks();
      if (!track) return;
      setLocalTrack(TRACK_SLOT.mic, track);
      broadcastMeta({ micOn: true });
    } catch {
      setMediaError("Couldn't turn on your microphone.");
    }
  };

  const setupDataConn = (conn: DataConnection) => {
    const peerId = conn.peer;
    updatePeer(peerId, { dataConn: conn, meta: DEFAULT_META, tracks: {}, mediaConn: peersRef.current[peerId]?.mediaConn ?? null });
    conn.on('open', () => {
      setStatus('connected');
      conn.send({ type: 'meta', payload: selfMetaRef.current });
    });
    conn.on('data', (raw) => {
      const msg = raw as { type: string; payload: PresenceMeta };
      if (msg.type === 'meta') updatePeer(peerId, { meta: msg.payload });
    });
    conn.on('close', () => removePeer(peerId));
    conn.on('error', () => removePeer(peerId));
  };

  const setupMediaConn = (mc: MediaConnection) => {
    const peerId = mc.peer;
    updatePeer(peerId, {
      mediaConn: mc,
      dataConn: peersRef.current[peerId]?.dataConn ?? null,
      meta: peersRef.current[peerId]?.meta ?? DEFAULT_META,
      tracks: peersRef.current[peerId]?.tracks ?? {},
    });
    const pc = mc.peerConnection;
    const existing = pc.getTransceivers();
    SLOT_KINDS.forEach((kind, i) => {
      if (!existing[i]) {
        // Video slots: host sends, guests receive. Mic slot: everyone sends.
        const direction = (i === TRACK_SLOT.mic)
          ? 'sendrecv'
          : isHostRef.current ? 'sendrecv' : 'recvonly';
        pc.addTransceiver(kind, { direction });
      }
    });
    // Push current tracks
    if (isHostRef.current) {
      Object.entries(localTracksRef.current).forEach(([slot, track]) => {
        if (track) setSlotTrack(pc, Number(slot) as TrackSlot, track);
      });
    } else {
      // Guest only pushes mic if already on
      const micTrack = localTracksRef.current[TRACK_SLOT.mic];
      if (micTrack) setSlotTrack(pc, TRACK_SLOT.mic, micTrack);
    }
    let stopAdapt: (() => void) | null = null;
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (isHostRef.current) stopAdapt = adaptBitrate(pc);
      }
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        stopAdapt?.();
      }
    });
    mc.on('stream', (remoteStream) => {
      const next: Partial<Record<TrackSlot, MediaStreamTrack>> = {};
      remoteStream.getTracks().forEach((track, i) => { next[i as TrackSlot] = track; });
      updatePeer(peerId, { tracks: next });
    });
    mc.on('close', () => {
      stopAdapt?.();
      updatePeer(peerId, { tracks: {} });
    });
  };

  useEffect(() => {
    let destroyed = false;

    const trySlot = (slot: number) => {
      if (slot >= maxPeers) { setStatus('error'); return; }
      const id = slotId(roomCode, slot);
      const peer = new Peer(id, PEER_CONFIG);
      peerRef.current = peer;

      peer.on('open', () => {
        if (destroyed) return;
        const host = slot === 0;
        isHostRef.current = host;
        setIsHost(host);

        if (!host) {
          // Guest: connect to host only
          const conn = peer.connect(slotId(roomCode, 0), { reliable: true });
          setupDataConn(conn);
          // Call with a stream that has a silent audio track so PeerJS
          // negotiates all transceivers (including host's video slots)
          const ctx = new AudioContext();
          const dest = ctx.createMediaStreamDestination();
          const mc = peer.call(slotId(roomCode, 0), dest.stream);
          if (mc) setupMediaConn(mc);
        } else {
          setStatus('connected');
        }
      });

      peer.on('error', (err) => {
        if ((err as { type?: string }).type === 'unavailable-id') {
          peer.destroy();
          trySlot(slot + 1);
        } else {
          setStatus('error');
        }
      });

      peer.on('connection', (conn) => setupDataConn(conn));
      peer.on('call', (mc) => {
        // Host answers with its real stream; guests answer with their mic stream
        const answerStream = isHostRef.current
          ? localStreamRef.current
          : (() => { const s = new MediaStream(); const m = localTracksRef.current[TRACK_SLOT.mic]; if (m) s.addTrack(m); return s; })();
        mc.answer(answerStream);
        setupMediaConn(mc);
      });
    };

    trySlot(0);

    return () => {
      destroyed = true;
      Object.values(peersRef.current).forEach(p => { p.dataConn?.close(); p.mediaConn?.close(); });
      peerRef.current?.destroy();
      Object.values(localTracksRef.current).forEach(t => t?.stop());
      localTracksRef.current = {
        [TRACK_SLOT.screenVideo]: null,
        [TRACK_SLOT.screenAudio]: null,
        [TRACK_SLOT.mic]: null,
      };
      localStreamRef.current = new MediaStream();
      peersRef.current = {};
      setPeers({});
      setLocalScreen(null);
      setSelfMeta(DEFAULT_META);
      selfMetaRef.current = DEFAULT_META;
      isHostRef.current = false;
      setIsHost(false);
      setStatus('connecting');
    };
  }, [roomCode]);

  const peerList = Object.values(peers);

  // Screen comes from whichever peer has a live video track (host only ever shares)
  const hostPeer = peerList.find(p => p.tracks[TRACK_SLOT.screenVideo]);

  const partnerScreen = useMemo(() => {
    if (!hostPeer) return null;
    const video = hostPeer.tracks[TRACK_SLOT.screenVideo]!;
    const audio = hostPeer.tracks[TRACK_SLOT.screenAudio];
    return new MediaStream(audio ? [video, audio] : [video]);
  }, [hostPeer?.tracks[TRACK_SLOT.screenVideo], hostPeer?.tracks[TRACK_SLOT.screenAudio]]);

  // Guests hear host mic; host hears all guest mics
  const micStreams = useMemo(() =>
    peerList
      .filter(p => p.tracks[TRACK_SLOT.mic])
      .map(p => new MediaStream([p.tracks[TRACK_SLOT.mic]!])),
    [peers]
  );

  return {
    status,
    isHost,
    partnerOnline: peerList.length > 0,
    partnerCount: peerList.length,
    partnerSharing: peerList.some(p => p.meta.sharing || !!p.tracks[TRACK_SLOT.screenVideo]),
    partnerScreen,
    micStreams,
    localScreen,
    isSharing: selfMeta.sharing,
    micOn: selfMeta.micOn,
    mediaError,
    startShare,
    stopShare,
    toggleMic,
  };
}
