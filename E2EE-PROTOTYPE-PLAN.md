# GRAMORA E2EE Prototype — Safety Plan

Status: planning only. This document does not enable encryption in the live app.

## Current live system
- The production chat remains on Firebase Authentication + Cloud Firestore.
- Existing messages are plaintext in Firestore. Do not describe the current chat as end-to-end encrypted.
- Keep the current chat and Firestore rules unchanged while evaluating the prototype.

## Candidate cryptography
Evaluate the official Matrix Rust Crypto WebAssembly SDK (`@matrix-org/matrix-sdk-crypto-wasm`) and its browser persistence support. It provides an E2EE state machine and browser IndexedDB-backed crypto storage. It is designed as part of a Matrix client/server implementation, not as a drop-in encryption helper for arbitrary Firestore chat.

Official references:
- https://matrix-org.github.io/matrix-sdk-crypto-wasm/
- https://matrix-org.github.io/matrix-js-sdk/

## Architecture decision required
Before integrating, decide whether GRAMORA will:
1. Keep Firebase as the message transport and build a carefully reviewed adapter around a vetted protocol implementation, if supported; or
2. Move chat transport to a Matrix homeserver and use the Matrix client SDK end-to-end.

Do not silently mix Matrix protocol assumptions with Firestore documents.

## Prototype acceptance tests
The isolated prototype must pass all of these before any production chat code changes:
- Two separate browser profiles/devices can establish distinct device identities.
- A message encrypted on device A decrypts on device B.
- Firestore/network inspection shows ciphertext only, not message text or reply previews.
- GIF/sticker metadata and attachment handling do not leak message content.
- Device verification detects an untrusted/changed device.
- A recovery or secure device-transfer flow restores access without uploading plaintext private keys.
- A new device cannot silently impersonate an existing verified device.
- Lost keys and recovery failure are explained clearly to users.
- Old plaintext messages are visibly identified as legacy; no claim that they were retroactively encrypted.
- Security review and multi-device testing are completed before enabling it for users.

## Important constraints
- Do not implement a homemade static shared key, hard-coded key, password-derived shared key, or key stored in Firestore.
- Do not call a Web Crypto demo or a local-only simulation production E2EE.
- Do not claim Signal-level security unless the selected protocol and its full lifecycle are correctly implemented and independently reviewed.
- Firebase Spark provides no-cost quotas for several products, but Cloud Functions are not available for new deployments on Spark. Confirm hosting, homeserver, and any backend costs before selecting the design:
  https://firebase.google.com/docs/projects/billing/firebase-pricing-plans

## Rollout rule
No changes to `auth.js`, `firestore.rules`, or live chat message schema until the architecture is selected and the isolated prototype passes its acceptance tests.
