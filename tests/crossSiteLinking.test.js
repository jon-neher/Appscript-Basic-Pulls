/**
* Verifies that the recommendation engine emits cross-site link suggestions
* when the recommended site lacks categories available elsewhere.
*/

import { recommendDocumentationSite } from '../src/server/SiteRecommendationEngine.js';

test('cross-site link suggestion is present when categories missing', () => {
  const sites = [
    {
      id: 'user-guides',
      type: 'user guides',
      visibility: 'public',
      categories: ['tutorial'],
    },
    {
      id: 'dev-docs',
      type: 'developer docs',
      visibility: 'public',
      categories: ['api-reference'],
    },
  ];

  const res = recommendDocumentationSite({
    audience: 'developer',
    contentType: 'tutorial',
    sites,
  });

  expect(res.recommendedSiteId).toBe('user-guides');
  expect(res.crossSiteLinks).toEqual([
    expect.objectContaining({ fromSiteId: 'user-guides', toSiteId: 'dev-docs' }),
  ]);
});
