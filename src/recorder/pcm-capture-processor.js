class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];

    if (channel?.length) {
      this.port.postMessage({
        type: "pcm-chunk",
        samples: channel.slice(),
      });
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
