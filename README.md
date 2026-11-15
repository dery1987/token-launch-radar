# Token Radar — radar-2

A token launch radar for the make.fun bounty
[Build the best token launch radar](https://make.fun/bounty/token-radar-01).

The board ranks every pre-token protocol in the sealed DefiLlama snapshot by an
implied token value, and gives each one a concrete farm plan.

## The model (radar-2)

Implied value follows only from the snapshot's own figures, through comparables:

- Each live-token protocol's market-cap-to-TVL ratio is winsorized to
  [0.02, 3.0]. A category's multiple is its median ratio shrunk toward the
  market median (`n / (n + 6)` weight), clamped to [0.05, 1.0].
- `implied = round(tvl x multiple(category) x growth x maturity)`, where growth
  is the 7-day TVL change clamped to [-60%, +120%] with weight 0.5, and
  maturity rises from 0.6 to 1.0 over three years since first listing.
- No protocol name is special-cased; the same function scores every row.

## Coverage

- The board covers all 40 watchlist protocols, plus every pre-token protocol
  below the $50M floor that passes the watchlist's own exclusion rule (not a
  wrapped, staked or bridged product, not a versioned pool, not an exchange).
- Protocols at or above the floor that the watchlist leaves out are child
  products of a protocol whose token already trades, so they stay out.
- Live-token protocols are set aside with their market caps shown; their
  market-cap-to-TVL ratios are the comparables the model is built from.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18 or later, standard library only, deterministic: two runs write the
same bytes. The dashboard is a static page with no network: open
`out/dashboard/index.html` beside `out/data.js`.
