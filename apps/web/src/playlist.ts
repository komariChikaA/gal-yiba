export interface Track {
  id: string;
  title: string;
  artist: string;
  file: string;
}

/** 网站背景音乐清单：音频文件放在 apps/web/public/music/ 下。 */
export const playlist: Track[] = [
  {
    id: "hoshi-meguri-no-uta",
    title: "星めぐりの歌",
    artist: "Metronome",
    file: "/music/hoshi-meguri-no-uta.mp3",
  },
];

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
