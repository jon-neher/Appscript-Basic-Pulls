/**
* Unit tests for the multi-site recommendation engine.
*/

import { recommendDocumentationSite } from '../src/server/SiteRecommendationEngine.js';

describe('recommendDocumentationSite()', () => {
  const sites = [
    {
      id: 'dev-docs',
      type: 'developer docs',
      visibility: 'public',
      categories: ['api-reference', 'tutorial'],
    },
    {
      id: 'user-guides',
      type: 'user guides',
      visibility: 'public',
      categories: ['tutorial', 'troubleshooting'],
    },
    {
      id: 'internal-wiki',
      type: 'internal wiki',
      visibility: 'internal',
      categories: ['troubleshooting'],
    },
  ];

  test('selects developer docs for developer API reference', () => {
    const res = recommendDocumentationSite({
      audience: 'developer',
      contentType: 'api-reference',
      sites,
    });

    expect(res.recommendedSiteId).toBe('dev-docs');
    expect(res.ranking[0]).toBe('dev-docs');
  });

  test('selects internal wiki for internal troubleshooting', () => {
    const res = recommendDocumentationSite({
      audience: 'internal-staff',
      contentType: 'troubleshooting',
      sites,
    });

    expect(res.recommendedSiteId).toBe('internal-wiki');
  });
});
