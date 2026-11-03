# Vendored libraries

Everything here is served from our own origin. The site makes no requests to third-party hosts.

## `model-viewer.min.js`

| | |
| --- | --- |
| Library | [`@google/model-viewer`](https://github.com/google/model-viewer) |
| Version | 4.4.0 (npm package `@google/model-viewer@4.4.0`, file `dist/model-viewer.min.js`, unmodified) |
| SHA-256 | `18b2e711035aa4705ee281530a55dc2338ff05eed3d70ae16d54105282a75ed5` |
| Size | 1 069 272 bytes (about 1.0 MB); 288 592 bytes with `gzip -9` |
| License | Apache-2.0, full text in `LICENSE-model-viewer.txt` |

The bundle also contains Three.js (MIT), Lit (BSD-3-Clause) and fflate (MIT); their notices are kept in the
file header comments. It is an ES module that registers the `<model-viewer>` custom element and exports
`ModelViewerElement`. It is loaded lazily by `assets/gallery3d.js` (dynamic `import()`), so visitors who never
see a 3D card, or who have Data Saver on, do not download it until they press a 3D button.

Verify or update:

```sh
npm pack @google/model-viewer@4.4.0 && tar -xzf google-model-viewer-4.4.0.tgz
sha256sum package/dist/model-viewer.min.js      # must match the table above
```

### Third-party hosts inside the bundle

By default the library points to `gstatic.com` (Draco and KTX2 decoders) and `jsdelivr.net` (Lottie loader).
`assets/gallery3d.js` overrides the decoder locations to local paths:

- `meshopt_decoder.js` — an intentionally empty stub (the library bundles the Meshopt decoder itself and only
  needs a same-origin script URL to wait for). Meshopt-compressed models (`gltfpack -cc`) need nothing else.
- `draco/` — Draco decoder (`draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js`).
- `ktx2/` — KTX2/Basis transcoder.

The Draco and KTX2 files are **not** included, because the procedural demo models are uncompressed and the files
add roughly 0.7 MB. Copy them here before shipping a Draco/KTX2-compressed model, otherwise that model fails to load
(the card then keeps the flat picture). Lottie is not used.
