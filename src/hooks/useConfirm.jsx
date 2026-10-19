// Promise-style confirmation using the app's own ConfirmDialog (browser-native confirm() is not used in this app).
//   const [ask, confirmDialog] = useConfirm()
//   if (!(await ask({ title, description, confirmLabel }))) return
//   ... render {confirmDialog} somewhere in the component's output.
import { useCallback, useRef, useState } from 'react'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'

export const useConfirm = () => {
  const [state, setState] = useState({ open: false })
  const resolver = useRef(null)

  const ask = useCallback((options) => new Promise((resolve) => {
    resolver.current = resolve
    setState({ open: true, ...options })
  }), [])

  const settle = (value) => {
    resolver.current?.(value)
    resolver.current = null
    setState((s) => ({ ...s, open: false }))
  }

  const dialog = (
    <ConfirmDialog
      open={state.open}
      title={state.title ?? 'Are you sure?'}
      description={state.description}
      confirmLabel={state.confirmLabel ?? 'OK'}
      cancelLabel={state.cancelLabel ?? 'Cancel'}
      destructive={state.destructive ?? false}
      accent={state.accent ?? true}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )
  return [ask, dialog]
}

export default useConfirm
