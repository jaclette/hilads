// "Different Worlds" ranking card (src/Reaction.jsx): each country's main flag color, for its podium block and its bar.
// Keyed by ISO 3166-1 alpha-2 (read from the flag emoji); a white or very pale main color is replaced by the flag's
// strongest other color. Unknown flags: Hilads orange (FALLBACK). Pure.

export const FALLBACK = '#F2783A';

const COLORS = {
  AD: '#10069F', AE: '#00843D', AF: '#000000', AG: '#CE1126', AI: '#012169', AL: '#E41E20', AM: '#D90012', AO: '#CC092F',
  AR: '#6CACE4', AT: '#C8102E', AU: '#012169', AW: '#418FDE', AZ: '#0092BC', BA: '#002395', BB: '#00267F', BD: '#006A4E',
  BE: '#E8112D', BF: '#EF2B2D', BG: '#00966E', BH: '#CE1126', BI: '#CE1126', BJ: '#008751', BM: '#C8102E', BN: '#2D2A26',
  BO: '#007A33', BR: '#009C3B', BS: '#00778B', BT: '#FF4E12', BW: '#75AADB', BY: '#C8313E', BZ: '#003F87', CA: '#D52B1E',
  CD: '#007FFF', CF: '#003082', CG: '#009543', CH: '#DA291C', CI: '#F77F00', CK: '#012169', CL: '#0039A6', CM: '#007A5E',
  CN: '#DE2910', CO: '#003893', CR: '#002B7F', CU: '#002A8F', CV: '#003893', CW: '#002B7F', CY: '#D57800', CZ: '#11457E',
  DE: '#DD0000', DJ: '#6AB2E7', DK: '#C8102E', DM: '#006B3F', DO: '#002D62', DZ: '#006233', EC: '#034EA2', EE: '#0072CE',
  EG: '#CE1126', ES: '#AA151B', ET: '#078930', EU: '#003399', FI: '#003580', FJ: '#68BFE5', FR: '#0055A4', GA: '#009E60',
  GB: '#012169', GD: '#CE1126', GE: '#E8112D', GH: '#006B3F', GM: '#3A7728', GN: '#CE1126', GQ: '#3E9A00', GR: '#0D5EAF',
  GT: '#4997D0', GU: '#002868', GY: '#009E49', HK: '#DE2910', HN: '#0073CF', HR: '#171796', HT: '#00209F', HU: '#CD2A3E',
  ID: '#CE1126', IE: '#169B62', IL: '#0038B8', IN: '#FF9933', IQ: '#CE1126', IR: '#239F40', IS: '#02529C', IT: '#009246',
  JM: '#009B3A', JO: '#007A3D', JP: '#BC002D', KE: '#006600', KG: '#E8112D', KH: '#032EA1', KM: '#3A75C4', KN: '#009E49',
  KR: '#003478', KW: '#007A3D', KY: '#012169', KZ: '#00AFCA', LA: '#002868', LB: '#ED1C24', LC: '#66CCFF', LI: '#002B7F',
  LK: '#8D153A', LR: '#BF0A30', LS: '#00209F', LT: '#006A44', LU: '#00A1DE', LV: '#9E3039', LY: '#239E46', MA: '#C1272D',
  MC: '#CE1126', MD: '#0046AE', ME: '#C40308', MG: '#FC3D32', MK: '#D20000', ML: '#14B53A', MM: '#34B233', MN: '#C4272F',
  MO: '#00785E', MP: '#0071BC', MT: '#CF142B', MU: '#EA2839', MV: '#D21034', MW: '#CE1126', MX: '#006847', MY: '#010066',
  MZ: '#007168', NA: '#003580', NE: '#E05206', NG: '#008751', NI: '#0067C6', NL: '#AE1C28', NO: '#BA0C2F', NP: '#DC143C',
  NU: '#C9A400', NZ: '#012169', OM: '#DB161B', PA: '#005293', PE: '#D91023', PG: '#CE1126', PH: '#0038A8', PK: '#01411C',
  PL: '#DC143C', PR: '#ED0000', PS: '#007A3D', PT: '#006600', PW: '#4AADD6', PY: '#D52B1E', QA: '#8A1538', RO: '#002B7F',
  RS: '#C6363C', RU: '#0039A6', RW: '#00A1DE', SA: '#006C35', SB: '#0051BA', SC: '#003F87', SD: '#007229', SE: '#006AA7',
  SG: '#EF3340', SI: '#005DA4', SK: '#0B4EA2', SL: '#1EB53A', SN: '#00853F', SO: '#4189DD', SR: '#377E3F', SS: '#078930',
  SV: '#0047AB', SX: '#002B7F', SY: '#CE1126', TC: '#012169', TD: '#002664', TG: '#006A4E', TH: '#2D2A85', TJ: '#CC0000',
  TL: '#DC241F', TM: '#00843D', TN: '#E70013', TO: '#C10000', TR: '#E30A17', TT: '#CE1126', TW: '#000095', TZ: '#1EB53A',
  UA: '#0057B7', UG: '#D90000', US: '#B22234', UY: '#0038A8', UZ: '#0099B5', VC: '#009E60', VE: '#CF142B', VG: '#012169',
  VI: '#002868', VN: '#DA251D', VU: '#D21034', WS: '#CE1126', XK: '#244AA5', YE: '#CE1126', ZA: '#007A4D', ZM: '#198A00',
  ZW: '#006400',
};

/** ISO code of a flag emoji (🇻🇳 → VN); null when it isn't two regional indicators. */
export function flagIso(flag) {
  const letters = [...String(flag ?? '')].map((ch) => ch.codePointAt(0)).filter((cp) => cp >= 0x1F1E6 && cp <= 0x1F1FF);
  return letters.length === 2 ? String.fromCharCode(...letters.map((cp) => cp - 0x1F1E6 + 65)) : null;
}

/** The country's main flag color (hex), FALLBACK when unknown. */
export const flagColor = (flag) => COLORS[flagIso(flag)] ?? FALLBACK;
