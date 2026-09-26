# Real test photos

Photos of physical pregnancy tests the team bought and took, used to measure and calibrate
`lines.py`. Label each photo from the physical test, either in `labels.json`
(`{"IMG_0001.jpg": "negative"}`) or with a filename prefix (`negative_01.jpg`).

Never add synthetic, generated or downloaded images. Strip location metadata before
committing (`exiftool -gps:all= -overwrite_original *.jpg`).

Run with output: `pytest -q -s tests/test_real_photos.py`
