/**
 * Yair Marcoschamer portfolio — OwnerRadar client demo.
 * Many hats, one desk: Plant The Future + sibling entities (Sunbiz / public filings).
 *
 * DB still uses capacity_pizzas / pizza_count = capacity units (panels, covers, jobs).
 */
export const JOES_STORES = [
  {
    id: "plant-the-future",
    name: "Plant The Future",
    neighborhood: "Biophilic studio · CEO",
    address: "8484 NE 2nd Ave, Miami, FL 33138",
    phone: "(305) 573-2100",
    city: "Miami",
    capacity_pizzas: 12,
    van_available: true,
    timezone: "America/New_York",
  },
  {
    id: "lala-land",
    name: "Lala Land of Miami",
    neighborhood: "Hospitality / café · Member",
    address: "Little River · Miami, FL",
    phone: "",
    city: "Miami",
    capacity_pizzas: 40,
    van_available: false,
    timezone: "America/New_York",
  },
  {
    id: "where-minds-create",
    name: "Where Minds Create",
    neighborhood: "Creative studio · President",
    address: "North Miami Beach, FL",
    phone: "",
    city: "North Miami Beach",
    capacity_pizzas: 16,
    van_available: false,
    timezone: "America/New_York",
  },
  {
    id: "marcoschamer-group",
    name: "Marcoschamer Group",
    neighborhood: "Holding / creative · Director",
    address: "North Miami Beach, FL",
    phone: "",
    city: "North Miami Beach",
    capacity_pizzas: 10,
    van_available: false,
    timezone: "America/New_York",
  },
  {
    id: "pollinator",
    name: "Pollinator",
    neighborhood: "Ventures · Member",
    address: "89 NE 102nd St, Miami, FL 33138",
    phone: "",
    city: "Miami",
    capacity_pizzas: 14,
    van_available: true,
    timezone: "America/New_York",
  },
  {
    id: "ecoist",
    name: "Ecoist",
    neighborhood: "Eco accessories · Member",
    address: "Miami, FL",
    phone: "",
    city: "Miami",
    capacity_pizzas: 22,
    van_available: false,
    timezone: "America/New_York",
  },
];

/** Primary material SKU used by kpi inventory cover. */
export const PRIMARY_INVENTORY_SKU = "preserved_moss";

export const INVENTORY_CATALOG = [
  { sku: "preserved_moss", label: "Preserved moss", unit: "sqft", par: 220 },
  { sku: "sheet_moss", label: "Sheet moss", unit: "sqft", par: 140 },
  { sku: "reindeer_moss", label: "Reindeer moss", unit: "lbs", par: 45 },
  { sku: "wood_frames", label: "Wood frames", unit: "count", par: 60 },
  { sku: "orchids", label: "Orchids", unit: "stems", par: 80 },
  { sku: "ceramic_vessels", label: "Ceramic vessels", unit: "count", par: 40 },
  { sku: "hanging_hardware", label: "Hanging hardware", unit: "kits", par: 50 },
  { sku: "soil_medium", label: "Soil & medium", unit: "bags", par: 30 },
];

export const ROLE_POOL = [
  "gallery_associate",
  "studio_artist",
  "installer",
  "ops_lead",
  "creative",
];

export const FIRST_NAMES = [
  "Sofia",
  "Luis",
  "Elena",
  "Andre",
  "Priya",
  "Jordan",
  "Camila",
  "Carlos",
  "Sam",
  "Rosa",
  "Nina",
  "Omar",
];
