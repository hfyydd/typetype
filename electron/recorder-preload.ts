import { contextBridge, ipcRenderer } from 'electron';

interface RecorderAPI {
  onStart: (handler: (microphoneId?: string | null) => void | Promise<void>) => void;
  onStop: (handler: () => void | Promise<void>) => void;
  onReset: (handler: (reason?: string) => void | Promise<void>) => void;
  sendStarted: () => void;
  sendWaveform: (waveform: number[]) => void;
  sendChunk: (samplesBuffer: ArrayBuffer) => void;
  sendResult: (samplesBuffer: ArrayBuffer) => void;
  sendError: (message: string) => void;
}

const api: RecorderAPI = {
  onStart: (handler) => {
    ipcRenderer.on('recorder_start', (_event, payload?: { microphoneId?: string | null }) => {
      void handler(payload?.microphoneId ?? null);
    });
  },
  onStop: (handler) => {
    ipcRenderer.on('recorder_stop', () => {
      void handler();
    });
  },
  onReset: (handler) => {
    ipcRenderer.on('recorder_reset', (_event, payload?: { reason?: string }) => {
      void handler(payload?.reason);
    });
  },
  sendStarted: () => {
    ipcRenderer.send('recorder_started');
  },
  sendWaveform: (waveform) => {
    ipcRenderer.send('recorder_waveform', waveform);
  },
  sendChunk: (samplesBuffer) => {
    const bytes = new Uint8Array(samplesBuffer);
    ipcRenderer.send('recorder_chunk', Buffer.from(bytes));
  },
  sendResult: (samplesBuffer) => {
    const bytes = new Uint8Array(samplesBuffer);
    ipcRenderer.send('recorder_result', Buffer.from(bytes));
  },
  sendError: (message) => {
    ipcRenderer.send('recorder_error', message);
  },
};

contextBridge.exposeInMainWorld('recorderAPI', api);
