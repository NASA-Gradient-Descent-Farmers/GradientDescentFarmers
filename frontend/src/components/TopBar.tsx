import { AccountMenu } from '../account/AccountMenu.tsx'
import { Brand } from './Brand.tsx'
import { LangToggle } from './LangToggle.tsx'
import { LeafMark } from './Leaf.tsx'

/** The quiet top bar: the name on the left; the signed-in person (when there is one) and the language on the right. */
export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <LeafMark className="topbar-leaf" />
        <Brand className="topbar-name" />
      </div>
      <div className="topbar-right">
        <AccountMenu />
        <LangToggle />
      </div>
    </header>
  )
}
