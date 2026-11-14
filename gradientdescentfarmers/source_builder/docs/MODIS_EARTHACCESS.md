# MODIS NASA Earthdata / `earthaccess` — Guanajuato

The ORNL REST `/bands` endpoints timed out on the local network. This alternate
data path uses NASA CMR and **LP DAAC**, via `earthaccess` (not Earth Engine).
The source is explicitly configured as `modis_provider: earthaccess`.

## Scientific method

1. CMR spatial/temporal search for MOD13Q1.061, MOD11A2.061 and MOD16A2GF.061.
2. Download native HDF4 granules with `earthaccess` into
   `data/cache/earthdata/modis/<product>/recovery/attempt-*/`. Cache validation
   uses GDAL/rasterio HDF4 subdatasets; originals are never overwritten.
3. Project longitude/latitude (20.4243195, -101.1466639) to each native
   MODIS sinusoidal raster CRS and sample the containing grid cell.
4. Preserve the **raw integer science bands AND QA bands**. Run the same
   `standardize_mod13`, `standardize_mod11`, `standardize_mod16` logic as
   the existing ORNL provider (native scales, bits, masked variables).
5. Export original file names, source, QA validation, units and run manifest.

**Important:** `earthaccess` is a CMR/search/download library, not an HDF4
raster reader. Native HDF4 sampling additionally needs **rasterio with HDF4
GDAL support**; not all `pip` wheels include the HDF4 driver.
Verify `gdalinfo --formats | grep -i hdf4` before a large download.
A missing HDF4 driver is an environment error, not a failed science observation.

## Pilot

Install as for SourceBuilder and run:

```bash
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_modis_earthaccess.json \
  --run
```

This pilot limits each product to **2 granules** so it is NOT a
two-year complete MODIS series. `build_state` is expected to be partial
when a bounded query returns usable observations, even if QA passes.
Increase `modis_max_granules` only after validating file format, raw
bands, QA flags and the spatial sample. Full 2024–2025 products can involve
dozens of tiles per product and considerable download size.

For concurrent Earthdata GPM/SMAP errors inspect:
`data/guanajuato_smoke/guanajuato_valle_demo/runs/5508cf72d72d40f4/availability.json`.
The top-level `build_state=failed` alone cannot identify search,
authentication, HDF5 download or extraction errors.
