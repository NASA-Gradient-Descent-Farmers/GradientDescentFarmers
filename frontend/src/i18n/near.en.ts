// English copy for parcels close to a point with published rotation results; same keys as near.es.ts.

export const nearEn = {
  notice: {
    title: 'There are rotation results for this area',
    body: 'Your parcel is {km} km from {place}{where}, where the rotation model has been run. They are exploratory scenarios with low confidence, not a recommendation.',
    where: ' (municipality of {municipality})',
  },
  noticeEnvironment: {
    title: 'There is NASA data for this area',
    body: 'Your parcel is {km} km from {place}, where climate, soil and satellite data were gathered. The rotation model has not been run here yet.',
  },
  noData: {
    title: 'There is no data for this area yet',
    body: 'YolIA has published data for Sonora, Sinaloa and Guanajuato. The nearest point is {place}, {km} km from your parcel. Pick one of those points on the map to see its options.',
  },
  noRotations: 'The rotation model has not been run for {place} yet: there is only climate, soil and satellite data.',
  noDataCard: {
    title: 'Pick one of the areas with data',
    body: 'Sonora, Sinaloa or Guanajuato. Tap the point on the map or use the shortcuts in "My parcel".',
  },
  heading: 'Rotation options near {place}',
  scope: 'These results are per hectare and for the {place} area; they do not change with your answers about the parcel.',
  recommended: 'The one that best fits the model priorities',
  year: 'year {year}',
  fallow: 'Not planted (fallow)',
  allOptions: 'See all {n} options',
  confidence: 'How reliable they are',
  incomeShort: 'Gross income ≈ {amount} MXN/ha',
}
