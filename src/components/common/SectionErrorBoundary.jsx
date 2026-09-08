// Error boundary - catches a render-time crash in whatever it wraps
// and shows a small, contained fallback instead of taking down the
// entire app. Class component is required here - React only supports
// error boundaries via componentDidCatch/getDerivedStateFromError,
// there is no hooks equivalent.

import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import { logError } from '../../utils/errorLog.js'

class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error(`[SectionErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info)
    // `user` - a class component has no hook access to useAuth() itself,
    // so every caller passes its own already-in-scope user down as a
    // prop instead.
    logError(`${this.props.label ?? 'Section'} crash`, error, this.props.user)
  }

  render() {
    if (this.state.hasError) {
      // fullPage: for a boundary wrapping an entire route (see App.jsx) -
      // "the rest of the page is unaffected" is simply false there, since
      // the crashed component IS the whole page's content. Centered and
      // roomier instead of the small inline card the section-level
      // fallback below uses, and BottomNav (rendered as App.jsx's own
      // sibling, not inside this boundary) stays usable either way, so
      // "go to Home" is a real way out rather than a dead end.
      if (this.props.fullPage) {
        return (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertTriangle size={28} className="text-neutral-500" />
            <div>
              <p className="text-sm font-medium text-app-text">
                {this.props.label ?? 'This page'} couldn't load.
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Try another tab below, or reload the app.
              </p>
            </div>
          </div>
        )
      }
      return (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-neutral-500" />
          <div className="flex-1">
            <p className="text-xs text-neutral-500">
              {this.props.label ? `${this.props.label} ` : 'This section '}
              couldn't load. The rest of the page is unaffected.
            </p>
            {this.props.onClose && (
              <button
                type="button"
                onClick={this.props.onClose}
                className="mt-2 rounded-lg border border-neutral-700 px-3 py-1 text-xs text-neutral-300"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default SectionErrorBoundary
