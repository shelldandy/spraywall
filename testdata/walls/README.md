# Wall photo fixtures

Real spray wall photos for exercising image upload, HEIC conversion and hold detection.
They're shared by server, worker and web tests.

| File          | Format | Size       | Notes                                   |
| ------------- | ------ | ---------- | --------------------------------------- |
| `wall-1.heic` | HEIC   | 4284×5712  | iPhone photo, straight-on, dense holds  |
| `wall-2.heic` | HEIC   | 4284×5712  | iPhone photo, angled, overhang          |

Both are untouched iPhone originals, so they cover the HEIC path: browsers other than Safari can't
decode them, and the server converts them to JPEG on upload.
