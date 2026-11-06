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
    if (stream) void video.play().catch(() => {});
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={style}
      disablePictureInPicture
      // low latency hint — browser skips buffering and renders first frame ASAP
      {...({ latencyHint: 'interactive' } as object)}
    />
  );
}

export function StreamAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = stream;
    if (stream) void audio.play().catch(() => {});
  }, [stream]);

  // <audio> is the lightest way to play audio — no AudioContext overhead
  return <audio ref={ref} autoPlay playsInline style={{ display: 'none' }} />;
}
