// The spec's example license.md (docs/adr/0035), for the tests.
export const VALID_LICENSE = `---
free:
  title: Free
  price: "0"
  note: Every feed starts here.
  features:
    - { text: "The newest {cap} notes are kept" }
    - { text: No images, included: false }
    - { text: No feed password, included: false }
plans:
  badge: Per feed
  note: For one feed at a time; the key can move.
  features:
    - { text: All notes are kept }
    - { text: Images }
    - { text: A feed password }
  button: Subscribe
fineprint: A subscription renews until you cancel it. See the [terms](/terms).
---
A license lifts the free tier's limits for one feed. Reading a feed is always free, and there are no accounts: the license is a key you keep.
`;
