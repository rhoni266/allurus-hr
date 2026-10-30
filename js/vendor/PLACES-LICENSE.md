# places-my.json

Malaysia's states, districts, and cities and towns for the Head office field (`js/places-field.js`).

**Source:** [GeoNames](https://www.geonames.org/), Malaysia extract (`MY.zip`, `admin1CodesASCII.txt`, `admin2Codes.txt` from
https://download.geonames.org/export/dump/), downloaded 30 October 2026.

**Licence:** [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). The data is provided
"as is", without warranty of accuracy or completeness.

**Changes made by Allurus:** kept only states (ADM1), districts (ADM2) and places that are a state or district seat
or have at least 1,000 people; Malay state names first (Melaka, Pulau Pinang) with English names as aliases; added
common short names (KL, JB, KK, PJ, KT, W.P., Chukai for Cukai, and so on); coordinates rounded to 4 decimals.

Rebuild with `node scripts/build-places.js <folder with the GeoNames files>`.

Attribution shown in the app: "Places: GeoNames (CC BY 4.0)".
