import type { AirportReference } from './contracts.js';

const AIRPORT_CODES = new Map<string, string>([
  ['beijing', 'PEK'],
  ['beijing-capital', 'PEK'],
  ['chengdu', 'TFU'],
  ['hangzhou', 'HGH'],
  ['kaohsiung', 'KHH'],
  ['macau', 'MFM'],
  ['nanjing', 'NKG'],
  ['ningbo', 'NGB'],
  ['seoul-incheon', 'ICN'],
  ['shanghai-pudong', 'PVG'],
  ['tokyo-narita', 'NRT'],
  ['xiamen', 'XMN'],
]);

function dictionaryKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

export function resolveAirport(name: string): AirportReference {
  const normalizedName = name.trim();
  return {
    code: AIRPORT_CODES.get(dictionaryKey(normalizedName)) ?? null,
    name: normalizedName,
  };
}

export const MACAU_AIRPORT: AirportReference = {
  code: 'MFM',
  name: 'Macau',
};
