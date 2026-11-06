import { useEffect, useRef, useState, useMemo } from 'react';
import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
import { TRACK_SLOT, type TrackSlot, PEER_CONFIG, setSlotTrack, getScreenConstraints, isIOS, adaptBitrate, createPlaceholderStream } from '@/lib/webrtc';

export type ConnectionStatus = 'connecting' | 'connected' | 'error';

interface PresenceMeta { sharing: boolean; micOn: boolean; }
const DEFAULT_META: PresenceMeta = { sharing: false, micOn: false };

function slotId(roomCode: string, slot: number) { return `${roomCode}-${slot}`; }

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

  const setLocalTrack = (slot: TrackSlot, track: MediaStreamTrack | null) => {
    localTracksRef.current[slot] = track;
    if (!isHostRef.current && slot !== TRACK_SLOT.mic) return;
    Object.values(peersRef.current).forEach(p => {
      const pc = p.mediaConn?.peerConnection;
      if (pc) setSlotTrack(pc, slot, track);
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
    if (!isHostRef.current) return;
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
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const [video] = stream.getVideoTracks();
        if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
        stopShare();
        video.addEventListener('ended', stopShare);
        setLocalTrack(TRACK_SLOT.screenVideo, video);
        setLocalTrack(TRACK_SLOT.screenAudio, null);
        setLocalScreen(new MediaStream([video]));
        broadcastMeta({ sharing: true });
      } catch (e2) {
        if (e2 instanceof DOMException && e2.name === 'NotAllowedError') return;
        setMediaError(`Could not start screen sharing: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
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
    updatePeer(peerId, {
      dataConn: conn,
      meta: peersRef.current[peerId]?.meta ?? DEFAULT_META,
      tracks: peersRef.current[peerId]?.tracks ?? {},
      mediaConn: peersRef.current[peerId]?.mediaConn ?? null,
    });
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

    // Poll for pc — PeerJS sets _pc synchronously during answer/call but
    // the public peerConnection getter may lag. Cap at 2s.
    const waitForPc = (attempts = 0) => {
      const pc: RTCPeerConnection | undefined =
        (mc as unknown as { _pc?: RTCPeerConnection })._pc ?? mc.peerConnection ?? undefined;
      if (!pc) {
        if (attempts < 100) setTimeout(() => waitForPc(attempts + 1), 20);
        return;
      }

      let stopAdapt: (() => void) | null = null;

      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setStatus('connected');
          if (isHostRef.current) {
            // Push any tracks the host already has
            Object.entries(localTracksRef.current).forEach(([slot, track]) => {
              if (track) setSlotTrack(pc, Number(slot) as TrackSlot, track);
            });
            stopAdapt = adaptBitrate(pc);
          } else {
            const micTrack = localTracksRef.current[TRACK_SLOT.mic];
            if (micTrack) setSlotTrack(pc, TRACK_SLOT.mic, micTrack);
          }
        }
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
          stopAdapt?.();
        }
      });

      pc.addEventListener('track', (event) => {
        // Map track to slot by transceiver index
        const transceivers = pc.getTransceivers();
        const slot = transceivers.findIndex(t => t.receiver === event.receiver);
        if (slot === -1) return;
        updatePeer(peerId, {
          tracks: { ...peersRef.current[peerId]?.tracks, [slot as TrackSlot]: event.track },
        });
      });

      mc.on('close', () => {
        stopAdapt?.();
        updatePeer(peerId, { tracks: {} });
      });
    };

    waitForPc();
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
          // Guest: open data channel to host
          const conn = peer.connect(slotId(roomCode, 0), { reliable: true });
          setupDataConn(conn);

          // Guest initiates the media call.
          // We create a stream with 3 silent tracks so the offer SDP contains
          // all 3 transceivers in the right order — host just answers, no addTransceiver needed.
          const mc = peer.call(slotId(roomCode, 0), createPlaceholderStream());
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

      // Host answers with placeholder stream so all 3 transceivers are sendrecv
      peer.on('call', (mc) => {
        mc.answer(createPlaceholderStream());
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

  // Use meta.sharing as the source of truth — not track presence,
  // since placeholder tracks arrive immediately and would show a black screen.
  const sharingPeer = peerList.find(p => p.meta.sharing);
  const screenVideoTrack = sharingPeer?.tracks[TRACK_SLOT.screenVideo] ?? null;
  const screenAudioTrack = sharingPeer?.tracks[TRACK_SLOT.screenAudio] ?? null;

  const partnerScreen = useMemo(() => {
    if (!screenVideoTrack) return null;
    return new MediaStream(screenAudioTrack ? [screenVideoTrack, screenAudioTrack] : [screenVideoTrack]);
  }, [screenVideoTrack, screenAudioTrack]);

  const micStreams = useMemo(() =>
    peerList
      .filter(p => p.meta.micOn && p.tracks[TRACK_SLOT.mic])
      .map(p => new MediaStream([p.tracks[TRACK_SLOT.mic]!])),
    [peers]
  );

  return {
    status,
    isHost,
    partnerOnline: peerList.length > 0,
    partnerCount: peerList.length,
    partnerSharing: peerList.some(p => p.meta.sharing),
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
