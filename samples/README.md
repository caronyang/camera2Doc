# samples/

Non-sensitive test photos for CI and documentation.

**Do not put personal data here** — everything in this folder is committed to a public repository
and used by the iOS algorithm verification job (`.github/workflows/ios.yml`) as well as by the local
verifier:

```bash
swiftc -O tools/ios-verify/main.swift modules/camera2doc/ios/ScannerAlgorithms.swift -o verify
./verify samples ci-out/out_samples
```

Private photos (IDs, contracts, anything with names/addresses/numbers) belong in `TEST_IMAGE/`,
which is git-ignored and never pushed.

Suggested content for a good sample set:

| Sample | Why |
|---|---|
| A4 printed page, shot at a slight angle | corner detection + warp + deskew |
| A page with colored headings/logo or a colored stamp | color fidelity (original tone) |
| A page shot with uneven lighting (one side dark, or a hand shadow) | background whitening / shadow flattening |
