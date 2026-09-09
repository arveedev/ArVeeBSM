/**
 * PIN hashing - PINs are never stored or compared in plain text. Uses
 * the browser's native Web Crypto API (SHA-256), available in every
 * modern browser without any external library. This is a one-way hash:
 * there is no way to recover the original PIN from what's stored, only
 * to check whether a newly-entered PIN hashes to the same value.
 *
 * The `users` table (and the global visitorAccessCode) is a SYNCED
 * Dexie Cloud table, so these hashes exist server-side too - not just
 * on-device. A 6-digit numeric PIN only has 1,000,000 possible values,
 * so a bare SHA-256(pin) hash is defeated by a generic precomputed
 * rainbow table in seconds, reusable against any app that hashes PINs
 * the same plain way. PIN_SALT below is appended before hashing so this
 * app's hashes don't match a generic public table - real friction
 * against the realistic threat (someone with read access to the synced
 * data running an off-the-shelf lookup), even though a targeted
 * attacker with this source file could still build one for this app
 * specifically. Not a general-purpose password hash otherwise (no
 * per-user salt, no iteration count like bcrypt/scrypt) - that's a
 * larger, separately-scoped change if ever needed.
 */
const PIN_SALT = 'bsm-app-pin-salt-v2::'

const sha256Hex = async (input) => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const hashPin = (pin) => sha256Hex(PIN_SALT + String(pin))

/**
 * The pre-salting hash (bare SHA-256(pin), no PIN_SALT). Every account
 * created before this fix has an accessCode/visitorAccessCode stored
 * this way - since a hash can't be migrated without the original PIN,
 * this is used ONLY at login time to recognize a not-yet-upgraded
 * account and re-hash it (now that the real PIN was just typed in) to
 * the salted form. Never used to create a new hash.
 */
export const hashPinLegacyUnsalted = (pin) => sha256Hex(String(pin))
