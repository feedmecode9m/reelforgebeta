# Backend Routes: Static File Serving

## Fix
.service(Files::new("/videos", "./public/videos"))
.service(Files::new("/thumbs", "./public/thumbs"))

## Verify
curl -I http://localhost:8080/thumbs/IMG_0122.JPEG
# Expected: HTTP/1.1 200 OK
