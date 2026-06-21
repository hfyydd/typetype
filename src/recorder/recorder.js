import { buildWaveform, downsampleTo16k, normalizePcmChunkTo16k } from "./audio-processing.js";
import { buildAudioConstraints } from "./device-constraints.js";
import { concatFloat32Chunks } from "./pcm-buffer.js";
import { isPcmChunkMessage } from "./pcm-message.js";

const recorderAPI = window.recorderAPI;

let mediaStream = null;
let audioContext = null;
let analyser = null;
let waveformTimer = null;
let sourceNode = null;
let captureNode = null;
let silentGainNode = null;
let pcmChunks = [];
let pendingPcmChunks = [];
let captureModulePromise = null;
let chunkFlushTimer = null;
let workletBlobUrl = null;
let lastAudioContextState = null;

const PCM_CHUNK_FLUSH_MS = 180;

const PCM_CAPTURE_PROCESSOR_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];
    if (channel?.length) {
      this.port.postMessage({ type: "pcm-chunk", samples: channel.slice() });
    }
    return true;
  }
}
registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
`;

function revokeWorkletBlob() {
  if (workletBlobUrl) {
    URL.revokeObjectURL(workletBlobUrl);
    workletBlobUrl = null;
  }
}

function stopWaveformLoop() {
  if (waveformTimer) {
    window.clearInterval(waveformTimer);
    waveformTimer = null;
  }
}

function stopChunkFlushLoop() {
  if (chunkFlushTimer) {
    window.clearInterval(chunkFlushTimer);
    chunkFlushTimer = null;
  }
}

// Tears down every audio-graph node and releases the OS input device.
// Must be `await`ed: closing the AudioContext is asynchronous on Chromium
// and macOS will keep the orange mic indicator lit until the context is
// actually closed. The order is also deliberate — disconnect the source
// node from the destination graph first, *then* stop the MediaStream
// tracks, *then* close the context. Stopping the tracks before
// disconnecting the source node leaves the graph in a half-released state
// on some Chromium versions and the device is not freed until the next GC.
async function cleanupStream() {
  stopWaveformLoop();
  stopChunkFlushLoop();

  // 1. Stop forwarding audio from captureNode and pull the silent gain off
  //    the destination so the destination graph has no input source.
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch {}
    sourceNode = null;
  }

  if (captureNode) {
    // Close the worklet port so the processor stops posting messages.
    // Setting onmessage = null only removes the listener; the processor
    // would keep running until the AudioContext is actually closed.
    if ("port" in captureNode && captureNode.port) {
      try { captureNode.port.close(); } catch {}
      captureNode.port.onmessage = null;
    } else {
      captureNode.onaudioprocess = null;
    }
    try { captureNode.disconnect(); } catch {}
    captureNode = null;
  }

  if (silentGainNode) {
    try { silentGainNode.disconnect(); } catch {}
    silentGainNode = null;
  }

  // 2. Stop the MediaStream tracks. Now that no node references the
  //    stream, this releases the underlying CoreAudio input device.
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      try { track.stop(); } catch {}
    }
    mediaStream = null;
  }

  // 3. Close the AudioContext. This is the step the OS listens to —
  //    until the context reaches `closed`, the mic indicator stays
  //    on. We await it so the IPC `recorder_stop` reply is not sent
  //    back to the main process before the device is released.
  if (audioContext && audioContext.state !== "closed") {
    try {
      await audioContext.close();
    } catch {
      // best-effort
    }
  }
  audioContext = null;
  lastAudioContextState = null;

  analyser = null;
  pcmChunks = [];
  pendingPcmChunks = [];
  captureModulePromise = null;
  revokeWorkletBlob();
}

function flushPendingChunkSamples() {
  if (pendingPcmChunks.length === 0) {
    return;
  }

  const samples = concatFloat32Chunks(pendingPcmChunks);
  pendingPcmChunks = [];
  const sampleRate = audioContext?.sampleRate ?? 16000;
  const samples16k = normalizePcmChunkTo16k(samples, sampleRate);
  recorderAPI.sendChunk(samples16k.buffer);
}

async function ensureAudioContext() {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (e) {
      // Try closing and recreating
      try { await audioContext.close(); } catch {}
      audioContext = new AudioContext();
    }
  }

  if (audioContext.state === "suspended") {
    // Still suspended - try a new context
    try { await audioContext.close(); } catch {}
    audioContext = new AudioContext();
  }

  return audioContext;
}

async function ensureCaptureModule(context) {
  if (!context.audioWorklet || typeof AudioWorkletNode !== "function") {
    return false;
  }

  if (!workletBlobUrl) {
    const blob = new Blob([PCM_CAPTURE_PROCESSOR_CODE], { type: "application/javascript" });
    workletBlobUrl = URL.createObjectURL(blob);
  }

  if (!captureModulePromise) {
    captureModulePromise = context.audioWorklet.addModule(workletBlobUrl);
  }

  try {
    await captureModulePromise;
    return true;
  } catch (error) {
    captureModulePromise = null;
    console.error("Failed to load AudioWorklet capture module:", error);
    return false;
  }
}

async function createCaptureNode(context) {
  if (await ensureCaptureModule(context)) {
    const node = new AudioWorkletNode(context, "pcm-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (event) => {
      if (isPcmChunkMessage(event.data)) {
        pcmChunks.push(event.data.samples);
        pendingPcmChunks.push(event.data.samples);
      }
    };
    return node;
  }

  const fallbackNode = context.createScriptProcessor(4096, 1, 1);
  fallbackNode.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    pcmChunks.push(samples.slice());
    pendingPcmChunks.push(samples.slice());
  };
  return fallbackNode;
}

async function resolveMicrophoneId(requestedId) {
  if (!requestedId || requestedId === "default") {
    return null;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === "audioinput");

    // 1. Try to match by deviceId directly
    const matchById = audioInputs.find(d => d.deviceId === requestedId);
    if (matchById) {
      return matchById.deviceId;
    }

    // 2. Try to match by label (case-insensitive, trimmed)
    const requestedIdLower = requestedId.toLowerCase().trim();
    const matchByLabel = audioInputs.find(
      d => d.label.toLowerCase().trim() === requestedIdLower
    );
    if (matchByLabel) {
      return matchByLabel.deviceId;
    }

    console.warn(`Requested microphone "${requestedId}" not found. Falling back to default.`);
    return null;
  } catch (e) {
    console.error("Failed to enumerate devices:", e);
    return null;
  }
}

async function startRecording(microphoneId = null) {
  if (mediaStream) {
    return;
  }

  try {
    const context = await ensureAudioContext();
    
    // Resolve label/ID to actual WebRTC deviceId hash
    const resolvedMicrophoneId = await resolveMicrophoneId(microphoneId);

    // Initial attempt with resolved ID and standard audio properties
    const constraints = buildAudioConstraints(resolvedMicrophoneId);
    
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
      });
    } catch (firstError) {
      console.warn("First getUserMedia attempt failed, trying fallback...", firstError);
      let failedConstraint = "";
      if (firstError && firstError.name === "OverconstrainedError") {
        failedConstraint = firstError.constraint || "";
        console.warn(`Overconstrained constraint: ${failedConstraint}`);
      }

      // Fallback 1: Retry with resolved ID but fully relaxed/empty constraints
      if (resolvedMicrophoneId) {
        try {
          console.log("Retrying with ideal deviceId only...");
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { ideal: resolvedMicrophoneId } },
          });
        } catch (secondError) {
          console.warn("Second getUserMedia attempt failed, trying default audio source...", secondError);
        }
      }

      // Fallback 2: Retry with completely generic audio: true
      if (!mediaStream) {
        try {
          console.log("Retrying with fallback audio: true...");
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        } catch (thirdError) {
          // If all fail, throw a detailed error
          const originalMsg = firstError instanceof Error ? `${firstError.name}: ${firstError.message}` : String(firstError);
          const finalMsg = thirdError instanceof Error ? `${thirdError.name}: ${thirdError.message}` : String(thirdError);
          const errMsg = `Failed to start recording. Original error: ${originalMsg}` +
            (failedConstraint ? ` (failed constraint: ${failedConstraint})` : "") +
            `. Fallback error: ${finalMsg}`;
          throw new Error(errMsg);
        }
      }
    }

    sourceNode = context.createMediaStreamSource(mediaStream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    sourceNode.connect(analyser);

    pcmChunks = [];
    captureNode = await createCaptureNode(context);

    // 这里把处理节点接到一个静音 gain，再挂到 destination。
    // 目的不是播放声音，而是让 WebAudio 图持续运行，从而稳定拿到 PCM 回调。
    silentGainNode = context.createGain();
    silentGainNode.gain.value = 0;
    sourceNode.connect(captureNode);
    captureNode.connect(silentGainNode);
    silentGainNode.connect(context.destination);

    const timeDomainData = new Uint8Array(analyser.frequencyBinCount);
    waveformTimer = window.setInterval(() => {
      if (!analyser) {
        return;
      }
      analyser.getByteTimeDomainData(timeDomainData);
      recorderAPI.sendWaveform(buildWaveform(timeDomainData, 9));
    }, 90);
    chunkFlushTimer = window.setInterval(() => {
      flushPendingChunkSamples();
    }, PCM_CHUNK_FLUSH_MS);

    // Wait for audio processing to actually produce samples before signaling ready
    // This ensures WebAudio pipeline is fully operational
    await waitForAudioProcessing(context);
    recorderAPI.sendStarted();
  } catch (error) {
    await cleanupStream();
    const errMsg = error instanceof Error
      ? (error.stack || `${error.name}: ${error.message}`)
      : String(error);
    recorderAPI.sendError(errMsg);
  }
}

async function waitForAudioProcessing(context, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const initialPcmLength = pcmChunks.length;
    let resolved = false;

    function check() {
      if (resolved) return;

      const elapsed = Date.now() - startTime;
      if (pcmChunks.length > initialPcmLength) {
        resolved = true;
        resolve(true);
        return;
      }

      if (elapsed >= timeoutMs) {
        resolved = true;
        console.warn("Timeout waiting for audio processing");
        resolve(true); // Still resolve true to not block recording
        return;
      }

      setTimeout(check, 50);
    }

    // Start checking after a small delay to let audio pipeline initialize
    setTimeout(check, 100);
  });
}

async function stopRecording() {
  if (!mediaStream) {
    // Nothing to send and nothing to release, but still clear any
    // leftover timers / worklet blob so the next start is clean.
    stopWaveformLoop();
    stopChunkFlushLoop();
    revokeWorkletBlob();
    pcmChunks = [];
    pendingPcmChunks = [];
    recorderAPI.sendResult(new Float32Array().buffer);
    return;
  }

  let resultBuffer = new Float32Array().buffer;
  try {
    flushPendingChunkSamples();
    const context = await ensureAudioContext();
    const samples = concatFloat32Chunks(pcmChunks);
    const samples16k = downsampleTo16k(samples, context.sampleRate);
    resultBuffer = samples16k.buffer;
  } catch (error) {
    const errMsg = error instanceof Error
      ? (error.stack || `${error.name}: ${error.message}`)
      : String(error);
    recorderAPI.sendError(errMsg);
    // Fall through to cleanup even on error so the mic gets released.
  } finally {
    // Cleanup must run and complete before we return so the OS
    // releases the input device. We send the result *after* cleanup
    // finishes — the main process won't start transcription until
    // it has the samples, and we don't want the recorder's graph
    // torn down mid-transcription anyway.
    await cleanupStream();
    recorderAPI.sendResult(resultBuffer);
  }
}

window.addEventListener("error", (event) => {
  const error = event.error;
  const msg = error instanceof Error
    ? (error.stack || `${error.name}: ${error.message}`)
    : event.message || "Unknown renderer error";
  recorderAPI.sendError(`[Uncaught Error] ${msg}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error
    ? (reason.stack || `${reason.name}: ${reason.message}`)
    : String(reason) || "Unknown promise rejection";
  recorderAPI.sendError(`[Unhandled Rejection] ${msg}`);
});

recorderAPI.onStart(startRecording);
recorderAPI.onStop(stopRecording);
