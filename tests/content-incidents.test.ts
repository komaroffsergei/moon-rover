import { describe, expect, it } from 'vitest';

import { ContentValidationError, loadContentBundle } from '../src/content';
import { makeBundleFixture } from './fixtures/content';

function expectBundleIssue(
  mutate: (bundle: ReturnType<typeof makeBundleFixture>) => void,
  code: string,
  path: string,
): void {
  const bundle = makeBundleFixture();
  mutate(bundle);

  try {
    loadContentBundle(bundle);
    expect.unreachable('bundle must reject inconsistent incident chances');
  } catch (error) {
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues).toContainEqual(
      expect.objectContaining({ code, path }),
    );
  }
}

describe('incident content references', () => {
  it('requires the normal profile chance to match balance', () => {
    expectBundleIssue(
      (bundle) => {
        bundle.incidents.profiles.find(
          ({ id }) => id === 'normal',
        )!.cellChance = 0.009;
      },
      'content.normal-incident-chance',
      '$.incidents.profiles',
    );
  });

  it.each([0.079, 0.161])(
    'requires hazard profile chance %s to stay inside the balance range',
    (cellChance) => {
      expectBundleIssue(
        (bundle) => {
          bundle.incidents.profiles.find(
            ({ id }) => id === 'hazard-low',
          )!.cellChance = cellChance;
        },
        'content.hazard-incident-chance',
        '$.incidents.profiles[1].cellChance',
      );
    },
  );
});
