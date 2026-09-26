import { currentYear, now, nowIso } from "../domain/clock";
import {
  ConsumptionSchema,
  LocationSchema,
  LotSchema,
  TastingNoteSchema,
  WineSchema,
  WishlistItemSchema,
  type Colour,
  type Consumption,
  type Location,
  type Lot,
  type TastingNote,
  type Wine,
  type WishlistItem,
} from "../domain/types";
import { toIsoDate } from "../lib/format";
import { newId } from "../lib/id";

/**
 * The sample cellar (R24): realistic wines across colours, regions and window states, in two
 * locations, with a little drinking history. Windows are set relative to the current year so the
 * sample always shows every status. Every row is marked `isSample: true`.
 */

interface SampleLot {
  qty: number;
  /** 0 = EuroCave A, 1 = Kitchen rack. */
  at: 0 | 1;
  price: number;
  currency: "GBP" | "USD" | "EUR";
  bin?: string;
  /** Years ago the lot was bought. */
  boughtYearsAgo: number;
}

interface SampleWine {
  producer: string;
  name: string;
  vintage: number | null;
  colour: Colour;
  country: string;
  region: string;
  appellation?: string;
  grapes: string[];
  bottleSize?: number;
  /** Window as offsets from the current year; omitted means no window. */
  window?: [number, number];
  lots: SampleLot[];
  /** Bottles drunk, as [months ago, quantity, rating, note]. */
  drunk?: [number, number, number | null, string | null][];
}

const LOCATIONS = ["EuroCave A", "Kitchen rack"] as const;

