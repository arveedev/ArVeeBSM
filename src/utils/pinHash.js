/**
 * PIN hashing - PINs are never stored or compared in plain text. Uses
 * the browser's native Web Crypto API (SHA-256), available in every
 * modern browser without any external library. This is a one-way hash:
 * there is no way to recover the original PIN from what's stored, only
 * to check whether a newly-entered PIN hashes to the same value.
 *
 * Deliberately NOT a general-purpose password hash (no salt, no
 * iteration count like bcrypt/scrypt) - PINs are short, numeric, and
 * checked locally on-device rather than against a remote attacker who
 * could run an offline brute-force campaign; a single fast SHA-256 pass
 * matches the actual threat model here (someone glancing at IndexedDB
 * in DevTools should not see the PIN in plain text) without the added
 * complexity a full password-hashing scheme would need for a 4-8 digit
 * numeric PIN.
 */
export const hashPin = async (pin) => {
  const data = new TextEncoder().encode(String(pin))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
