# Backend Validation: Magic Bytes

## JPEG Check
header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF

## MP4 Check
header[4..8] == "ftyp"
