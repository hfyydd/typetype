import { buildWaveform, downsampleTo16k } from "./audio-processing.js";
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

const PCM_CHUNK_FLUSH_MS = 180;

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

function cleanupStream() {
  stopWaveformLoop();
  stopChunkFlushLoop();

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (captureNode) {
    if ("port" in captureNode) {
      captureNode.port.onmessage = null;
    } else {
      captureNode.onaudioprocess = null;
    }
    captureNode.disconnect();
    captureNode = null;
  }

  if (silentGainNode) {
    silentGainNode.disconnect();
    silentGainNode = null;
  }

  analyser = null;
  pcmChunks = [];
  pendingPcmChunks = [];
}

function flushPendingChunkSamples() {
  if (pendingPcmChunks.length === 0) {
    return;
  }

  const samples = concatFloat32Chunks(pendingPcmChunks);
  pendingPcmChunks = [];
  recorderAPI.sendChunk(samples.buffer);
}

async function ensureAudioContext() {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
}

async function ensureCaptureModule(context) {
  if (!context.audioWorklet || typeof AudioWorkletNode !== "function") {
    return false;
  }

  if (!captureModulePromise) {
    captureModulePromise = context.audioWorklet.addModule(
      new URL("./pcm-capture-processor.js", import.meta.url).href
    );
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

async function startRecording(microphoneId = null) {
  if (mediaStream) {
    return;
  }

  try {
    const context = await ensureAudioContext();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(microphoneId),
    });

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

    recorderAPI.sendStarted();
  } catch (error) {
    cleanupStream();
    recorderAPI.sendError(error instanceof Error ? error.message : String(error));
  }
}

async function stopRecording() {
  if (!mediaStream) {
    recorderAPI.sendResult(new Float32Array().buffer);
    cleanupStream();
    return;
  }

  try {
    flushPendingChunkSamples();
    const context = await ensureAudioContext();
    const samples = concatFloat32Chunks(pcmChunks);
    const samples16k = downsampleTo16k(samples, context.sampleRate);

    recorderAPI.sendResult(samples16k.buffer);
  } catch (error) {
    recorderAPI.sendError(error instanceof Error ? error.message : String(error));
  } finally {
    cleanupStream();
  }
}

recorderAPI.onStart(startRecording);
recorderAPI.onStop(stopRecording);
