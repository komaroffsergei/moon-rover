import { readdir, readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function text(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

describe('release configuration', () => {
  it('pins every external container image and keeps Playwright versions aligned', async () => {
    const [dockerfile, compose, packageJson] = await Promise.all([
      text('Dockerfile'),
      text('compose.yaml'),
      text('package.json').then(
        (source) =>
          JSON.parse(source) as {
            devDependencies: Record<string, string>;
          },
      ),
    ]);

    const fromImages = [...dockerfile.matchAll(/^FROM\s+(\S+)/gmu)]
      .map(([, image]) => image!)
      .filter((image) => image.includes(':'));
    expect(fromImages).toHaveLength(2);
    expect(
      fromImages.every((image) => /@sha256:[a-f0-9]{64}$/u.test(image!)),
    ).toBe(true);

    const playwrightImage = compose.match(
      /image:\s*mcr\.microsoft\.com\/playwright:v([^@\s]+)-noble@sha256:[a-f0-9]{64}/u,
    );
    expect(playwrightImage?.[1]).toBe(
      packageJson.devDependencies['@playwright/test'],
    );
  });

  it('serves compressed SPA assets from a runtime-only nginx stage', async () => {
    const [dockerfile, nginx, vite] = await Promise.all([
      text('Dockerfile'),
      text('docker/nginx.conf'),
      text('vite.config.ts'),
    ]);
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

    expect(runtimeStage).toContain(' AS runtime');
    expect(runtimeStage).toContain('COPY --from=build /app/dist');
    expect(runtimeStage).not.toMatch(/node_modules|pnpm|npm\s|node\s/u);
    expect(nginx).toMatch(/\bgzip\s+on;/u);
    expect(nginx).toContain('try_files $uri $uri/ /index.html');
    expect(vite).toMatch(/chunkSizeWarningLimit:\s*1_500/u);
  });

  it('keeps regular Playwright artifacts failure-only', async () => {
    const specPaths = (await readdir('tests/e2e'))
      .filter((path) => path.endsWith('.spec.ts'))
      .sort()
      .map((path) => `tests/e2e/${path}`);
    const [config, helpers, specs] = await Promise.all([
      text('playwright.config.ts'),
      text('tests/e2e/dispatcher-helpers.ts'),
      Promise.all(specPaths.map(text)).then((sources) => sources.join('\n')),
    ]);

    expect(specPaths).not.toHaveLength(0);
    expect(config).toContain("screenshot: 'only-on-failure'");
    expect(config).toContain("trace: 'retain-on-failure'");
    expect(helpers).not.toContain('saveEvidence');
    expect(specs).not.toContain('saveEvidence');
  });
});

describe('release documentation', () => {
  const requiredDocs = [
    'docs/CODEMAP.md',
    'docs/GAME_RULES.md',
    'docs/MAP_AUTHORING.md',
    'docs/CONTENT_REFERENCE.md',
    'docs/TESTING.md',
  ] as const;

  it.each(requiredDocs)('%s exists and is substantive', async (path) => {
    const metadata = await stat(path);
    const contents = await text(path);
    expect(metadata.size).toBeGreaterThan(500);
    expect(contents).toMatch(/^#\s/u);
  });

  it('README describes the finished game instead of the bootstrap skeleton', async () => {
    const readme = await text('README.md');
    expect(readme).toContain('docs/CODEMAP.md');
    expect(readme).not.toMatch(/каркас|появятся в последующих задачах/u);
  });
});
