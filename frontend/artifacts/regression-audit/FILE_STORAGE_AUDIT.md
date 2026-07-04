# File Storage Audit

## Uploaded forensic files

- Image upload (drag/drop + Accept):
  - `file.name`: `audit-1781397640096.png`
  - `file.type`: `image/png`
  - `file.size`: `68`

- Video upload (drag/drop):
  - `file.name`: `audit-1781397645483.mp4`
  - `file.type`: `video/mp4`
  - `file.size`: `6903`

## Physical file verification

Verified on disk after upload:

- `backend/public/videos/174e30c6-a0a4-4c48-809f-9137ff1a8f71.mp4` (`6903` bytes, regular file)
- `backend/public/thumbs/174e30c6-a0a4-4c48-809f-9137ff1a8f71.jpg` (`5620` bytes, regular file)
- `backend/public/thumbs/a1645728-5f41-4ec1-9e00-0cee50a2f019.png` (`68` bytes, regular file)

## Directory audit

Checked directories:

- `backend/public/videos` -> present and contains uploaded video
- `backend/public/thumbs` -> present and contains uploaded image and generated video thumbnail
- `backend/public/uploads` -> not present / not used in this pipeline
- `backend/storage` -> not present / not used in this pipeline

## Conclusion

- Backend file persistence is working.
- Regression is not from missing disk writes; break occurs in frontend response-to-store/render handling.
