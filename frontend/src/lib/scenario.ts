// The exact five-objective Pareto front of the whole strategy lattice for a set of economics, with a small cache.

import { paretoFront, type Maximize } from './front.ts'
import { Planner } from './planner.ts'
import type { Economics, GridWorld, Meta, ObjectiveKey, Strategy } from './types.ts'
import { OBJECTIVES } from './types.ts'

const CACHE_PER_WORLD = 6
const cache = new WeakMap<GridWorld, Map<string, Strategy[]>>()

/**
 * Score every rotation x fertilizer scale x stover retention of the lattice with `economics` and keep the
 * non-dominated ones on all five objectives. Strategy ids are lattice positions, so they do not depend on prices.
 * Fronts on fewer objectives are subsets of this one (see `frontOn`).
 */
export function exactFront(world: GridWorld, economics: Economics, lattice: Meta['lattice'], maximize: Maximize): Strategy[] {
  const key = JSON.stringify(economics)
  let perWorld = cache.get(world)
  if (!perWorld) cache.set(world, (perWorld = new Map()))
  const hit = perWorld.get(key)
  if (hit) return hit
  const all = new Planner(world, economics).bruteForce(lattice.n_scale_steps, lattice.retention_steps)
  const front = paretoFront(all, [...OBJECTIVES], maximize)
  perWorld.set(key, front)
  if (perWorld.size > CACHE_PER_WORLD) perWorld.delete(perWorld.keys().next().value!)
  return front
}

/** The front on some of the objectives, from the five-objective front (a strategy that is non-dominated on a
 *  subset of objectives is non-dominated on all of them, up to ties). */
export function frontOn(exact: Strategy[], keys: ObjectiveKey[], maximize: Maximize): Strategy[] {
  return keys.length === OBJECTIVES.length ? exact : paretoFront(exact, keys, maximize)
}

/** What a farmer's answers rule out: rotations they will not consider and a ceiling on the yearly cost per hectare. */
export interface Limits {
  rotations?: string[]
  maxCostPerHa?: number | null
}

export interface LimitedFront {
  front: Strategy[]
  /** The mean yearly cost per hectare of a strategy of this front's economics. */
  cost: (strategy: Strategy) => number
  /** False when nothing fits the ceiling: the front is then built from the cheapest strategies instead. */
  feasible: boolean
  /** The lowest cost per hectare among the rotations considered. */
  cheapest: number
  considered: number
}

const subsets = new WeakMap<GridWorld, Map<string, GridWorld>>()

/** The grid with only some rotations, the same object for the same ones so that fronts can be cached on it. */
function restrict(world: GridWorld, rotations: string[] | undefined): GridWorld {
  const order = rotations ? world.order.filter((name) => rotations.includes(name)) : world.order
  if (order.length === 0) throw new Error('None of the rotations asked for is in the grid')
  if (order.length === world.order.length) return world
  const key = order.join('|')
  let perWorld = subsets.get(world)
  if (!perWorld) subsets.set(world, (perWorld = new Map()))
  let subset = perWorld.get(key)
  if (!subset) perWorld.set(key, (subset = { ...world, order, rotations: Object.fromEntries(order.map((name) => [name, world.rotations[name]])) }))
  return subset
}

const limitedCache = new WeakMap<GridWorld, Map<string, LimitedFront>>()

/**
 * The five-objective Pareto front of the strategies that satisfy the limits. Filtering comes before the front is
 * taken: the best plan within a budget is not a point of the unlimited front that happens to be cheap enough.
 */
export function limitedFront(world: GridWorld, economics: Economics, lattice: Meta['lattice'], maximize: Maximize, limits: Limits = {}): LimitedFront {
  const grid = restrict(world, limits.rotations)
  const ceiling = limits.maxCostPerHa ?? null
  const planner = new Planner(grid, economics)
  const costs = new Map<string, number>()
  const cost = (strategy: Strategy) => {
    const key = `${strategy.rotation}|${strategy.nScale}`
    let value = costs.get(key)
    if (value === undefined) costs.set(key, (value = planner.meanCost(strategy.rotation, strategy.nScale)))
    return value
  }
  if (ceiling === null) {
    const front = exactFront(grid, economics, lattice, maximize)
    const cheapest = Math.min(...grid.order.map((name) => planner.meanCost(name, 0)))
    return { front, cost, feasible: true, cheapest, considered: front.length }
  }
  const key = JSON.stringify([economics, grid.order, ceiling])
  let perGrid = limitedCache.get(grid)
  if (!perGrid) limitedCache.set(grid, (perGrid = new Map()))
  const hit = perGrid.get(key)
  if (hit) return hit
  const all = planner.bruteForce(lattice.n_scale_steps, lattice.retention_steps)
  const cheapest = Math.min(...all.map(cost))
  const within = all.filter((strategy) => cost(strategy) <= ceiling + 1e-9)
  const feasible = within.length > 0
  const pool = feasible ? within : all.filter((strategy) => cost(strategy) <= cheapest + 1e-9)
  const result = { front: paretoFront(pool, [...OBJECTIVES], maximize), cost, feasible, cheapest, considered: pool.length }
  perGrid.set(key, result)
  if (perGrid.size > CACHE_PER_WORLD) perGrid.delete(perGrid.keys().next().value!)
  return result
}

export const sameEconomics = (a: Economics, b: Economics) => JSON.stringify(a) === JSON.stringify(b)
