# Upload Call Count Audit

## Instrumentation

- Runtime instrumentation wrapped `window.fetch` and emitted:
  - `[UPLOAD_START]`
  - `[UPLOAD_COMPLETE]`
- Scope for count: `POST /api/reels` per single user drop/accept cycle.

## Result (single upload)

- Thumbnail upload (single drop + single accept):
  - `[UPLOAD_START]` count: `1`
  - `[UPLOAD_COMPLETE]` count: `1`

- Video upload (single drop):
  - `[UPLOAD_START]` count: `1`
  - `[UPLOAD_COMPLETE]` count: `1`

## Multi-format validation run

- `jpg`: `deltaStart=1`, `deltaComplete=1`
- `png`: `deltaStart=1`, `deltaComplete=1`
- `webp`: `deltaStart=1`, `deltaComplete=1`
- `gif`: `deltaStart=1`, `deltaComplete=1`
- `mp4`: `deltaStart=1`, `deltaComplete=1`

## Conclusion

- Upload API call count is not duplicated at transport layer.
- Duplication was downstream in state hydration/merge logic.
