// Sign-in and the account menu. Accounts are a simulation (a name, no password), and the screens say so.

export const accountEs = {
  intro: 'Entra con tu nombre para que YoliA guarde tu parcela y tus respuestas.',
  signIn: {
    title: 'Entrar',
    lede: 'Elige tu cuenta.',
    as: 'Entrar como {name}',
    remove: 'Quitar',
    removeAsk: '¿Borrar la cuenta de {name} y todo lo que guardó en este teléfono?',
    removeYes: 'Sí, borrar',
    removeNo: 'No',
  },
  create: {
    title: 'Crear una cuenta',
    another: 'Crear otra cuenta',
    name: 'Tu nombre',
    namePlaceholder: 'Por ejemplo: Ana',
    modeQuestion: '¿Cómo vas a usar YoliA?',
    submit: 'Crear cuenta y entrar',
    errors: {
      empty: 'Escribe tu nombre.',
      taken: 'Ya hay una cuenta con ese nombre en este teléfono. Escribe otro, o entra con esa cuenta.',
      full: 'Ya hay demasiadas cuentas en este teléfono. Quita una para crear otra.',
    },
  },
  modes: {
    agricultor: { name: 'Agricultor', hint: 'Preguntas sencillas y respuestas claras sobre tu parcela.' },
    tecnico: { name: 'Técnico', hint: 'El planificador completo, los modelos y los números.' },
  },
  menu: {
    label: 'Mi cuenta',
    switchTo: { agricultor: 'Cambiar a modo Agricultor', tecnico: 'Cambiar a modo Técnico' },
    signOut: 'Salir',
  },
  simulated: 'Las cuentas son una simulación: no hay contraseña ni servidor, y lo que guardas se queda en este teléfono.',
}
