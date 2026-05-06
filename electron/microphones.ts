import { execFileSync } from 'child_process';

export interface MicrophoneOption {
  id: string;
  label: string;
}

let cachedPlatform: NodeJS.Platform | null = null;
let cachedMicrophones: MicrophoneOption[] | null = null;

export function parseMacMicrophoneOptions(raw: string): MicrophoneOption[] {
  try {
    const parsed = JSON.parse(raw) as {
      SPAudioDataType?: Array<{ _items?: Array<Record<string, unknown>> }>;
    };
    const devices = parsed.SPAudioDataType?.flatMap((entry) => entry._items ?? []) ?? [];
    const options: MicrophoneOption[] = [];
    const seen = new Set<string>();

    for (const device of devices) {
      const inputChannels = Number(device.coreaudio_device_input ?? 0);
      const transport = String(device.coreaudio_device_transport ?? '');
      const label = String(device._name ?? '').trim();

      // 这里只保留真正可用于语音输入的实体输入设备。
      // system_profiler 会把 BlackHole 之类的虚拟回环设备也列出来，
      // 对 typetype 的默认体验来说这些选项大多只会造成误选。
      if (!label || inputChannels <= 0 || transport.includes('virtual') || seen.has(label)) {
        continue;
      }

      seen.add(label);
      options.push({ id: label, label });
    }

    return options;
  } catch (error) {
    console.error('Failed to parse macOS microphone list:', error);
    return [];
  }
}

export function getAvailableMicrophones(
  platform: NodeJS.Platform = process.platform
): MicrophoneOption[] {
  if (cachedMicrophones && cachedPlatform === platform) {
    return cachedMicrophones.map((item) => ({ ...item }));
  }

  if (platform === 'darwin') {
    try {
      const raw = execFileSync('system_profiler', ['SPAudioDataType', '-json'], {
        encoding: 'utf-8',
      });
      cachedPlatform = platform;
      cachedMicrophones = parseMacMicrophoneOptions(raw);
      return cachedMicrophones.map((item) => ({ ...item }));
    } catch (error) {
      console.error('Failed to list macOS microphones:', error);
      return [];
    }
  }

  cachedPlatform = platform;
  cachedMicrophones = [{ id: 'default', label: '默认麦克风' }];
  return cachedMicrophones.map((item) => ({ ...item }));
}
