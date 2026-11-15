# Isolated parser fixtures

- `text.docx`: unchanged `mammoth@1.13.0/test/test-data/single-paragraph.docx`.
- `image.docx`: unchanged `mammoth@1.13.0/test/test-data/tiny-picture.docx`.
- The two DOCX fixtures retain Mammoth's BSD-2-Clause copyright/license in `MAMMOTH-LICENSE.txt`. Source: https://github.com/mwilliamson/mammoth.js/tree/1.13.0/test/test-data . No framework application source was copied.
- `text.pdf`, `scan.pdf`, `sheets.xlsx`, `image.png` are generated synthetic, non-customer test materials. The PDF scan contains an actual embedded RGB raster with no text layer. The workbook has two worksheets, Chinese labels and separate row/cell positions. They contain no platform data or credentials.

These files exercise installed real parsers, not OCR semantic quality. Model tests use deterministic local responses and do not claim provider recognition accuracy.
