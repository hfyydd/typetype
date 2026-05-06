export function buildAudioConstraints(microphoneId) {
  const constraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };

  if (microphoneId) {
    constraints.deviceId = { exact: microphoneId };
  }

  return constraints;
}
