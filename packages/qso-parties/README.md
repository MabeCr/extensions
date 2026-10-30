# @ham2k/qso-parties

Fifty QSO parties as `QsoPartyParams` — the rules, the dates and the county
tables the shared engine (`@ham2k/lib-qso-party`) reads to score a log, check an
exchange and write a submittable file.

An extension imports the one party it is:

```ts
import { PARTY } from "@ham2k/qso-parties/tx"
```

`@ham2k/qso-parties` itself is the map of all fifty, keyed by the code the
bundled version used to name a party (`TX`, `7QP`) — for tools and tests, not
for an extension, because it carries every county list with it.

An extension that needs every party at once — a spotting source naming the
party an operation is in — imports `@ham2k/qso-parties/identities` instead:
each party's name, ref type, states, APRS token and feed pages, a few
kilobytes for all fifty, with no counties. `@ham2k/qso-parties/identity`
holds the type and the two readers those extensions share: which party an
operation is in, and which counties its ref names.

## Layout

| | |
| --- | --- |
| `fixtures/*.json` | the sponsors' data as app-polo carries it, verbatim |
| `src/parties/<key>.ts` | one party's parameters, generated |
| `src/parties/<key>.counties.json` | its county table, generated |
| `src/index.ts` | the map of all fifty, generated |
| `src/identities.ts` | every party's identity, no counties, generated |
| `src/identity.ts` | the identity type and its two readers — hand-written |
| `src/parties.test.ts` | the differential test — hand-written |
| `src/identity.test.ts` | the readers' tests — hand-written |

Everything but the fixtures, `identity.ts` and the tests is written by
`scripts/convert-parties.mjs`. Edit a fixture, never a generated module.

## Re-syncing a season

Dates move every year, and county lists and bonus stations change with them:

```sh
node scripts/convert-parties.mjs ../polo/src/extensions/contests/qp/parties
npm test --workspace @ham2k/qso-parties
```

The first command copies the new files over `fixtures/` and regenerates; the
diff to review is the county JSON (the bulk) and the modules (the rules). The
test then re-derives all fifty parties from the fixtures through its own
transcription of the sponsors' quirks and compares, so a normalization the
script gets wrong has to be got wrong twice to survive.

**Six parties diverge from app-polo deliberately** — BC, NC, NJ, NV and SC
carry dates and URLs re-read from their sponsors, and polo's copies are OLDER
than these, not newer; SD keeps the registered Cabrillo name `SDQSOP` where polo
assumes one. Each of those modules says so at the top; a re-sync that
takes polo's file back has to answer that comment first.
