# postcode-districts.json — source and method

## Dataset
- **Name:** ONS Postcode Directory (ONSPD), August 2026 edition, United Kingdom (`ONSPD_AUG_2026.zip`, file `Data/ONSPD_AUG_2026_UK.csv`)
- **Publisher:** Office for National Statistics (ONS Geography), ONS Open Geography Portal (ArcGIS item `9e5a92a3cfb14dc7ad43d6ea7a7b8c7f`, header row corrected 07/09/2026)
- **Item page:** https://www.arcgis.com/home/item.html?id=9e5a92a3cfb14dc7ad43d6ea7a7b8c7f (also listed on https://geoportal.statistics.gov.uk)
- **Download URL:** https://www.arcgis.com/sharing/rest/content/items/9e5a92a3cfb14dc7ad43d6ea7a7b8c7f/data (253,928,895 bytes, SHA-256 `ab51f1e82bd5beeb1089c3732ea6e11d62eb5693d619e2c4f4dd8c4baaa69293`), downloaded 28 Oct 2026
- **Licence (as linked from the item):** https://www.ons.gov.uk/methodology/geography/licences, Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)

## Required attribution
The ONS licences page, section "Postcode products (including postcode lookups)", says these statements "must be acknowledged or displayed whenever the owners data is used":

```
Contains OS data © Crown copyright and database right 2026
Contains Royal Mail data © Royal Mail copyright and database right 2026
Source: Office for National Statistics licensed under the Open Government Licence v.3.0
```
(The source gives the year as `[year]`. 2026 is used because this is the August 2026 edition.)

## Northern Ireland exclusion
The same page states: "If you also use the Northern Ireland data (postcodes starting with “BT”), you need a separate licence for commercial use direct from Land and Property Services." It also says reuse is free "not including logos or Northern Ireland data". So **all BT districts are excluded**, and the file contains only OGL-covered data (GB). The Crown Dependencies (GY, JE, IM) have no coordinates in ONSPD and are excluded automatically.

## Method (`scripts/build.py`)
1. Read every row of `ONSPD_AUG_2026_UK.csv` (2,729,090 postcodes).
2. Keep **live** postcodes only (`doterm` empty): 1,810,364 rows.
3. Drop BT postcodes (50,148).
4. Drop postcodes with no valid coordinates (`lat` 99.999999, or outside the GB bounding box): 11,986. These are mostly GY/JE/IM, plus some non-geographic districts such as BN91, CH90, EN77, GIR, LS78 and IM99.
5. Take the outward code from `pcds` (the part before the space). The district centroid is the arithmetic mean of `lat`/`long` (WGS84) across the 1,748,230 remaining postcodes.
6. Round to 3 decimal places (about 110 m of latitude). Keys are upper-case with no spaces and sorted. The JSON is compact.

Rebuild with: `python3 -I scripts/build.py <ONSPD_..._UK.csv> postcode-districts.json`

## Output
- `postcode-districts.json`: **2,863 districts**, **63,575 bytes**, SHA-256 `3ddd4fdcfe6af713f3893a1bcb8a16e44c013f9b3fd2fae5183e62a1f76acef2`
- Format: `{"AB10":[57.135,-2.121], ...}`, i.e. `[lat, lng]`

## Sanity checks
| District | Centroid | Known location | Result |
|---|---|---|---|
| MK3 | 51.993, -0.752 | Bletchley, Milton Keynes (about 51.99, -0.74) | OK |
| SW1A | 51.505, -0.132 | Westminster/Whitehall (Downing St 51.503, -0.128) | OK |
| EH1 | 55.951, -3.193 | Edinburgh Old Town / Princes St (55.951, -3.19) | OK |

Other spot checks: NG1 52.955,-1.148 (Nottingham centre); M1 53.478,-2.236 (Manchester centre); CF10 51.475,-3.173 (Cardiff centre); ZE2 60.311,-1.227 (Shetland); TR21 49.919,-6.299 (Isles of Scilly).

## Caveats
- A centroid is the mean of postcode points, not of the district's area. It is weighted toward where the delivery points are.
- Some districts that are mostly non-geographic (large-user codes such as W1A, at 51.524,-0.113) still have coordinates from their geographic postcodes, so their centroid may not sit on the famous address.
