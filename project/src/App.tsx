import { useEffect, useState } from 'react';
import LandingScreen from '@/components/LandingScreen';
import RoomScreen from '@/components/RoomScreen';
import { isValidRoomCode, normalizeRoomCode } from '@/lib/roomCode';

interface RoomInfo { code: string; maxPeers: number; }

function readRoomFromUrl(): RoomInfo | null {
  const params = new URLSearchParams(window.location.search);
  const code = normalizeRoomCode(params.get('room') ?? '');
  if (!isValidRoomCode(code)) return null;
  const max = parseInt(params.get('max') ?? '2', 10);
  return { code, maxPeers: Number.isFinite(max) && max >= 2 && max <= 8 ? max : 2 };
}

function App() {
  const [room, setRoom] = useState<RoomInfo | null>(readRoomFromUrl);

  useEffect(() => {
    const syncFromUrl = () => setRoom(readRoomFromUrl());
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  const enterRoom = (code: string, maxPeers: number) => {
    window.history.pushState(null, '', `?room=${code}&max=${maxPeers}`);
    setRoom({ code, maxPeers });
  };

  const leaveRoom = () => {
    window.history.pushState(null, '', window.location.pathname);
    setRoom(null);
  };

  if (room) {
    return <RoomScreen roomCode={room.code} maxPeers={room.maxPeers} onLeave={leaveRoom} />;
  }
  return <LandingScreen onEnter={enterRoom} />;
}

export default App;
