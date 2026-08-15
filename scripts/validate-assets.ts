import { inspectRepositoryAssets } from './asset-validation';

const includeDist = process.argv.includes('--dist');
const report = await inspectRepositoryAssets(process.cwd(), includeDist);

for (const issue of report.issues) {
  console.error(`${issue.code} ${issue.path}: ${issue.message}`);
}

if (report.issues.length > 0) {
  process.exitCode = 1;
} else {
  const backgrounds = report.backgrounds
    .map(
      ({ path, bytes, width, height }) =>
        `${path}=${width}x${height}/${bytes}B`,
    )
    .join(', ');
  const initialLoad = Object.entries(report.initialLoadBytes)
    .map(([id, bytes]) => `${id}=${bytes}B`)
    .join(', ');
  console.log(
    `Assets valid: ${backgrounds}; atlas=${report.atlasTiles}/${report.atlasBytes}B/alpha=${report.atlasHasTransparency}; objects=${report.objectBytes}B${initialLoad ? `; initial-load ${initialLoad}` : ''}`,
  );
}
