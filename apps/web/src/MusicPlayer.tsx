import { useEffect, useRef, useState } from "react";
import { formatTime, playlist } from "./playlist";

const VOLUME_KEY = "gal-yiba-player-volume";

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

  if (playlist.length === 0) return null;
  const track = playlist[trackIndex % playlist.length] ?? playlist[0]!;

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing, trackIndex]);

  function togglePlay(): void {
    setPlaying((current) => !current);
  }

  function nextTrack(): void {
    setTrackIndex((current) => (current + 1) % playlist.length);
    setFailed(false);
  }

  function previousTrack(): void {
    setTrackIndex(
      (current) => (current - 1 + playlist.length) % playlist.length,
    );
    setFailed(false);
  }

  return (
    <div className={`music-player ${open ? "open" : ""}`}>
      <audio
        ref={audioRef}
        src={track.file}
        preload="metadata"
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onLoadedMetadata={(event) =>
          setDuration(event.currentTarget.duration)
        }
        onEnded={nextTrack}
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
