# Frontend URL Resolution

## Rule
Use `reel.url` directly from backend. No manipulation.

## Wrong
const thumbUrl = `/thumbs/${filename}.jpg`;

## Right
<img src={reel.url} alt={reel.name} />
