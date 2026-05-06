export interface TranscriptionLogMeta {
  chars: number;
  hasText: boolean;
}

export function createTranscriptionLogMeta(text: string): TranscriptionLogMeta {
  return {
    chars: text.length,
    hasText: text.trim().length > 0,
  };
}
