# Build Commands

## macOS

```bash
# Build and package for macOS (arm64)
npm run build:mac

# Output files:
#   release/typetype-0.1.0-arm64.dmg
#   release/typetype-0.1.0-arm64-mac.zip
```

## Windows

```bash
# Build TypeScript first
npm run build:electron

# Package for Windows x64 (portable + installer)
npx electron-builder --win --x64

# Output files:
#   release/typetype 0.1.0.exe        (portable)
#   release/typetype Setup 0.1.0.exe  (installer)
```

## Notes

- `npm run build:win` uses the host machine architecture (arm64 on Apple Silicon), which produces arm64 Windows builds
- Use `npx electron-builder --win --x64` to explicitly build Windows x64 from any host
- Build artifacts are in the `release/` directory
