// Login — custom 6-digit PIN keypad. Implements Step 3.1.
//
// A visually-hidden type="number" input handles physical-keyboard /
// native-keypad entry (per Section 2.3), while the on-screen grid is the
// primary touch interface. Both paths feed the same `pin` string state so
// leading zeros in access codes are preserved.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'

const PIN_LENGTH = 6
const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

function Login() {
  const [pin, setPin] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const { user, login } = useAuth()

  // Auto-focus on mount so the device's native number pad opens immediately.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // If already authenticated (e.g. navigated back to /login manually),
  // bounce straight to the home dashboard.
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const submitPin = async (value) => {
    setIsSubmitting(true)

    const matchedUser = await login(value)

    if (matchedUser) {
      toast.success(`Welcome, ${matchedUser.nickname || matchedUser.name}`)
      navigate('/')
    } else {
      toast.error('Invalid access PIN')
      setPin('')
      inputRef.current?.focus()
    }

    setIsSubmitting(false)
  }

  const appendDigit = async (digit) => {
    if (isSubmitting || pin.length >= PIN_LENGTH) return

    const next = pin + digit
    setPin(next)

    if (next.length === PIN_LENGTH) {
      await submitPin(next)
    }
  }

  const handleBackspace = () => setPin((prev) => prev.slice(0, -1))
  const handleClear = () => setPin('')

  const handleInputChange = async (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH)
    setPin(value)

    if (value.length === PIN_LENGTH) {
      await submitPin(value)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-white">BSM App</h1>
        <p className="mt-1 text-center text-sm text-neutral-400">Enter your access PIN</p>

        {/* type="number" per Section 2.3 — triggers the device-native
            numeric keypad on focus. Visually hidden; the grid below is the
            primary input surface. */}
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          autoFocus
          disabled={isSubmitting}
          value={pin}
          onChange={handleInputChange}
          className="sr-only"
          aria-label="Access PIN"
        />

        {/* PIN progress dots */}
        <div className="mt-8 flex justify-center gap-3">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full border transition-colors ${
                i < pin.length
                  ? 'border-brand-neon bg-brand-neon'
                  : 'border-neutral-700 bg-transparent'
              }`}
            />
          ))}
        </div>

        {/* Custom numeric keypad */}
        <div className="mt-10 grid grid-cols-3 gap-4">
          {KEYPAD_DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={isSubmitting}
              onClick={() => appendDigit(digit)}
              className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-white transition-all hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-[0_0_12px_rgba(255,255,255,0.08)] active:scale-95 disabled:opacity-50"
            >
              {digit}
            </button>
          ))}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleClear}
            className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-sm font-medium text-neutral-400 transition-all hover:border-neutral-600 hover:text-white active:scale-95 disabled:opacity-50"
          >
            Clear
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => appendDigit('0')}
            className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-white transition-all hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-[0_0_12px_rgba(255,255,255,0.08)] active:scale-95 disabled:opacity-50"
          >
            0
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleBackspace}
            aria-label="Backspace"
            className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-white transition-colors active:bg-neutral-800 disabled:opacity-50"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
