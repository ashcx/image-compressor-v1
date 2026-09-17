# HEIC quality + speed codec build

The prebuilt `elheif` npm package only exposes a fixed encoder quality and no
speed control. To expose presets in the app we build a patched WASM codec.

## What the patches change

- **libheif** (`libheif-kvazaar-preset.patch`): the kvazaar encoder plugin gains
  a `preset` string parameter. It is applied with
  `kvz_config_parse(config, "preset", value)` after `config_init`, using
  kvazaar's own preset table.
- **elheif** (`elheif-quality-preset.patch`): the encoder wrapper takes a
  `quality` (0-100) and `preset` argument and forwards them to
  `heif_encoder_set_lossy_quality` / `heif_encoder_set_parameter_string`.

The generated package lives in `vendor/elheif` and is wired in through
`"elheif": "file:vendor/elheif"`.

## Rebuild

See `build.sh`. It pins kvazaar `v2.3.1`, libde265 `v1.0.15`, libheif
`v1.18.2`, and Emscripten `3.1.60`. Use CMake 3.29 (CMake 4 rejects the
dependencies' older `cmake_minimum_required`).

## Presets

kvazaar presets, fastest to slowest: `ultrafast`, `superfast`, `veryfast`,
`faster`, `fast`, `medium`, `slow`, `slower`, `veryslow`, `placebo`.

The app maps three UI options (`src/lib/codecs/heic.ts`):

| UI | Preset | Notes |
| --- | --- | --- |
| Fast | `ultrafast` | quickest, slightly larger output |
| Balanced (default) | `faster` | good speed/size balance |
| Smaller | `slow` | smallest output, slowest |

Measured on a 512×512 sample (Emscripten, single-threaded): `ultrafast`
~60–80 ms vs `medium` ~145–175 ms, at similar PSNR.
