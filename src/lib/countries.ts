export interface RegionGroup {
  label: string;
  countries: string[];
}

export const REGION_GROUPS: RegionGroup[] = [
  {
    label: "Middle East & North Africa",
    countries: [
      "Algeria", "Bahrain", "Egypt", "Iran", "Iraq", "Jordan", "Kuwait",
      "Lebanon", "Libya", "Morocco", "Oman", "Palestine", "Qatar",
      "Saudi Arabia", "Syria", "Tunisia", "United Arab Emirates", "Yemen",
    ],
  },
  {
    label: "Sub-Saharan Africa",
    countries: [
      "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cabo Verde",
      "Cameroon", "Central African Republic", "Chad", "Comoros",
      "Côte d'Ivoire", "Democratic Republic of the Congo", "Djibouti",
      "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia", "Gabon",
      "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Kenya", "Lesotho",
      "Liberia", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius",
      "Mozambique", "Namibia", "Niger", "Nigeria", "Republic of the Congo",
      "Rwanda", "São Tomé and Príncipe", "Senegal", "Seychelles",
      "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Sudan",
      "Tanzania", "Togo", "Uganda", "Zambia", "Zimbabwe",
    ],
  },
  {
    label: "South & Southeast Asia",
    countries: [
      "Afghanistan", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "India",
      "Indonesia", "Laos", "Malaysia", "Maldives", "Myanmar", "Nepal",
      "Pakistan", "Philippines", "Singapore", "Sri Lanka", "Thailand",
      "Timor-Leste", "Vietnam",
    ],
  },
  {
    label: "Eastern Europe & Central Asia",
    countries: [
      "Albania", "Armenia", "Azerbaijan", "Belarus", "Bosnia and Herzegovina",
      "Bulgaria", "Georgia", "Kazakhstan", "Kosovo", "Kyrgyzstan", "Moldova",
      "Mongolia", "Montenegro", "North Macedonia", "Romania", "Russia",
      "Serbia", "Tajikistan", "Turkey", "Turkmenistan", "Ukraine",
      "Uzbekistan",
    ],
  },
  {
    label: "Latin America & Caribbean",
    countries: [
      "Argentina", "Belize", "Bolivia", "Brazil", "Chile", "Colombia",
      "Costa Rica", "Cuba", "Dominican Republic", "Ecuador", "El Salvador",
      "Guatemala", "Guyana", "Haiti", "Honduras", "Jamaica", "Mexico",
      "Nicaragua", "Panama", "Paraguay", "Peru", "Suriname",
      "Trinidad and Tobago", "Uruguay", "Venezuela",
    ],
  },
  {
    label: "East Asia & Pacific",
    countries: [
      "Australia", "China", "Fiji", "Japan", "Kiribati", "New Zealand",
      "Papua New Guinea", "Samoa", "Solomon Islands", "South Korea",
      "Taiwan", "Tonga", "Vanuatu",
    ],
  },
  {
    label: "Western Europe & North America",
    countries: [
      "Austria", "Belgium", "Canada", "Denmark", "Finland", "France",
      "Germany", "Greece", "Iceland", "Ireland", "Italy", "Luxembourg",
      "Netherlands", "Norway", "Portugal", "Spain", "Sweden", "Switzerland",
      "United Kingdom", "United States",
    ],
  },
];

export const ALL_COUNTRIES: { country: string; region: string }[] =
  REGION_GROUPS.flatMap((g) =>
    g.countries.map((country) => ({ country, region: g.label }))
  );
