export function buildAudioConstraints(microphoneId) {
  const constraints = {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
  };

  if (microphoneId) {
    constraints.deviceId = { ideal: microphoneId };
  }

  return constraints;
}
