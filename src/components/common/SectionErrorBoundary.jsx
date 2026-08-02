// Error boundary - catches a render-time crash in whatever it wraps
// and shows a small, contained fallback instead of taking down the
// entire app. Class component is required here - React only supports
// error boundaries via componentDidCatch/getDerivedStateFromError,
// there is no hooks equivalent.

import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

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
  }

  render() {
    if (this.state.hasError) {
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
