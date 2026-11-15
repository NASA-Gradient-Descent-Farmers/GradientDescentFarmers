import { WATER, type Water } from '../../lib/farm.ts'
import { GOALS, PREVIOUS, type Goal, type Previous } from '../state.ts'
import type { Option } from './BigChoice.tsx'
import { BarleyIcon, BeanIcon, DropIcon, EarnIcon, FallowIcon, MaizeIcon, OtherCropIcon, RainCloudIcon, SafeIcon, SomeWaterIcon, SoilIcon } from './glyphs.tsx'

type T = (path: string, vars?: Record<string, string | number>) => string

const PREVIOUS_ICON = { maize: <MaizeIcon />, barley: <BarleyIcon />, fababean: <BeanIcon />, other: <OtherCropIcon />, none: <FallowIcon /> }
const WATER_ICON = { rain: <RainCloudIcon />, some: <SomeWaterIcon />, regular: <DropIcon /> }
const GOAL_ICON = { earn: <EarnIcon />, safe: <SafeIcon />, soil: <SoilIcon /> }

/** The answers to each question as large, labelled options. The same lists serve "Mi parcela" and the questions asked in the chat. */
export const previousOptions = (t: T): Option<Previous>[] => PREVIOUS.map((value) => ({ value, label: t(`farmer.parcel.previous.${value}`), icon: PREVIOUS_ICON[value] }))

export const waterOptions = (t: T): Option<Water>[] =>
  WATER.map((value) => ({ value, label: t(`farmer.parcel.water.${value}.label`), hint: t(`farmer.parcel.water.${value}.hint`), icon: WATER_ICON[value] }))

export const goalOptions = (t: T): Option<Goal>[] =>
  GOALS.map((value) => ({ value, label: t(`farmer.parcel.goal.${value}.label`), hint: t(`farmer.parcel.goal.${value}.hint`), icon: GOAL_ICON[value] }))
