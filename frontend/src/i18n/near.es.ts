// Copy for parcels close to a point with published rotation results. The figures' wording (gross income, caveats,
// regimes) is shared with the WhatsApp chat: whatsapp.rotations.*.

export const nearEs = {
  notice: {
    title: 'Hay resultados de rotación para esta zona',
    body: 'Tu parcela está a {km} km de {place}{where}, donde ya se corrió el modelo de rotaciones. Son escenarios exploratorios con confianza baja, no una recomendación.',
    where: ' (municipio de {municipality})',
  },
  noticeEnvironment: {
    title: 'Hay datos de la NASA para esta zona',
    body: 'Tu parcela está a {km} km de {place}, donde se reunieron datos de clima, suelo y satélite. Todavía no se corrió el modelo de rotaciones aquí.',
  },
  noData: {
    title: 'Todavía no hay datos para esta zona',
    body: 'YolIA tiene datos publicados para Sonora, Sinaloa y Guanajuato. El punto más cercano es {place}, a {km} km de tu parcela. Elige uno de esos puntos en el mapa para ver sus opciones.',
  },
  noRotations: 'Para {place} todavía no se corrió el modelo de rotaciones: solo hay datos de clima, suelo y satélite.',
  noDataCard: {
    title: 'Elige una de las zonas con datos',
    body: 'Sonora, Sinaloa o Guanajuato. Toca el punto en el mapa o usa los accesos de «Mi parcela».',
  },
  heading: 'Opciones de rotación cerca de {place}',
  scope: 'Estos resultados son por hectárea y para la zona de {place}; no cambian con tus respuestas sobre la parcela.',
  recommended: 'La que mejor encaja con las prioridades del modelo',
  year: 'año {year}',
  fallow: 'Sin sembrar (barbecho)',
  allOptions: 'Ver las {n} opciones',
  confidence: 'Qué tan confiables son',
  incomeShort: 'Ingreso bruto ≈ {amount} MXN/ha',
}
