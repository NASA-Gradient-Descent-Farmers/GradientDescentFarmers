// Sign-in and the account menu. Accounts are a simulation (a name, no password), and the screens say so.

export const accountEn = {
  intro: 'Sign in with your name so YolIA can keep your field and your answers.',
  signIn: {
    title: 'Sign in',
    lede: 'Choose your account.',
    as: 'Sign in as {name}',
    remove: 'Remove',
    removeAsk: 'Delete the account of {name} and everything it saved on this phone?',
    removeYes: 'Yes, delete',
    removeNo: 'No',
  },
  create: {
    title: 'Create an account',
    another: 'Create another account',
    name: 'Your name',
    namePlaceholder: 'For example: Ana',
    modeQuestion: 'How will you use YolIA?',
    submit: 'Create account and sign in',
    errors: {
      empty: 'Type your name.',
      taken: 'There is already an account with that name on this phone. Type another, or sign in to that one.',
      full: 'There are too many accounts on this phone. Remove one to create another.',
    },
  },
  modes: {
    agricultor: { name: 'Farmer', hint: 'Simple questions and clear answers about your field.' },
    tecnico: { name: 'Technical', hint: 'The full planner, the models and the numbers.' },
  },
  menu: {
    label: 'My account',
    switchTo: { agricultor: 'Switch to Farmer mode', tecnico: 'Switch to Technical mode' },
    signOut: 'Sign out',
  },
  simulated: 'Accounts are a simulation: there is no password and no server, and what you save stays on this phone.',
}
