import { useEffect, useRef, useState, useMemo } from 'react';
import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
import { TRACK_SLOT, type TrackSlot, PEER_CONFIG, setSlotTrack, slotForReceiver, getScreenConstraints, isIOS, adaptBitrate, createPlaceholderStream } from '@/lib/webrtc';

export type ConnectionStatus = 'connecting' | 'connected' | 'error';

interface PresenceMeta { sharing: boolean; micOn: boolean; }
const DEFAULT_META: PresenceMeta = { sharing: false, micOn: false };

function slotId(roomCode: string, slot: number) { return `${roomCode}-${slot}`; }

// A placeholder track is the 2x2 silent canvas/audio we create ourselves.
// We detect it by label — real getUserMedia/getDisplayMedia tracks have a device label.
// Placeholder AudioContext tracks have an empty label.
function isPlaceholderTrack(track: MediaStreamTrack): boolean {
  return track.label === '' || track.label.startsWith('MediaStreamAudioDestinationNode');
}

interface PeerState {
  dataConn: DataConnection | null;
  mediaConn: MediaConnection | null;
  pc: RTCPeerConnection | null;       // resolved RTCPeerConnection, stored once
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
  const pendingTracksRef = useRef<
    Record<string, Partial<Record<TrackSlot, MediaStreamTrack | null>>>
  >({});
  const peersRef = useRef<Record<string, PeerState>>({});

  const updatePeer = (peerId: string, patch: Partial<PeerState>) => {
    const prev = peersRef.current[peerId];
    peersRef.current = {
      ...peersRef.current,
      [peerId]: {
        dataConn: null,
        mediaConn: null,
        pc: null,
        meta: DEFAULT_META,
        tracks: {},
        ...prev,
        ...patch,
      },
    };
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
    Object.values(peersRef.current).forEach(p => {
      try {
        if (p.dataConn?.open) p.dataConn.send({ type: 'meta', payload: selfMetaRef.current });
      } catch (e) {
        console.warn('[watch] meta send failed', e);
      }
    });
  };

