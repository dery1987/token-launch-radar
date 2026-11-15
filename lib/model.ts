// The token radar's scoring model (radar-2): a snapshot of the protocol universe in, a ranked
// board out.
//
// The board covers every slug on the snapshot's watchlist (the floor, never a ceiling) and adds
// every pre-token protocol below the watchlist floor that passes the watchlist's own exclusion
// rule: not a wrapped, staked or bridged product, not a versioned pool, not an exchange.
// Protocols at or above the floor that the watchlist leaves out are left out too: they are child
// products of a protocol whose token already trades (Sentora Curator, Polymarket International,
// CIAN Yield Layer, Mellow Core), and the radar ranks protocols still waiting on a launch of
// their own, not a parent's pool.
//
// Implied value comes only from the snapshot's own figures, through comparables:
//
//   ratio(p)    = clamp(mcap_usd / tvl_usd, 0.02, 3.0) for every live-token protocol p
//   multiple(c) = clamp( w * median(ratio of live-token protocols in category c)
//                         + (1 - w) * median(ratio of all live-token protocols), 0.05, 1.0 )
//                 with w = n / (n + 6), n the count of live-token protocols in c
//   base        = tvl_usd x multiple(category)
//   growth      = clamp(change_7d, -60, 120) per cent
//   growthMult  = 1 + (growth / 100) x 0.5
//   maturity    = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied     = max(1, round(base x growthMult x maturity))
//
// A category's multiple is what its live-token peers actually trade at, shrunk toward the whole
// market's median so a category with one or two live tokens cannot set its own multiple from an
// outlier. No protocol name is ever special-cased: the same function scores every row.

/** One protocol entry of the snapshot: exactly the ten fields the sealed input carries. */
export interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_n: number;
  multiple_floor: number;
  multiple_cap: number;
  ratio_floor: number;
  ratio_cap: number;
}

export const MODEL_PARAMS: ModelParams = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_n: 6,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  ratio_floor: 0.02,
  ratio_cap: 3.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_LABEL = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_VIEW_COUNT = 24;

/** One category's comparable multiple: what its live-token peers trade at, and what the model uses. */
export interface CategoryPeer {
  category: string;
  n: number;
  median: number;
  multiple: number;
}

