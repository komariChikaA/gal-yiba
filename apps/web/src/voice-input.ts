export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: {
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface RecognitionConstructor {
  new (): SpeechRecognitionLike;
}

/**
 * 创建浏览器语音识别实例；环境不支持（非 Chrome/Edge、非安全上下文）
 * 时返回 null，由调用方给出提示。
 */
export function createSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const Candidate =
    (window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    }).SpeechRecognition ??
    (window as typeof window & {
      webkitSpeechRecognition?: RecognitionConstructor;
    }).webkitSpeechRecognition;
  return Candidate ? new Candidate() : null;
}