  // Push a track to all connected peers; queue it if pc isn't resolved yet
  const setLocalTrack = (slot: TrackSlot, track: MediaStreamTrack | null) => {
    localTracksRef.current[slot] = track;
    if (!isHostRef.current && slot !== TRACK_SLOT.mic) return;
    Object.entries(peersRef.current).forEach(([peerId, p]) => {
      if (p.pc) {
        console.log('[host] pushing slot', slot, track ? 'live' : 'null', 'to', peerId);
        setSlotTrack(p.pc, slot, track);
      } else {
        console.warn('[host] pc not ready for', peerId, '— queueing slot', slot);
        const q = pendingTracksRef.current[peerId] ?? {};
        q[slot] = track;
        pendingTracksRef.current[peerId] = q;
      }
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
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(getScreenConstraints());
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      // Retry without audio constraints (some browsers reject them)
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch (e2) {
        if (e2 instanceof DOMException && e2.name === 'NotAllowedError') return;
        setMediaError(`Could not start screen sharing: ${e2 instanceof Error ? e2.message : String(e2)}`);
        return;
      }
    }
    const [video] = stream.getVideoTracks();
    const [audio] = stream.getAudioTracks();
    if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
    // Release previous screen tracks without broadcasting meta:false
    localTracksRef.current[TRACK_SLOT.screenVideo]?.stop();
    localTracksRef.current[TRACK_SLOT.screenAudio]?.stop();
    setLocalTrack(TRACK_SLOT.screenVideo, video);
    setLocalTrack(TRACK_SLOT.screenAudio, audio ?? null);
    video.addEventListener('ended', stopShare);
    setLocalScreen(new MediaStream([video]));
    broadcastMeta({ sharing: true });
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
    // Preserve existing tracks/meta/pc — data and media connections can arrive in any order
    updatePeer(peerId, {
      dataConn: conn,
      meta: peersRef.current[peerId]?.meta ?? DEFAULT_META,
      tracks: peersRef.current[peerId]?.tracks ?? {},
      pc: peersRef.current[peerId]?.pc ?? null,
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
      pc: peersRef.current[peerId]?.pc ?? null,
      dataConn: peersRef.current[peerId]?.dataConn ?? null,
      meta: peersRef.current[peerId]?.meta ?? DEFAULT_META,
      tracks: peersRef.current[peerId]?.tracks ?? {},
    });

    const waitForPc = (attempts = 0) => {
      const pc: RTCPeerConnection | undefined =
        (mc as unknown as { _pc?: RTCPeerConnection })._pc ?? mc.peerConnection ?? undefined;
      if (!pc) {
        if (attempts < 100) setTimeout(() => waitForPc(attempts + 1), 20);
        return;
      }

      // Store the resolved pc so setLocalTrack can use it directly
      updatePeer(peerId, { pc });

      // Push any tracks we already have — don't wait for ICE
      if (isHostRef.current) {
        Object.entries(localTracksRef.current).forEach(([slot, track]) => {
          if (track) setSlotTrack(pc, Number(slot) as TrackSlot, track);
        });
      } else {
        const mic = localTracksRef.current[TRACK_SLOT.mic];
        if (mic) setSlotTrack(pc, TRACK_SLOT.mic, mic);
      }

      // Drain anything queued while pc was resolving
      const queued = pendingTracksRef.current[peerId];
      if (queued) {
        Object.entries(queued).forEach(([slot, track]) =>
          setSlotTrack(pc, Number(slot) as TrackSlot, track ?? null)
        );
        delete pendingTracksRef.current[peerId];
      }

      let stopAdapt: (() => void) | null = null;

      const onIce = () => {
        const state = pc.iceConnectionState;
        if (state === 'connected' || state === 'completed') {
          setStatus('connected');
          if (isHostRef.current) {
            console.log('[host] ICE connected, pushing tracks:', localTracksRef.current);
            console.log('[host] transceivers:', pc.getTransceivers().map(t => [t.direction, t.currentDirection, t.sender.track?.kind]));
            Object.entries(localTracksRef.current).forEach(([slot, track]) => {
              if (track) setSlotTrack(pc, Number(slot) as TrackSlot, track);
            });
            if (!stopAdapt) stopAdapt = adaptBitrate(pc);
          } else {
            const mic = localTracksRef.current[TRACK_SLOT.mic];
            if (mic) setSlotTrack(pc, TRACK_SLOT.mic, mic);
          }
        }
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          stopAdapt?.();
          stopAdapt = null;
        }
      };

      pc.addEventListener('iceconnectionstatechange', onIce);
      onIce(); // run once in case ICE already connected before we registered

      pc.addEventListener('track', (event) => {
        const slot = slotForReceiver(pc, event.receiver);
        if (slot === -1) return;
        console.log(`[track] slot=${slot} kind=${event.track.kind} label=${event.track.label}`);
        updatePeer(peerId, {
          tracks: { ...peersRef.current[peerId]?.tracks, [slot]: event.track },
        });
      });

      mc.on('close', () => {
        stopAdapt?.();
        updatePeer(peerId, { tracks: {}, pc: null });
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
        console.log(`[peer] opened as ${host ? 'HOST' : 'GUEST'} id=${id}`);

        if (!host) {
          const conn = peer.connect(slotId(roomCode, 0), { reliable: true });
          setupDataConn(conn);
          const mc = peer.call(slotId(roomCode, 0), createPlaceholderStream());
          if (mc) setupMediaConn(mc);
        } else {
          setStatus('connected');
        }
      });

      peer.on('error', (err) => {
        console.warn('[peer] error', err);
        if ((err as { type?: string }).type === 'unavailable-id') {
          peer.destroy();
          trySlot(slot + 1);
        } else {
          setStatus('error');
        }
      });

      peer.on('connection', (conn) => setupDataConn(conn));

      peer.on('call', (mc) => {
        console.log('[host] incoming call from', mc.peer);
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
      pendingTracksRef.current = {};
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

  // Gate on meta.sharing — don't use track presence which includes placeholders
  const sharingPeer = peerList.find(p => p.meta.sharing);
  const screenVideoTrack = sharingPeer?.tracks[TRACK_SLOT.screenVideo] ?? null;
  const screenAudioTrack = sharingPeer?.tracks[TRACK_SLOT.screenAudio] ?? null;

  const partnerScreen = useMemo(
    () => screenVideoTrack ? new MediaStream([screenVideoTrack]) : null,
    [screenVideoTrack]
  );

  const partnerScreenAudio = useMemo(
    () => screenAudioTrack && !isPlaceholderTrack(screenAudioTrack) ? new MediaStream([screenAudioTrack]) : null,
    [screenAudioTrack]
  );

  const micStreams = useMemo(() =>
    peerList
      .filter(p => {
        const t = p.tracks[TRACK_SLOT.mic];
        return t && !isPlaceholderTrack(t);
      })
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
    partnerScreenAudio,
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
