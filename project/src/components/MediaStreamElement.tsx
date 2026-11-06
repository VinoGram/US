import { useEffect, useRef } from 'react';

interface StreamElementProps {
  stream: MediaStream | null;
  muted?: boolean;
  style?: React.CSSProperties;
}

export function StreamVideo({ stream, muted = false, style }: StreamElementProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;
    const tryPlay = () => video.play().catch(err => console.warn('[watch] play blocked:', err));
    tryPlay();
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.addEventListener('unmute', tryPlay);
      return () => track.removeEventListener('unmute', tryPlay);
    }
  }, [stream]);

  return (
    <video ref={ref} autoPlay playsInline muted={muted} style={style} disablePictureInPicture />
  );
}

export function StreamAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = stream;
    if (stream) audio.play().catch((err) => console.warn('[watch] audio play blocked:', err));
  }, [stream]);

  return <audio ref={ref} autoPlay playsInline style={{ display: 'none' }} />;
}
