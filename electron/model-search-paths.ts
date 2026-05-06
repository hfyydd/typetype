import * as path from 'path';

export interface ModelSearchPathOptions {
  dataDir: string;
  processResourcesPath: string;
  appPath: string;
}

export function getModelSearchPaths({
  dataDir,
  processResourcesPath,
  appPath,
}: ModelSearchPathOptions): string[] {
  const paths = [
    path.join(dataDir, 'models'),
    path.join(processResourcesPath, 'models'),
  ];

  if (path.basename(appPath) !== 'app.asar') {
    paths.push(path.join(appPath, 'resources', 'models'));
  }

  return paths;
}
