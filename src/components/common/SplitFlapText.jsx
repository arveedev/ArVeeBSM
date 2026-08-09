import { useEffect, useRef, useState } from 'react'

/**
 * Renders `text` as a sequence of individually-flipping characters,
 * like an old airport departure board - but only characters that
 * actually changed since the last render flip; unchanged characters
 * (and the overall string length changing) are handled gracefully
 * without unnecessary animation. Text only, no background of its
 * own - drop this in anywhere text would normally go; the parent's
 * own font/color/size styling applies as usual.
 *
 * Deliberately fast (a single quick flip per character, not cycling
 * through intermediate values like a real mechanical board) - this
 * is a visual flourish, not something the user should ever have to
 * wait on before seeing the correct value.
 *
 * @param {string} text - the current text to display
 * @param {string} [className] - optional className applied to the wrapping span
 */
export default function SplitFlapText({ text, className = '' }) {
  const previousTextRef = useRef(text)
  const [flippedIndices, setFlippedIndices] = useState(new Set())

  useEffect(() => {
    const prev = previousTextRef.current
    if (prev !== text) {
      const changed = new Set()
      const maxLen = Math.max(prev.length, text.length)
      for (let i = 0; i < maxLen; i++) {
        if (prev[i] !== text[i]) changed.add(i)
      }
      setFlippedIndices(changed)
      previousTextRef.current = text
      const t = setTimeout(() => setFlippedIndices(new Set()), 300)
      return () => clearTimeout(t)
    }
  }, [text])

  return (
    <span className={className}>
      {text.split('').map((char, i) => (
        <span key={`${i}-${flippedIndices.has(i) ? char : 'static'}`} className={flippedIndices.has(i) ? 'animate-split-flap-char' : ''}>
          {char}
        </span>
      ))}
    </span>
  )
}
