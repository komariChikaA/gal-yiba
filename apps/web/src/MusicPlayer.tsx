import { useEffect, useRef, useState } from "react";
import { formatTime, playlist } from "./playlist";
import { publicAsset } from "./config";

const VOLUME_KEY = "gal-yiba-player-volume";
const FADE_STEP_MS = 30;

function loadVolume(): number {
  const stored = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.7;
}

export function MusicPlayer() {
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(loadVolume);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const volumeRef = useRef(volume);

  if (playlist.length === 0) return null;
  const track = playlist[trackIndex % playlist.length] ?? playlist[0]!;

  useEffect(() => {
    volumeRef.current = volume;
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);
    };
  }, []);

  function stopFade(): void {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }

  function fadeTo(target: number, duration: number, onDone?: () => void): void {
    const audio = audioRef.current;
    if (!audio) return;
    stopFade();
    const from = audio.volume;
    const startedAt = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / duration);
      audio.volume = Math.max(0, from + (target - from) * progress);
      if (progress < 1) {
        fadeTimerRef.current = window.setTimeout(
          () => step(performance.now()),
          FADE_STEP_MS,
        );
      } else {
        fadeTimerRef.current = null;
        onDone?.();
      }
    };
    step(performance.now());
  }

  function startFadeIn(): void {
    fadeTo(volumeRef.current, 700);
  }

  function fadeOut(duration: number, onDone: () => void): void {
    fadeTo(0, duration, onDone);
  }

  function togglePlay(): void {
    if (playing) {
      fadeOut(320, () => setPlaying(false));
    } else {
      setPlaying(true);
    }
  }

  function nextTrack(): void {
    const change = () =>
      setTrackIndex((current) => (current + 1) % playlist.length);
    if (playing) fadeOut(180, change);
    else change();
  }

  function previousTrack(): void {
    const change = () =>
      setTrackIndex(
        (current) => (current - 1 + playlist.length) % playlist.length,
      );
    if (playing) fadeOut(180, change);
    else change();
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    stopFade();
    if (playing) {
      audio.volume = 0;
      void audio
        .play()
        .then(startFadeIn)
        .catch(() => setPlaying(false));
    } else {
      audio.volume = volumeRef.current;
      audio.pause();
    }
  }, [playing, trackIndex]);

  function handleEnded(): void {
    if (playlist.length === 1) {
      // 单曲循环：回到开头继续播
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      void audio.play().then(startFadeIn).catch(() => setPlaying(false));
    } else {
      nextTrack();
    }
  }

  return (
    <div className={`music-player ${open ? "open" : ""}`}>
      <audio
        ref={audioRef}
        src={publicAsset(track.file)}
        preload="metadata"
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onLoadedMetadata={(event) =>
          setDuration(event.currentTarget.duration)
        }
        onEnded={handleEnded}
        onError={() => {
          setPlaying(false);
          setFailed(true);
        }}
      />
      <button
        type="button"
        className="music-fab"
        aria-label={open ? "收起音乐播放器" : "打开音乐播放器"}
        onClick={() => setOpen((current) => !current)}
      >
        ♪
      </button>

      {open && (
        <div className="music-panel" aria-label="音乐播放器">
          <p className="music-title">{track.title}</p>
          <p className="music-artist">{track.artist}</p>
          <p className="music-loop-note">循环播放 · 渐入渐出</p>

          {failed ? (
            <p className="music-missing">
              音频文件缺失：请把 {track.file.replace("/music/", "")} 放到
              public/music/ 目录。
            </p>
          ) : (
            <>
              <div className="music-progress">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={currentTime}
                  aria-label="播放进度"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (audioRef.current) {
                      audioRef.current.currentTime = next;
                    }
                    setCurrentTime(next);
                  }}
                />
                <span>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="music-controls">
                <button
                  type="button"
                  aria-label="上一首"
                  onClick={previousTrack}
                  disabled={playlist.length < 2}
                >
                  ⏮
                </button>
                <button
                  type="button"
                  className="music-play"
                  aria-label={playing ? "暂停" : "播放"}
                  onClick={togglePlay}
                >
                  {playing ? "❚❚" : "▶"}
                </button>
                <button
                  type="button"
                  aria-label="下一首"
                  onClick={nextTrack}
                  disabled={playlist.length < 2}
                >
                  ⏭
                </button>
              </div>

              <label className="music-volume">
                <span>音量</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  aria-label="音量"
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