const WINES: SampleWine[] = [
  {
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    colour: "red",
    country: "USA",
    region: "Santa Cruz Mountains",
    grapes: ["Cabernet Sauvignon", "Merlot", "Petit Verdot"],
    window: [1, 20],
    lots: [{ qty: 5, at: 0, price: 250, currency: "USD", bin: "A1", boughtYearsAgo: 2 }],
    drunk: [[4, 1, 94, "Tight but gorgeous cassis and cedar. Needs years."]],
  },
  {
    producer: "Château Margaux",
    name: "",
    vintage: 2015,
    colour: "red",
    country: "France",
    region: "Bordeaux",
    appellation: "Margaux",
    grapes: ["Cabernet Sauvignon", "Merlot"],
    window: [2, 35],
    lots: [{ qty: 3, at: 0, price: 520, currency: "GBP", bin: "A2", boughtYearsAgo: 6 }],
  },
  {
    producer: "Domaine Tempier",
    name: "Bandol Rosé",
    vintage: 2023,
    colour: "rose",
    country: "France",
    region: "Provence",
    appellation: "Bandol",
    grapes: ["Mourvèdre", "Grenache", "Cinsault"],
    window: [-2, 1],
    lots: [{ qty: 4, at: 1, price: 35, currency: "GBP", boughtYearsAgo: 1 }],
  },
  {
    producer: "Dr. Loosen",
    name: "Wehlener Sonnenuhr Riesling Kabinett",
    vintage: 2021,
    colour: "white",
    country: "Germany",
    region: "Mosel",
    grapes: ["Riesling"],
    window: [-3, 6],
    lots: [{ qty: 6, at: 1, price: 22, currency: "GBP", boughtYearsAgo: 2 }],
  },
  {
    producer: "Krug",
    name: "Grande Cuvée",
    vintage: null,
    colour: "sparkling",
    country: "France",
    region: "Champagne",
    grapes: ["Pinot Noir", "Chardonnay", "Meunier"],
    window: [-1, 8],
    lots: [{ qty: 2, at: 1, price: 190, currency: "GBP", boughtYearsAgo: 1 }],
  },
  {
    producer: "Domaine Leflaive",
    name: "Puligny-Montrachet",
    vintage: 2017,
    colour: "white",
    country: "France",
    region: "Burgundy",
    appellation: "Puligny-Montrachet",
    grapes: ["Chardonnay"],
    window: [-4, 0],
    lots: [{ qty: 2, at: 0, price: 95, currency: "GBP", bin: "B1", boughtYearsAgo: 5 }],
  },
  {
    producer: "Giacomo Conterno",
    name: "Barolo Cascina Francia",
    vintage: 2016,
    colour: "red",
    country: "Italy",
    region: "Piedmont",
    appellation: "Barolo",
    grapes: ["Nebbiolo"],
    window: [1, 25],
    lots: [{ qty: 3, at: 0, price: 180, currency: "EUR", bin: "B2", boughtYearsAgo: 5 }],
  },
  {
    producer: "Penfolds",
    name: "Grange",
    vintage: 2012,
    colour: "red",
    country: "Australia",
    region: "South Australia",
    grapes: ["Shiraz", "Cabernet Sauvignon"],
    window: [-3, 20],
    lots: [{ qty: 1, at: 0, price: 600, currency: "GBP", bin: "A3", boughtYearsAgo: 8 }],
  },
  {
    producer: "Château d'Yquem",
    name: "",
    vintage: 2009,
    colour: "dessert",
    country: "France",
    region: "Bordeaux",
    appellation: "Sauternes",
    grapes: ["Sémillon", "Sauvignon Blanc"],
    bottleSize: 375,
    window: [-10, 40],
    lots: [{ qty: 1, at: 0, price: 180, currency: "GBP", bin: "C1", boughtYearsAgo: 10 }],
  },
  {
    producer: "Taylor's",
    name: "Vintage Port",
    vintage: 2011,
    colour: "fortified",
    country: "Portugal",
    region: "Douro",
    appellation: "Porto",
    grapes: ["Touriga Nacional", "Touriga Franca"],
    window: [1, 40],
    lots: [{ qty: 2, at: 0, price: 75, currency: "GBP", bin: "C2", boughtYearsAgo: 9 }],
  },
  {
    producer: "Cloudy Bay",
    name: "Sauvignon Blanc",
    vintage: 2022,
    colour: "white",
    country: "New Zealand",
    region: "Marlborough",
    grapes: ["Sauvignon Blanc"],
    window: [-3, -1],
    lots: [{ qty: 2, at: 1, price: 24, currency: "GBP", boughtYearsAgo: 3 }],
  },
  {
    producer: "Marcel Lapierre",
    name: "Morgon",
    vintage: 2020,
    colour: "red",
    country: "France",
    region: "Beaujolais",
    appellation: "Morgon",
    grapes: ["Gamay"],
    window: [-4, 2],
    lots: [{ qty: 3, at: 1, price: 28, currency: "GBP", boughtYearsAgo: 3 }],
    drunk: [[2, 1, 90, "Bright cherry, a little earth. Perfect with roast chicken."]],
  },
  {
    producer: "Gravner",
    name: "Ribolla Gialla",
    vintage: 2014,
    colour: "orange",
    country: "Italy",
    region: "Friuli-Venezia Giulia",
    grapes: ["Ribolla Gialla"],
    window: [-5, 10],
    lots: [{ qty: 1, at: 0, price: 85, currency: "EUR", bin: "B3", boughtYearsAgo: 4 }],
  },
  {
    producer: "Vega Sicilia",
    name: "Único",
    vintage: 2011,
    colour: "red",
    country: "Spain",
    region: "Ribera del Duero",
    grapes: ["Tempranillo", "Cabernet Sauvignon"],
    window: [0, 25],
    lots: [{ qty: 1, at: 0, price: 400, currency: "EUR", bin: "A4", boughtYearsAgo: 4 }],
  },
  {
    producer: "Egon Müller",
    name: "Scharzhofberger Riesling Spätlese",
    vintage: 2018,
    colour: "white",
    country: "Germany",
    region: "Mosel",
    grapes: ["Riesling"],
    window: [1, 30],
    lots: [{ qty: 2, at: 0, price: 120, currency: "EUR", bin: "B4", boughtYearsAgo: 5 }],
  },
  {
    producer: "Bollinger",
    name: "Special Cuvée",
    vintage: null,
    colour: "sparkling",
    country: "France",
    region: "Champagne",
    grapes: ["Pinot Noir", "Chardonnay", "Meunier"],
    window: [-1, 3],
    lots: [{ qty: 3, at: 1, price: 55, currency: "GBP", boughtYearsAgo: 1 }],
    drunk: [[1, 2, 91, null]],
  },
  {
    producer: "Catena Zapata",
    name: "Adrianna Vineyard Malbec",
    vintage: 2018,
    colour: "red",
    country: "Argentina",
    region: "Mendoza",
    grapes: ["Malbec"],
    window: [-1, 15],
    lots: [{ qty: 2, at: 0, price: 110, currency: "USD", bin: "A5", boughtYearsAgo: 3 }],
  },
  {
    producer: "Château Musar",
    name: "",
    vintage: 2013,
    colour: "red",
    country: "Lebanon",
    region: "Bekaa Valley",
    grapes: ["Cinsault", "Carignan", "Cabernet Sauvignon"],
    window: [-5, 10],
    lots: [{ qty: 2, at: 0, price: 50, currency: "GBP", bin: "A6", boughtYearsAgo: 4 }],
  },
  {
    producer: "Domaine Huet",
    name: "Vouvray Le Haut-Lieu Sec",
    vintage: 2019,
    colour: "white",
    country: "France",
    region: "Loire",
    appellation: "Vouvray",
    grapes: ["Chenin Blanc"],
    lots: [{ qty: 2, at: 1, price: 32, currency: "GBP", boughtYearsAgo: 2 }],
  },
  {
    producer: "Tyrrell's",
    name: "Vat 1 Hunter Semillon",
    vintage: 2015,
    colour: "white",
    country: "Australia",
    region: "Hunter Valley",
    grapes: ["Semillon"],
    window: [-3, 8],
    lots: [{ qty: 1, at: 1, price: 45, currency: "GBP", boughtYearsAgo: 4 }],
  },
  {
    producer: "Blandy's",
    name: "10 Year Old Malmsey",
    vintage: null,
    colour: "fortified",
    country: "Portugal",
    region: "Madeira",
    grapes: ["Malvasia"],
    lots: [{ qty: 1, at: 1, price: 30, currency: "GBP", boughtYearsAgo: 2 }],
  },
  {
    producer: "Louis Roederer",
    name: "Cristal",
    vintage: 2014,
    colour: "sparkling",
    country: "France",
    region: "Champagne",
    grapes: ["Pinot Noir", "Chardonnay"],
    bottleSize: 1500,
    window: [0, 15],
    lots: [{ qty: 1, at: 0, price: 550, currency: "GBP", bin: "C3", boughtYearsAgo: 3 }],
  },
  {
    producer: "Beringer",
    name: "Private Reserve Chardonnay",
    vintage: 2016,
    colour: "white",
    country: "USA",
    region: "Napa Valley",
    grapes: ["Chardonnay"],
    window: [-6, -1],
    lots: [{ qty: 1, at: 1, price: 45, currency: "USD", boughtYearsAgo: 6 }],
  },
  {
    producer: "E. Guigal",
    name: "Côtes du Rhône",
    vintage: 2019,
    colour: "red",
    country: "France",
    region: "Rhône",
    appellation: "Côtes du Rhône",
    grapes: ["Grenache", "Syrah", "Mourvèdre"],
    window: [-4, 1],
    lots: [{ qty: 4, at: 1, price: 14, currency: "GBP", boughtYearsAgo: 2 }],
  },
  {
    producer: "Felton Road",
    name: "Bannockburn Pinot Noir",
    vintage: 2018,
    colour: "red",
    country: "New Zealand",
    region: "Central Otago",
    grapes: ["Pinot Noir"],
    window: [-3, 5],
    // All drunk: shows under the Drunk filter.
    lots: [{ qty: 0, at: 1, price: 48, currency: "GBP", boughtYearsAgo: 3 }],
    drunk: [
      [7, 1, 92, "Red cherry, spice and silky tannins."],
      [3, 1, 93, null],
    ],
  },
];

