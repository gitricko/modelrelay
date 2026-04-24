/**
 * @file lib/auth/pkce.js
 * @description PKCE (Proof Key for Code Exchange) generator for OAuth 2.0 PKCE flow.
 *
 * Direct port of PicoClaw's pkg/auth/pkce.go — uses only Node.js built-in `crypto`.
 * No external dependencies.
 *
 * RFC 7636 — https://www.rfc-editor.org/rfc/rfc7636
 */

import { randomBytes, createHash } from 'node:crypto'

/**
 * Generate a PKCE code_verifier and code_challenge pair.
 *
 * - code_verifier: 64 random bytes encoded as base64url (no padding)
 * - code_challenge: SHA-256 of the verifier, encoded as base64url (no padding)
 * - code_challenge_method: "S256"
 *
 * @returns {{ codeVerifier: string, codeChallenge: string }}
 */
export function generatePKCE() {
  const codeVerifier = randomBytes(64).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

/**
 * Generate a random hex state string for OAuth CSRF protection.
 * @returns {string} 64-char hex string (32 bytes)
 */
export function generateState() {
  return randomBytes(32).toString('hex')
}
