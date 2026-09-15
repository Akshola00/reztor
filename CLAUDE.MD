# Reztor

Three independent packages. No workspace, no shared node_modules,
no hoisting. Each installs and builds on its own.

- mobile/    Expo app (React Native)
- server/    authoritative game server — see server/CLAUDE.md
- contracts/ Anchor program (not yet built)
- docs/      reztor-spec.md, shared by all three

Work in one package at a time. Never install a dependency from the
repo root. If a task seems to need changes in two packages, stop and
say so first.