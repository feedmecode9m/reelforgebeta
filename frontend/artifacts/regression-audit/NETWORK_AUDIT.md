# Network Audit

Captured browser network during drag/drop + Accept forensic run.

## Upload/Media requests

| URL | Method | Status | Content-Type | Bytes |
|---|---|---:|---|---:|
| `http://127.0.0.1:5173/api/reels` | `POST` | 202 | `application/json` | 292 |
| `http://127.0.0.1:5173/api/reels/a1645728-5f41-4ec1-9e00-0cee50a2f019` | `GET` | 200 | `application/json` | 542 |
| `http://localhost:8080/thumbs/a1645728-5f41-4ec1-9e00-0cee50a2f019.png` | `GET` | 200 | `image/png` | 68 |
| `http://127.0.0.1:5173/api/reels` | `POST` | 202 | `application/json` | 227 |
| `http://127.0.0.1:5173/api/reels/174e30c6-a0a4-4c48-809f-9137ff1a8f71` | `GET` | 200 | `application/json` | 404 |
| `http://localhost:8080/videos/hero-background.mp4` | `GET` | 200 | `video/mp4` | 6903 |
| `http://localhost:8080/videos/hero-background.mp4` | `HEAD` | 200 | `video/mp4` | 6903 |
| `http://127.0.0.1:5173/videos/hero-background.mp4` | `GET` | 200 | `video/mp4` | 6903 |
| `http://127.0.0.1:5173/api/reels?t=1781397649067` | `GET` | 200 | `application/json` | 4833 |

## Key observations

- Upload transport is healthy (`POST /api/reels` returns `202` for both image and video).
- Static media fetches are healthy (`/thumbs/*`, `/videos/*` return `200` and expected MIME).
- No network-level evidence of failed uploads or missing media files.
- Regression is application-state/render mapping, not HTTP transport failure.