const WISHLIST = [
  {
    producer: "Salon",
    name: "Le Mesnil Blanc de Blancs",
    vintage: 2013,
    colour: "sparkling" as const,
    country: "France",
    region: "Champagne",
    notes: "Look for it at auction.",
  },
  {
    producer: "Domaine Jamet",
    name: "Côte-Rôtie",
    vintage: 2019,
    colour: "red" as const,
    country: "France",
    region: "Rhône",
    notes: null,
  },
];

export interface SampleCellar {
  locations: Location[];
  wines: Wine[];
  lots: Lot[];
  consumptions: Consumption[];
  tastingNotes: TastingNote[];
  wishlist: WishlistItem[];
}

/** Builds fresh sample rows (new ids each time), dated relative to `year` and `today`. */
export function buildSampleCellar(options: { year?: number; today?: Date } = {}): SampleCellar {
  const year = options.year ?? currentYear();
  const today = options.today ?? now();
  const stamp = () => {
    const t = nowIso();
    return { id: newId(), createdAt: t, updatedAt: t, isSample: true };
  };
  const monthsAgo = (n: number) =>
    toIsoDate(new Date(today.getFullYear(), today.getMonth() - n, Math.min(today.getDate(), 28)));

  const locations = LOCATIONS.map((name) => LocationSchema.parse({ ...stamp(), name }));
  const out: SampleCellar = {
    locations,
    wines: [],
    lots: [],
    consumptions: [],
    tastingNotes: [],
    wishlist: [],
  };

  for (const spec of WINES) {
    const wine = WineSchema.parse({
      ...stamp(),
      producer: spec.producer,
      name: spec.name,
      vintage: spec.vintage,
      colour: spec.colour,
      country: spec.country,
      region: spec.region,
      appellation: spec.appellation ?? null,
      grapes: spec.grapes,
      bottleSize: spec.bottleSize,
      windowFrom: spec.window ? year + spec.window[0] : null,
      windowTo: spec.window ? year + spec.window[1] : null,
      windowSource: spec.window ? "user" : null,
    });
    out.wines.push(wine);

    for (const lot of spec.lots) {
      const row = LotSchema.parse({
        ...stamp(),
        wineId: wine.id,
        locationId: locations[lot.at]?.id ?? null,
        bin: lot.bin ?? null,
        quantity: lot.qty,
        closedAt: lot.qty === 0 ? nowIso() : null,
        purchaseDate: monthsAgo(lot.boughtYearsAgo * 12),
        pricePerBottle: lot.price,
        currency: lot.currency,
      });
      out.lots.push(row);

      for (const [ago, quantity, rating, note] of spec.drunk ?? []) {
        const consumption = ConsumptionSchema.parse({
          ...stamp(),
          wineId: wine.id,
          lotId: row.id,
          date: monthsAgo(ago),
          quantity,
          rating,
        });
        out.consumptions.push(consumption);
        if (note) {
          out.tastingNotes.push(
            TastingNoteSchema.parse({
              ...stamp(),
              wineId: wine.id,
              consumptionId: consumption.id,
              date: consumption.date,
              text: note,
              rating,
            }),
          );
        }
      }
    }
  }

  out.wishlist = WISHLIST.map((item) => WishlistItemSchema.parse({ ...stamp(), ...item }));
  return out;
}
