export function downsampleTo16k(input, sampleRate) {
  if (!(input instanceof Float32Array)) {
    throw new TypeError("input must be a Float32Array");
  }

  if (sampleRate === 16000) {
    return input.slice();
  }

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be a positive number");
  }

  const ratio = sampleRate / 16000;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio));
    let sum = 0;
    let count = 0;

    for (let i = inputIndex; i < nextInputIndex; i += 1) {
      sum += input[i];
      count += 1;
    }

    output[outputIndex] = count === 0 ? input[Math.min(inputIndex, input.length - 1)] : sum / count;
    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}

export function normalizePcmChunkTo16k(input, sampleRate) {
  if (!(input instanceof Float32Array)) {
    throw new TypeError("input must be a Float32Array");
  }

  if (input.length === 0) {
    return input.slice();
  }

  return downsampleTo16k(input, sampleRate);
}

export function buildWaveform(timeDomainData, bars = 9) {
  if (!timeDomainData?.length || bars <= 0) {
    return [];
  }

  const chunkSize = Math.max(1, Math.floor(timeDomainData.length / bars));
  const waveform = [];

  for (let barIndex = 0; barIndex < bars; barIndex += 1) {
    const start = barIndex * chunkSize;
    const end = Math.min(timeDomainData.length, start + chunkSize);
    let amplitude = 0;

    for (let i = start; i < end; i += 1) {
      amplitude += Math.abs((timeDomainData[i] - 128) / 128);
    }

    const average = amplitude / Math.max(1, end - start);
    waveform.push(Math.min(1, Math.max(0.12, average * 3.4)));
  }

  return waveform;
}

export function mixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0).slice();
  }

  const mono = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < audioBuffer.length; i += 1) {
      mono[i] += channelData[i] / audioBuffer.numberOfChannels;
    }
  }
  return mono;
}
