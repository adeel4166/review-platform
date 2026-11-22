# Media fixtures

`generate.ts` builds every malicious/edge-case media file in memory (EICAR, image bombs, polyglots, GPS/XMP metadata, videos).
Nothing binary is committed. Used by `apps/worker/src/media-pipeline.test.ts` (MED-*, INF-003) and `media-publish.test.ts` (MED-037).
Video fixtures need `ffmpeg`; those tests are skipped when it is absent. EICAR is the harmless standard AV test string.
