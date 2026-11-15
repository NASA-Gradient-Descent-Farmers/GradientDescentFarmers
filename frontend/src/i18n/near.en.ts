// English copy for parcels close to a point with published rotation results; same keys as near.es.ts.

export const nearEn = {
  notice: {
    title: 'There are rotation results for this area',
    body: 'Your parcel is {km} km from {place}{where}, where the rotation model has been run. They are exploratory scenarios with low confidence, not a recommendation.',
    where: ' (municipality of {municipality})',
  },
  noticeEnvironment: {
    title: 'There is NASA data for this area',
    body: 'Your parcel is {km} km from {place}, where climate, soil and satellite data were gathered.',
  },
  nearest: {
    title: 'You are seeing the nearest reference area',
    body: 'Your pin is {km} km from {place}. The results you see are for that point, the closest one to your parcel.',
  },
  heading: 'Rotation options near {place}',
  scope: 'Results per hectare for the {place} area. They are ordered by what matters most to you.',
  forGoal: 'The best fit for what matters to you: {goal}',
  recommended: 'The one that best fits the model priorities',
  year: 'year {year}',
  fallow: 'Not planted (fallow)',
  allOptions: 'See all {n} options',
  confidence: 'How reliable they are',
  incomeShort: 'Gross income ≈ {amount} MXN/ha',
}
