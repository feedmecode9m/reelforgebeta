# ReelForge Project State

## Current Status
- Rust 1.96.0 active
- Cargo 1.96.0 active
- Backend Actix server
- Frontend Svelte/Vite

## Media Architecture
Frontend -> Backend (8080)

Media:
- /videos/*
- /thumbs/*

Backend source:
backend/public/videos
backend/public/thumbs

## Known Fixed
- Relative media URL bug
- Vite-origin media requests
- Dist ownership issue
- Rust toolchain mismatch

## Current Validation Tasks
- Runtime playback verification
- Theater mode validation
- Thumbnail validation
- Watch tracking validation

## Startup Commands

Backend:
cargo run

Frontend:
npm run dev

## Key Files

Viewer.svelte
handlers.rs
db.rs
main.rs

platformConfig.js
platformConfigStore.js
PlatformConfigPanel.svelte
