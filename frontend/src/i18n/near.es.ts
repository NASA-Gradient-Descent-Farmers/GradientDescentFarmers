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
    body: 'Tu parcela está a {km} km de {place}, donde se reunieron datos de clima, suelo y satélite.',
  },
  nearest: {
    title: 'Estás viendo la zona de referencia más cercana',
    body: 'Tu pin está a {km} km de {place}. Los resultados que ves son de ese punto, que es el más cercano a tu parcela.',
  },
  heading: 'Opciones de rotación cerca de {place}',
  scope: 'Resultados por hectárea para la zona de {place}. Se ordenan según lo que más te importa.',
  forGoal: 'Lo que mejor encaja con lo que te importa: {goal}',
  forHectares: 'Para tus {ha} ha: ≈ {total} MXN en todo el plan (el ingreso por hectárea multiplicado por tus hectáreas).',
  recommended: 'La que mejor encaja con las prioridades del modelo',
  year: 'año {year}',
  fallow: 'Sin sembrar (barbecho)',
  allOptions: 'Ver las {n} opciones',
  confidence: 'Qué tan confiables son',
  incomeShort: 'Ingreso bruto ≈ {amount} MXN/ha',
}
