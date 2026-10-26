/** The legend. Every dotted term on the site is defined here once. */
interface GlossaryEntry {
  term: string
  definition: string
}

export const GLOSSARY = {
  'last-resort': {
    term: 'Rate of Last Resort',
    definition: 'The default price for people who never signed a contract. Until 2025 it was called the Regulated Rate Option.',
  },
  retailer: {
    term: 'Competitive retailer',
    definition: 'A company that buys power from the market and sells it to you on a fixed or variable contract.',
  },
  mwh: {
    term: 'Megawatt-hour (MWh)',
    definition: 'One megawatt of power for one hour. A home uses about 7 MWh a year, so $100 per MWh is about 10 cents per kilowatt-hour.',
  },
} as const satisfies Record<string, GlossaryEntry>

export type TermId = keyof typeof GLOSSARY
