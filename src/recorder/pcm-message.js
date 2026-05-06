export function isPcmChunkMessage(message) {
  return message?.type === "pcm-chunk" && message.samples instanceof Float32Array;
}
