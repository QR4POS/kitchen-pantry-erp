// ============================================================
// LOCATION NORMALIZATION
// Extracts town, district and province from free-text Sri Lankan
// locations. Used to apply the Western Province service-area rule.
// ============================================================

export interface NormalizedLocation {
  town: string | null
  district: string | null
  province: string | null
  insideWesternProvince: boolean
}

const WESTERN_PROVINCE_DISTRICTS = new Set([
  'colombo',
  'gampaha',
  'kalutara',
])

const PROVINCE_BY_DISTRICT: Record<string, string> = {
  // Western
  colombo: 'Western',
  gampaha: 'Western',
  kalutara: 'Western',
  // Central
  kandy: 'Central',
  matale: 'Central',
  'nuwara eliya': 'Central',
  // Southern
  galle: 'Southern',
  matara: 'Southern',
  hambantota: 'Southern',
  // Northern
  jaffna: 'Northern',
  kilinochchi: 'Northern',
  mannar: 'Northern',
  vavuniya: 'Northern',
  mullaitivu: 'Northern',
  // Eastern
  trincomalee: 'Eastern',
  batticaloa: 'Eastern',
  ampara: 'Eastern',
  // North Western
  kurunegala: 'North Western',
  puttalam: 'North Western',
  // North Central
  anuradhapura: 'North Central',
  polonnaruwa: 'North Central',
  // Uva
  badulla: 'Uva',
  monaragala: 'Uva',
  // Sabaragamuwa
  ratnapura: 'Sabaragamuwa',
  kegalle: 'Sabaragamuwa',
}

const DISTRICT_BY_TOWN: Record<string, string> = {
  // Colombo district
  colombo: 'Colombo',
  dehiwala: 'Colombo',
  'mount lavinia': 'Colombo',
  moratuwa: 'Colombo',
  nugegoda: 'Colombo',
  kotte: 'Colombo',
  'sri jayawardenepura': 'Colombo',
  maharagama: 'Colombo',
  boralesgamuwa: 'Colombo',
  piliyandala: 'Colombo',
  homagama: 'Colombo',
  avissawella: 'Colombo',
  kaduwela: 'Colombo',
  battaramulla: 'Colombo',
  rajagiriya: 'Colombo',
  wellampitiya: 'Colombo',
  kelaniya: 'Colombo',
  wattala: 'Colombo',
  negombo: 'Gampaha',
  gampaha: 'Gampaha',
  'ja ela': 'Gampaha',
  seeduwa: 'Gampaha',
  minuwangoda: 'Gampaha',
  divulapitiya: 'Gampaha',
  mirigama: 'Gampaha',
  panadura: 'Kalutara',
  kalutara: 'Kalutara',
  horana: 'Kalutara',
  bandaragama: 'Kalutara',
  matugama: 'Kalutara',
  aluthgama: 'Kalutara',
  beruwala: 'Kalutara',
  // Other common towns
  kandy: 'Kandy',
  matale: 'Matale',
  galle: 'Galle',
  matara: 'Matara',
  kurunegala: 'Kurunegala',
  anuradhapura: 'Anuradhapura',
  jaffna: 'Jaffna',
  trincomalee: 'Trincomalee',
  batticaloa: 'Batticaloa',
  badulla: 'Badulla',
  ratnapura: 'Ratnapura',
  puttalam: 'Puttalam',
  kegalle: 'Kegalle',
  ampara: 'Ampara',
  polonnaruwa: 'Polonnaruwa',
}

function normalizeInput(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(text: string): string {
  return text
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function normalizeLocation(raw: string | null | undefined): NormalizedLocation {
  if (!raw || typeof raw !== 'string') {
    return { town: null, district: null, province: null, insideWesternProvince: false }
  }

  const normalized = normalizeInput(raw)
  if (!normalized) {
    return { town: null, district: null, province: null, insideWesternProvince: false }
  }

  // Try to find a town match first
  let town: string | null = null
  let district: string | null = null

  for (const [townKey, districtName] of Object.entries(DISTRICT_BY_TOWN)) {
    if (normalized.includes(townKey)) {
      town = titleCase(townKey)
      district = districtName
      break
    }
  }

  // If no town match, try district match
  if (!district) {
    for (const districtKey of Object.keys(PROVINCE_BY_DISTRICT)) {
      if (normalized.includes(districtKey)) {
        district = titleCase(districtKey)
        break
      }
    }
  }

  // Explicit province hint (e.g. "Western Province")
  if (!district && /western\s*province/.test(normalized)) {
    district = 'Colombo'
  }

  // Derive province from district
  const province = district ? PROVINCE_BY_DISTRICT[district.toLowerCase()] ?? null : null
  const insideWesternProvince = district
    ? WESTERN_PROVINCE_DISTRICTS.has(district.toLowerCase())
    : false

  return { town, district, province, insideWesternProvince }
}

export function isInsideWesternProvince(raw: string | null | undefined): boolean {
  return normalizeLocation(raw).insideWesternProvince
}
