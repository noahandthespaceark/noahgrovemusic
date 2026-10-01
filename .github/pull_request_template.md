## AI capability review
Describe whether this change adds, changes, or removes an action that an assistant should control.

Required marker for the AI capability CI check:
`AI_CAPABILITY_REVIEW: UPDATED — <Hub mapping or ledger change>`
`AI_CAPABILITY_REVIEW: COVERED — <existing capability that covers this change>`
`AI_CAPABILITY_REVIEW: GAP — <uncovered action and where it is recorded>`

Also refresh source fingerprints when any tracked app source changes:
`node scripts/ai-capability-surface.mjs --write`
