# Third-party notices

The application uses MediaPipe Tasks Vision version 0.10.32, distributed by Google under the Apache License 2.0. Its bundled legal notices are retained in the compiled worker.

A full copy of the applicable third-party license is included in [licenses/Apache-2.0.txt](./licenses/Apache-2.0.txt). The deployed site includes `vendor/Apache-2.0.txt` and `vendor/THIRD_PARTY_NOTICES.txt` alongside the distributed components. This notice identifies the third-party component's license; it does not by itself assign that license to independent application code.

- Project: https://github.com/google-ai-edge/mediapipe
- Package: https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.32
- Face Landmarker documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Versioned model source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

The model is fetched from Google's published MediaPipe model distribution during the build. Model provenance and applicable conditions should be rechecked before using this prototype as a commercial production system. No model training or evaluation claims are made by this repository.

Vite, TypeScript, esbuild, Vitest, Playwright and marked are development dependencies. Their applicable license texts are distributed with the respective packages and remain subject to those licenses.

The `assignment/images` and `assignment/previews` directories contain the assessment references supplied by the user. On 2026-10-15 the submitting user explicitly confirmed authorization for public redistribution. These images are not claimed as original application artwork, and the Apache license for MediaPipe does not license those images. The source-number mapping and SHA-256 hashes are preserved in `assignment/image-manifest.json`; signed download URLs are not distributed. Further commercial uses may require separate permissions and context-specific review.