/** The comparables the model is built from: the market median and one row per category. */
export interface PeerTable {
  global_median: number;
  by_category: CategoryPeer[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmAction {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface CompactEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  category_median: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comparables, and the model it runs. */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  comparables: CategoryPeer[];
  global_median: number;
  rows: CompactEntry[];
  live: LiveEntry[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

const MS_PER_DAY = 86_400_000;

/** A finite number, else `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `v` into [`lo`, `hi`]. */
function clampTo(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The median of a non-empty list of numbers. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / MS_PER_DAY));
}

/**
 * The comparables: every live-token protocol's market-cap-to-TVL ratio, winsorized, grouped by
 * category. A category's multiple is its median ratio shrunk toward the market median, so a
 * category with one live token cannot set its multiple from that token alone.
 */
export function buildPeerTable(snapshot: SnapshotDoc, model: ModelParams = MODEL_PARAMS): PeerTable {
  const live = snapshot.protocols.filter(
    (proto) => proto.mcap_usd !== null && proto.mcap_usd > 0 && proto.tvl_usd > 0 && proto.category !== 'CEX',
  );
  const ratioOfLive = (proto: ProtocolRecord): number =>
    clampTo((proto.mcap_usd as number) / proto.tvl_usd, model.ratio_floor, model.ratio_cap);
  const marketMedian = live.length > 0 ? medianOf(live.map(ratioOfLive)) : 0.25;
  const ratiosByCat = new Map<string, number[]>();
  for (const proto of live) {
    const cat = proto.category ?? 'Other';
    const list = ratiosByCat.get(cat);
    if (list) list.push(ratioOfLive(proto));
    else ratiosByCat.set(cat, [ratioOfLive(proto)]);
  }
  const perCategory: CategoryPeer[] = [...ratiosByCat.entries()]
    .map(([category, ratios]) => {
      const catMedian = medianOf(ratios);
      const weight = ratios.length / (ratios.length + model.shrink_n);
      const catMultiple = clampTo(weight * catMedian + (1 - weight) * marketMedian, model.multiple_floor, model.multiple_cap);
      return { category, n: ratios.length, median: round4dp(catMedian), multiple: round4dp(catMultiple) };
    })
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_median: round4dp(marketMedian), by_category: perCategory };
}

/** The base multiple one category gets: its comparable multiple, or the market median. */
export function multipleForCategory(category: string | null, peers: PeerTable, model: ModelParams = MODEL_PARAMS): number {
  if (category === null) return round4dp(clampTo(peers.global_median, model.multiple_floor, model.multiple_cap));
  const row = peers.by_category.find((c) => c.category === category);
  return row ? row.multiple : round4dp(clampTo(peers.global_median, model.multiple_floor, model.multiple_cap));
}

/** The multipliers and the implied value one protocol gets under `model` and its comparables. */
export function scoreProtocol(
  proto: ProtocolRecord,
  asOf: string,
  peers: PeerTable,
  model: ModelParams = MODEL_PARAMS,
): {
  implied: number;
  multiple: number;
  categoryMedian: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageInDays(asOf, proto.listed_at);
  const rawGrowth = finiteOr(proto.change_7d, 0);
  const growthPct = clampTo(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const multiple = multipleForCategory(proto.category, peers, model);
  const cat = peers.by_category.find((c) => c.category === proto.category);
  const categoryMedian = cat ? cat.median : peers.global_median;
  const base = proto.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, categoryMedian, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule excludes: wrapped, staked or bridged products, and exchanges. */
const BLOCKED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A whole word wrapped, staked or staking in the name: a product of a token that already trades. */
const WRAPPED_NAME_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name: the exchange's own product, not a launch of its own. */
const EXCHANGE_NAME_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function hasNoToken(proto: ProtocolRecord): boolean {
  return proto.mcap_usd === null && proto.gecko_id === null && proto.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not a versioned pool, not an exchange. This is the
 * watchlist's own exclusion rule, minus its TVL floor: the floor is where the house's reading
 * started, not where this radar stops.
 */
export function isBoardEligible(proto: ProtocolRecord): boolean {
  if (!hasNoToken(proto)) return false;
  if (proto.category !== null && BLOCKED_CATEGORIES.has(proto.category)) return false;
  if (VERSIONED_NAME.test(proto.name)) return false;
  if (WRAPPED_NAME_WORD.test(proto.name)) return false;
  if (EXCHANGE_NAME_PREFIX.test(proto.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function indexBySlug(protocols: ProtocolRecord[]): Map<string, ProtocolRecord> {
  return new Map(protocols.map((proto) => [proto.slug, proto]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function rankBoard(snapshot: SnapshotDoc, model: ModelParams = MODEL_PARAMS): BoardEntry[] {
  const peers = buildPeerTable(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, ProtocolRecord>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const proto = index.get(slug);
    if (proto !== undefined) chosen.set(slug, proto);
  }
  // The early radar: every pre-token protocol below the watchlist floor that passes the watchlist's
  // own exclusion rule, by TVL. Never a replacement for a watchlist row: a chosen protocol stays
  // chosen. Protocols at or above the floor that the watchlist leaves out are child products of a
  // protocol whose token already trades, so they stay out too.
  const early = snapshot.protocols
    .filter((proto) => !chosen.has(proto.slug) && isBoardEligible(proto) && proto.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const proto of early) chosen.set(proto.slug, proto);

  const scored = [...chosen.values()].map((proto) => {
    const v = scoreProtocol(proto, snapshot.as_of, peers, model);
    return { proto, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.proto.slug,
    name: s.proto.name,
    category: s.proto.category,
    chains: s.proto.chains,
    tvl_usd: s.proto.tvl_usd,
    change_7d: s.proto.change_7d,
    mcap_usd: s.proto.mcap_usd,
    listed_at: s.proto.listed_at,
    gecko_id: s.proto.gecko_id,
    symbol: s.proto.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.multiple,
      category_median: round4dp(s.categoryMedian),
      growth_pct: s.growthPct,
      growth_multiplier: round4dp(s.growthMult),
      maturity_multiplier: round4dp(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: planFarmSteps(s.proto, s.age).map(formatStep),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveEntries(snapshot: SnapshotDoc): LiveEntry[] {
  return snapshot.protocols
    .filter((proto) => !hasNoToken(proto) && proto.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_VIEW_COUNT)
    .map((proto) => ({
      slug: proto.slug,
      name: proto.name,
      category: proto.category,
      chains: proto.chains,
      tvl_usd: proto.tvl_usd,
      mcap_usd: proto.mcap_usd,
      change_7d: proto.change_7d,
      mcap_tvl_ratio:
        proto.mcap_usd !== null && proto.tvl_usd > 0
          ? round4dp(clampTo(proto.mcap_usd / proto.tvl_usd, MODEL_PARAMS.ratio_floor, MODEL_PARAMS.ratio_cap))
          : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function compactEntry(row: BoardEntry): CompactEntry {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    category_median: row.model.category_median,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: SnapshotDoc, model: ModelParams = MODEL_PARAMS): { board: BoardEntry[]; radar: RadarPayload } {
  const peers = buildPeerTable(snapshot, model);
  const board = rankBoard(snapshot, model);
  const live = liveEntries(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_LABEL,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comparables: peers.by_category,
    global_median: peers.global_median,
    rows: board.map(compactEntry),
    live,
  };
  return { board, radar };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function formatStep(step: FarmAction): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(proto: ProtocolRecord): string {
  return proto.chains.length > 0 ? proto.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalForSize(proto: ProtocolRecord): number {
  if (proto.tvl_usd >= 5_000_000_000) return 250;
  if (proto.tvl_usd >= 1_000_000_000) return 150;
  if (proto.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionForCategory(proto: ProtocolRecord, capital: number, chain: string): string {
  const c = (proto.category ?? '').toLowerCase();
  const name = proto.name;
  if (c.includes('risk curator') || c.includes('curator')) return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis strategy on ${chain} and keep the position open.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into a ${name} CeDeFi vault on ${chain} and keep the shares.`;
  if (c.includes('payment')) return `Move $${capital} through ${name}'s payment rail on ${chain} and keep a balance in its app.`;
  if (c.includes('governance incentive')) return `Lock $${capital} of the chain's asset in ${name}'s governance program on ${chain} and vote each round.`;
  if (c === 'chain') return `Bridge $${capital} of USDC to ${chain} through ${name} and use its native apps.`;
  if (c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset in ${name}'s pool on ${chain} and keep the receipt.`;
  if (c.includes('stablecoin wrapper')) return `Wrap $${capital} of the stable asset through ${name} on ${chain} and hold the wrapped balance.`;
  if (c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${name} on ${chain} and keep the position open.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s top vault on ${chain} and keep the shares.`;
  if (c.includes('leveraged farm')) return `Open a $${capital} leveraged farm on ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('uncollateralized')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index on ${chain} and hold the shares.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} of USDC into a ${name} managed pool on ${chain} and keep the shares.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The qualifying action a farmer repeats each week, in the category's own words. */
function weeklyAction(proto: ProtocolRecord): string {
  const c = (proto.category ?? '').toLowerCase();
  if (c.includes('risk curator') || c.includes('curator')) return 'a deposit into a vault, a rebalance or a vote';
  if (c.includes('basis')) return 'a deposit, a rebalance or a roll of the basis position';
  if (c.includes('prediction')) return 'a market position or a settlement claim';
  if (c.includes('payment')) return 'a payment or a balance top-up';
  if (c.includes('governance')) return 'a vote or a lock extension';
  if (c.includes('derivative') || c.includes('perpetual')) return 'a trade, a hedge adjustment or a funding claim';
  if (c.includes('bridge')) return 'a bridge or a swap on the destination chain';
  if (c.includes('insurance')) return 'a cover renewal or a claim check';
  return 'a deposit, a borrow, a swap or a vote';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function planFarmSteps(proto: ProtocolRecord, age: number | null): FarmAction[] {
  const chain = firstChain(proto);
  const capital = capitalForSize(proto);
  const hold = holdDays(age);
  const action = actionForCategory(proto, capital, chain);
  const weekly = weeklyAction(proto);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as ${weekly}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotShapeError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotShapeError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotShapeError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotShapeError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotShapeError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotShapeError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotShapeError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotShapeError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotShapeError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardEntry[], snapshot: SnapshotDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
