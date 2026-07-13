# MISSION 5.5 — Canonical Thumbnail Identity Validation

Generated: 2026-07-13T06:30:59.370Z

## Result: PASS

| Check | Result |
|-------|--------|
| Restart backend | PASS |
| Restart frontend | PASS |
| Upload 5 UUID thumbnails visible | PASS |
| Survive reload | PASS |
| Survive sync | PASS |
| naturalWidth > 0 | PASS |
| Canonical metadata (id/fileName/url) | PASS |
| No /thumbs/display-name requests | PASS |
| Zero vault thumb 404s | PASS |

## Pipeline trace (first mission-55 entry per stage)

Lookup order enforced: **id → fileName → url** (never name).

| Stage | id | name | fileName | url | thumbnail | thumbnailUrl | Field changes |
|-------|-----|------|----------|-----|-----------|--------------|---------------|
| after-upload | ce422daf-8878-40bb-a6a0-2d75522ce4fa | mission-55-thumb-5.png | ce422daf-8878-40bb-a6a0-2d75522ce4fa.png | /thumbs/ce422daf-8878-40bb-a6a0-2d75522ce4fa.png | — | — | id:set, name:set, fileName:set, url:set |
| after-reload | ce422daf-8878-40bb-a6a0-2d75522ce4fa | mission-55-thumb-5.png | ce422daf-8878-40bb-a6a0-2d75522ce4fa.png | /thumbs/ce422daf-8878-40bb-a6a0-2d75522ce4fa.png | — | — | stable |
| after-sync | ce422daf-8878-40bb-a6a0-2d75522ce4fa | mission-55-thumb-5.png | ce422daf-8878-40bb-a6a0-2d75522ce4fa.png | /thumbs/ce422daf-8878-40bb-a6a0-2d75522ce4fa.png | — | — | stable |

## Metadata sample (after sync)

```json
[
  {
    "id": "ce422daf-8878-40bb-a6a0-2d75522ce4fa",
    "name": "mission-55-thumb-5.png",
    "fileName": "ce422daf-8878-40bb-a6a0-2d75522ce4fa.png",
    "url": "/thumbs/ce422daf-8878-40bb-a6a0-2d75522ce4fa.png",
    "thumbnail": null,
    "thumbnailUrl": null
  },
  {
    "id": "83042792-b2f8-4331-8cbe-82d031badc19",
    "name": "mission-55-thumb-4.png",
    "fileName": "83042792-b2f8-4331-8cbe-82d031badc19.png",
    "url": "/thumbs/83042792-b2f8-4331-8cbe-82d031badc19.png",
    "thumbnail": null,
    "thumbnailUrl": null
  },
  {
    "id": "12502004-9d60-43e0-9016-fcb80c0508ca",
    "name": "mission-55-thumb-3.png",
    "fileName": "12502004-9d60-43e0-9016-fcb80c0508ca.png",
    "url": "/thumbs/12502004-9d60-43e0-9016-fcb80c0508ca.png",
    "thumbnail": null,
    "thumbnailUrl": null
  },
  {
    "id": "77b6e085-d2db-41df-a8e8-d9eb999ee1cb",
    "name": "mission-55-thumb-2.png",
    "fileName": "77b6e085-d2db-41df-a8e8-d9eb999ee1cb.png",
    "url": "/thumbs/77b6e085-d2db-41df-a8e8-d9eb999ee1cb.png",
    "thumbnail": null,
    "thumbnailUrl": null
  },
  {
    "id": "a708a87c-ae07-45c5-a7cc-c6f6f4c5e15e",
    "name": "mission-55-thumb-1.png",
    "fileName": "a708a87c-ae07-45c5-a7cc-c6f6f4c5e15e.png",
    "url": "/thumbs/a708a87c-ae07-45c5-a7cc-c6f6f4c5e15e.png",
    "thumbnail": null,
    "thumbnailUrl": null
  }
]
```

## Card sources (after reload)

```json
[
  {
    "i": 0,
    "nw": 1,
    "src": "http://127.0.0.1:5173/thumbs/ce422daf-8878-40bb-a6a0-2d75522ce4fa.png"
  },
  {
    "i": 1,
    "nw": 1,
    "src": "http://127.0.0.1:5173/thumbs/83042792-b2f8-4331-8cbe-82d031badc19.png"
  },
  {
    "i": 2,
    "nw": 1,
    "src": "http://127.0.0.1:5173/thumbs/12502004-9d60-43e0-9016-fcb80c0508ca.png"
  },
  {
    "i": 3,
    "nw": 1,
    "src": "http://127.0.0.1:5173/thumbs/77b6e085-d2db-41df-a8e8-d9eb999ee1cb.png"
  },
  {
    "i": 4,
    "nw": 1,
    "src": "http://127.0.0.1:5173/thumbs/a708a87c-ae07-45c5-a7cc-c6f6f4c5e15e.png"
  }
]
```

## Errors

None

## Network violations (vault scope)

None

## Ignored out-of-scope 404s (hero legacy, not thumbnail vault)

- 404:http://127.0.0.1:5173/thumbs/IMG_0113.JPEG
