# Serverless Contacts / Friends — Design Notes

> **Status:** *not for implementation yet.* Idea-stage design document. Aligns with the user's brief.

---

## 1. The Idea (in the user's words)

> *"Can we implement a contacts/friends feature WITHOUT a server to store userdata? I'm thinking if when you choose a name a private/public key is generated you could sort of store it client side give people a tag like discord used to so that multiple people can have the same name without conflict and have some way of sending the private key to other devices through a short code or qr code scan so you can have the same 'account' on multiple devices."*

So:

- No central server for identity, contacts, or auth.
- Identity = (chosen display name + 4-digit tag) backed by a keypair generated on the user's device.
- Private key is *transferable* between devices via QR code or short word sequence, so one "account" can be hosted on phone + PC + VR headset at once.
- Contacts live only on the user's devices — never on a server.

This document captures the design space, pros/cons, and an implementation outline for the day a developer picks it up.

---

## 2. TL;DR

Yes, technically feasible.

- **Keypair:** Ed25519 via `crypto.subtle.generateKey` (fallback to ECDSA P-256 if Ed25519 isn't available on Safari).
- **Public key** = canonical user identity, base64url-encoded.
- **Display name + 4-digit tag** = human-readable label, *not* unique on its own.
- **Tag derivation:** last 4 hex characters of `SHA-256(publicKey + displayName)` taken modulo 10000. Deterministic so re-importing on another device yields the same `name#1234` tag — same account on multiple devices looks consistent everywhere.
- **Client-side storage:** IndexedDB, encrypted with an optional passphrase-derived key (PBKDF2 over a user-supplied password; if no passphrase, the key is stored in plaintext, exportable but not portable across cleared-storage devices).
- **Multi-device transfer:** BIP-39-style 12-word mnemonic of the private key, or a QR code containing the same data. Both forms decode to `Uint8Array` and feed back into `crypto.subtle.importKey`.

## 3. Concepts

### 3.1 Identity
- **Public key** — 32 bytes (Ed25519). The "true" identifier. Anyone holding it can send you a message or invite you to a room.
- **Private key** — 64 bytes (Ed25519 seed + public). Only you should hold it. Lost = account gone unless backed up.
- **Display name** — what other humans see. Mutable. Case-insensitive for matching across rooms.
- **Tag** — `0000`–`9999`. Derived deterministically from `(publicKey, displayName)`. Stays stable when the same keypair restores the same name.
- **Public fingerprint** — `first 8 chars of base32(SHA-256(publicKey))`. Used for voice/tag sanity check in voice chat ("are you talking to keith#4829 or a clone?").

### 3.2 Contact graph
- **Contact entry:** `{ publicKey, displayName, tag, trust: 'unknown' | 'verified' }, lastSeenAt?: ISOString, note?: string }`
- **Trust:**
  - *Unknown* — added the publicKey but never verified.
  - *Verified* — completed a challenge handshake (see §4.2).
- No central directory. All contacts live in the user's IndexedDB.
- **Opt-in "be discoverable in shared rooms"** — when joining a room, broadcast your (*publicKey*, *displayName*, *tag*) over the room's existing PeerJS connection. If a currently-online contact is in the room, the UI shows a green dot next to their contact card.

### 3.3 Rooms
- Rooms become "membership-aware": any participant with a public key already in your contacts list is auto-marked as a contact in this session.
- Rooms can be **public** (anyone with the room id joins) or **invite-only** (joining requires an invite token signed by a current contact).

## 4. Implementation outline

### Phase 1 — Identity (no networking)

1. **Settings → Identity** section:
   - Show current *(name, tag, fingerprint)*.
   - "Change display name" → regenerates the tag deterministically. Warns that existing contacts will see the new tag.
   - "Export account" → produces a QR + 12-word mnemonic, both encoding the private key.
   - "Import account" → paste words OR paste base64 key OR scan QR. Imported key replaces local identity; warns that any unexported contacts on the old device become unreachable.
2. **IndexedDB:** new `identity` object store with a single record: `{ privateKey, publicKey, displayName, tag, fingerprint, createdAt }`.
3. **Crypto:** `crypto.subtle.generateKey({name:'Ed25519'}, true, ['sign', 'verify'])`. Ed25519 supported in Chrome/Edge/Firefox; fall back to `{name:'ECDSA', namedCurve:'P-256'}` on Safari < 14.

### Phase 2 — Contacts (one-to-one)

1. **Contacts panel** in DashMenu: list of contacts with online indicator (green dot when in shared room).
2. **Add contact:** paste someone's `(publicKey, displayName, tag)` triple, OR scan QR with the same triple baked in, OR enter their words (derives publicKey from the mnemonic).
3. **Challenge handshake** for `verified` trust:
   - Alice generates nonce `n`, encrypts with Bob's publicKey (ECIES), sends through the shared room's data channel.
   - Bob decrypts, signs `n + Alice.publicKey` with his privateKey, returns.
   - Alice verifies Bob's signature using Bob.publicKey. On match → `trust = 'verified'`.
   - Same path in reverse.

### Phase 3 — Friendlier onboarding

1. **In-world contact card:** a 3D mesh that floats an avatar-style summary card (name + tag + fingerprint + Join button) — already half-impl in the misc-file pattern; same render pipeline.
2. **Pairing via QR proximity:** open Settings → "Add device". Both devices show a QR. Decoding → keypair transfer. Confirmation is a symmetric hash echo of the privateKey to verify no transcription error.
3. **mDNS-style LAN discovery** *(opt-in, default off)* — broadcasts a UDP multicast "looking for friends" beacon that includes only the publicKey, not the displayName. Discovery is privacy-by-default OFF.

## 5. Pros

| Pro | Why it matters |
|-----|----------------|
| Zero infrastructure | No server to host, no DB to maintain, no cost to run. |
| Privacy by default | Contacts never leave your device. |
| Censorship-resistant | No central party can deplatform you. |
| No data-breach risk | There's nothing centralized to breach. |
| Cross-device | Same account on phone/PC/VR by design. |
| Plays well with current PeerJS stack | PublicKey fits naturally into the existing PeerJS data-channel payload alongside room spawn envelopes. |

## 6. Cons / Real Costs

| Con | Why it matters / mitigation |
|-----|----------------------------|
| **Lost device = lost account** | Unless backed up via words/QR. Mitigation: prominent onboarding warning; optional PIN for the IndexedDB encryption key; encourage word backup at first launch. |
| **No global discovery** | You can't search for "everyone named Sarah" — must be introduced in person, via QR, or via room-invite. |
| **Tag collisions** | 4 digits = 1/10000 per (publicKey, displayName). Repeated regens can collide. Mitigation: append a hyphen + year when collision detected (`sarah#4829-26`); warn the user. |
| **Key management is the user's problem** | Most users are bad at this. Mitigation: a "Lost my account / recover" flow that accepts the words/QR; clean messaging that the words are the *only* way. |
| **Encrypted-backup recovery** | If privateKey is encrypted with passphrase + user forgets passphrase, the account is gone. Mitigation: allow a "plaintext mode" with an explicit warning; or design a 2-of-3 social-recovery protocol (see §7). |
| **Trust is local** | "I trust keith#4829" means nothing to anyone else. Velocity of impersonation is *also* higher than in centralized auth. Mitigation: challenge-handshake for verified trust; per-room "first-time I see this publicKey" prompts. |
| **Moderation is social** | No global ban. Mitigation: per-room allowlists + report/forward-to-room-host verbs. |
| **Keypair rotation** | Losing all your devices = lose all your contacts (their publicKeys are gone). Mitigation: room participants can export their keys at session-end if they want a contact entry to persist; explicit "sync contact graph?" prompt. |

## 7. Open questions

- **Tag freshness:** should changing your name re-roll the tag?
  - Recommendation: yes, deterministically from `(publicKey, displayName)`. Old tag never re-derives. Existing contacts see the new tag with a "tag changed" hint.
- **Old contacts frozen vs updated:** when a contact changes name/tag, does the local contact list show the old atts or the new?
  - Recommendation: local entry displays whatever the contact last broadcast while you were in a shared room. We do not overwrite local notes.
- **Account recovery via social escrow?** 2-of-3 friends sign a recovery claim?
  - Possible but adds cryptographic complexity (BLS threshold sigs?). Phase 4.
- **What if someone else claims your exported words?** nothing crypto can do — warn the user, time-stamp QR codes at export, and recommend word backup is short-lived.
- **Identity vs friendly name in rooms:** rooms remember users by *public key*, not display name. If a user renames, history entries (chat messages, asset spawn envelopes) still attribute to the same publicKey. Display names in old logs are shown verbatim (whatever was on screen at the time).

## 8. Alternative paths considered

- **Public registry / directory server.** Solves discovery, but defeats the "no server" premise. Could be merged: optional opt-in. (Out of scope for "no server".)
- **IPFS / OrbitDB / CRDT store.** Doable for contacts persistence across devices without a dedicated server, but adds dependency weight and CRDT semantics the codebase doesn't otherwise need.
- **Bluetooth proximity pairing.** Real-world QR scan is more verifiable (you read what you scan); Bluetooth is faster but adds platform support surface (especially Web Bluetooth + iOS limitations).
- **Sign in with X (OAuth).** Defeats "no server". Could be layered as a *separate* mode (Sign in with Discord) but is not what the user asked for.

## 9. Suggested ordering if implemented

1. Phase 1 identity only (no networking) — pure identity CRUD in IndexedDB, Settings panel UI. ~2 days.
2. Phase 2 contacts — local contact list, QR add, challenge handshake inside existing rooms. ~3 days.
3. Phase 3 friendlier onboarding — in-world card, pairing, opt-in LAN discovery. ~3 days.
4. Phase 4 social recovery (optional). TBD.

Total estimate: ~1 week for phases 1+2, optional +week for phase 3.

## 10. Privacy posture (recommended defaults)

The defaults below match what users *probably* expect. Each can be flipped in Settings.

- **Display name broadcast in shared rooms:** ON by default.
- **Tag broadcast in shared rooms:** ON by default.
- **Public key broadcast in shared rooms:** ON by default (it's a public key, not a secret — but worth surfacing).
- **LAN mDNS discovery:** OFF by default.
- **Allow contact entries without challenge handshake:** ON by default (low-stakes lookup) but trust level defaults to `unknown` until handshake completes.
- **Auto-save contact when joining a room:** OFF by default. The user must explicitly "Add to contacts" after seeing someone in a room.

## 11. Risks specific to this codebase

- **PeerJS identity drift:** the existing `NetworkService` uses PeerJS-assigned peer ids, not user-chosen keys. Migrating to keypair-based identity affects every spawn/transform envelope. Plan a versioned envelope `{v: 2, publicKey, payload}` with a back-compat reader.
- **AvatarManager** currently uses PeerJS peerId for avatar lookups. Same migration.
- **InventoryService** doesn't depend on identity directly but a strict "this inventory belongs to keith#4829" model would need an `ownerPublicKey` field for cloud sync (when that eventually lands).
- **UndoRedoManager & scene snapshots** can include usernames in their labels ("Transform Cube by keith#4829"). These should switch to `keith#4829` (key-stable) rather than just `keith` (name-stable).
