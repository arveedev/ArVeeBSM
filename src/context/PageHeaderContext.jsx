// Page header context — lets each page set its own title/subtitle,
// rendered in the persistent AppHeader instead of scrolling away with
// the page's own content. Each page calls setPageHeader() once on mount
// (and whenever a dynamic part like the user's nickname changes).

import { createContext, useContext, useState } from 'react'

const PageHeaderContext = createContext(null)

export const PageHeaderProvider = ({ children }) => {
  const [header, setHeader] = useState({ title: '', subtitle: '' })
  // AppHeader's own actual rendered height - measured live (not
  // guessed) since it varies by page (a page with no subtitle has a
  // shorter header than one with a long "Welcome back..." line), so
  // anything positioned relative to "just below the header" needs the
  // real number, not a fixed assumption.
  const [headerHeight, setHeaderHeight] = useState(60)
  // StickyWarehouseIndicator's own actual rendered height, reported by
  // itself only while it's actually showing (0 otherwise) - needed
  // because if it's already docked when the user taps Edit on
  // something further down the page, its real height must be added on
  // top of headerHeight for the scroll target to land correctly below
  // it, not underneath it.
  const [stickyIndicatorHeight, setStickyIndicatorHeight] = useState(0)
  // Lets a page (currently just Piles.jsx's full-screen pile layout)
  // ask App.jsx to slide the persistent AppHeader/BottomNav out of view
  // - the same "hidden" mechanism already used while a transaction
  // form is open - without App.jsx needing to know anything about that
  // page's own internal full-screen state.
  const [chromeHidden, setChromeHidden] = useState(false)

  const setPageHeader = (next) => setHeader((prev) => ({ ...prev, ...next }))

  return (
    <PageHeaderContext.Provider value={{ ...header, setPageHeader, headerHeight, setHeaderHeight, stickyIndicatorHeight, setStickyIndicatorHeight, chromeHidden, setChromeHidden }}>
      {children}
    </PageHeaderContext.Provider>
  )
}

export const usePageHeader = () => useContext(PageHeaderContext)
