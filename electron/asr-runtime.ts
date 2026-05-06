import * as os from 'os';

import { Settings } from './types';

export type ProviderName = 'cpu' | 'coreml' | 'cuda' | 'directml';

export function getDefaultNumThreads(cpuCount: number = os.cpus().length): number {
  return Math.max(1, Math.min(cpuCount, 6));
}

export function getProviderCandidates(
  computeBackend: Settings['compute_backend'],
  platform: NodeJS.Platform = process.platform
): ProviderName[] {
  const gpuCandidates: ProviderName[] =
    platform === 'darwin'
      ? ['coreml']
      : platform === 'win32'
        ? ['cuda', 'directml']
        : [];

  if (computeBackend === 'cpu') {
    return ['cpu'];
  }

  if (computeBackend === 'gpu') {
    return gpuCandidates;
  }

  return [...gpuCandidates, 'cpu'];
}
