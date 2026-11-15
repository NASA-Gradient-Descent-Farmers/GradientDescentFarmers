// Small line icons (24 x 24, drawn with currentColor) for the farmer screens. Each is decorative: the text beside it says the same thing.

import type { ReactNode } from 'react'

const svg = (children: ReactNode, size = 24) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
)

export const PinIcon = () => svg(<><path d="M12 21s-6.500-5.600-6.500-11a6.500 6.500 0 0 1 13 0c0 5.400-6.500 11-6.500 11z" /><circle cx="12" cy="10" r="2.400" /></>)
export const SearchIcon = () => svg(<><circle cx="11" cy="11" r="6.500" /><path d="M16 16l5 5" /></>)
export const LocateIcon = () => svg(<><circle cx="12" cy="12" r="3.500" /><path d="M12 2.500v4M12 17.500v4M2.500 12h4M17.500 12h4" /></>)
export const MapIcon = () => svg(<><path d="M9 4L3 6.500v13.500l6-2.500 6 2.500 6-2.500V4l-6 2.500z" /><path d="M9 4v13.500M15 6.500V20" /></>)
export const SproutIcon = () => svg(<><path d="M12 21v-8" /><path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6z" /><path d="M12 13c0-3 2-5 6-5 0 3-2 5-6 5z" /></>)
export const AskIcon = () => svg(<path d="M4 5h16v11H9.500L5 20v-4H4z" />)
export const SavedIcon = () => svg(<path d="M6.500 3.500h11v17L12 16.500l-5.500 4z" />)
export const MicIcon = () => svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3" /></>)
export const SendIcon = () => svg(<path d="M12 19V5M5.500 11.500L12 5l6.500 6.500" />)
export const CheckIcon = () => svg(<path d="M5 12.500l4.500 4.500L19 7" />)
export const InfoIcon = () => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.800h.01" /></>)
export const WarnIcon = () => svg(<><path d="M12 3.500L2.500 20h19z" /><path d="M12 10v4.500M12 17.300h.01" /></>)
export const ChevronIcon = () => svg(<path d="M6 9l6 6 6-6" />)
export const PlusIcon = () => svg(<path d="M12 5v14M5 12h14" />)
export const MinusIcon = () => svg(<path d="M5 12h14" />)
export const CloseIcon = () => svg(<path d="M6 6l12 12M18 6L6 18" />)
export const TrashIcon = () => svg(<path d="M4 7h16M9 7V4h6v3M6.500 7l1 13h9l1-13" />)

// Crops of last season
export const MaizeIcon = () => svg(<><path d="M12 3c3 2.500 3.500 7 0 13-3.500-6-3-10.500 0-13z" /><path d="M12 8v8M9.800 10.500h4.400M9.500 13.500h5" /><path d="M12 16c-3 .5-5 2.500-5 5M12 16c3 .5 5 2.500 5 5" /></>)
export const BarleyIcon = () => svg(<><path d="M12 21V8" /><path d="M12 8c-2-.5-3-2-3-4 2 .5 3 2 3 4zM12 8c2-.5 3-2 3-4-2 .5-3 2-3 4z" /><path d="M12 13c-2-.5-3-2-3-4M12 13c2-.5 3-2 3-4M12 18c-2-.5-3-2-3-4M12 18c2-.5 3-2 3-4" /></>)
export const BeanIcon = () => svg(<><path d="M4.500 16C3.500 10 9 5 20 4c1 5-4 11.500-15.500 12z" /><circle cx="10" cy="11.500" r="1" /><circle cx="14.500" cy="9" r="1" /></>)
export const OtherCropIcon = () => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>)
export const FallowIcon = () => svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>)

// Water
export const RainCloudIcon = () => svg(<><path d="M7 15a4.500 4.500 0 0 1 .500-9A6 6 0 0 1 19 8.500a3.500 3.500 0 0 1-.500 6.500H7z" /><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" /></>)
export const SomeWaterIcon = () => svg(<><path d="M7 14a4.500 4.500 0 0 1 .500-9A6 6 0 0 1 19 7.500a3.500 3.500 0 0 1-.500 6.500H7z" /><path d="M12 16.500s2 2 2 3.500a2 2 0 0 1-4 0c0-1.500 2-3.500 2-3.500z" /></>)
export const DropIcon = () => svg(<path d="M12 3s6 6.500 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z" />)

// What matters most
export const EarnIcon = () => svg(<><circle cx="12" cy="12" r="9" /><path d="M14.500 9.500c-.5-1.500-5-1.500-5 .5 0 2.500 5 1 5 3.500 0 2-4.500 2-5.500.5M12 6.500v1.500M12 16v1.500" /></>)
export const SafeIcon = () => svg(<><path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>)
// a mound of earth with a shoot coming out of it
export const SoilIcon = () => svg(<><path d="M3 20h18" /><path d="M5 20c1.500-4 4-5.500 7-5.500s5.500 1.500 7 5.500" /><path d="M12 14.500V8" /><path d="M12 10.500C12 8.500 10.500 7 8 7c0 2 1.500 3.500 4 3.500z" /><path d="M12 9c0-2 1.500-3.500 4-3.500 0 2-1.500 3.500-4 3.500z" /></>)
