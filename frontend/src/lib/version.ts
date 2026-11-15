// The two ways of using YolIA: "agricultor" (plain questions and answers, for farmers) and "tecnico" (the full planner and
// the models behind it, for advisors). Which one a person uses belongs to their account (see src/account/users.ts).

export type Version = 'agricultor' | 'tecnico'

export const isVersion = (value: unknown): value is Version => value === 'agricultor' || value === 'tecnico'
