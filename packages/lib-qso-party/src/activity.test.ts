// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// How the party is found, set up, typed into and named — the surface an
// operator touches, as opposed to what the scorer makes of it.

import { test } from "node:test"
import assert from "node:assert/strict"

import type {
  FormElement,
  FormField,
  FormFieldOption,
  FormInputDescriptor,
  HookContext,
  JSONValue,
  OptionsInputDescriptor,
} from "@ham2k/extension-sdk"

import { qsoPartyActivity } from "./activity.ts"
import { registerEntityLookup } from "./dxcc.ts"
import type { QsoPartyLabels, QsoPartyParams } from "./params.ts"
import { qsoPartyRefHandler } from "./refHandler.ts"
import { CA, MN, NEQP, NV, NY, WI } from "./testFixtures.ts"

const ctx = { online: false } as never

/// An app running in Spanish. Every hook is handed one of these, and it is the
/// only thing a party's translator has to go on.
const ES: HookContext = { online: false, locale: 'es' }

function operation(ref: Record<string, JSONValue> = {}, params: QsoPartyParams = NY): Record<string, JSONValue> {
  return { uuid: 'op', stationCall: 'N0DEV', refs: [{ type: params.refType, ...ref }] }
}

async function setupForm(
  params: QsoPartyParams,
  ref: Record<string, JSONValue> = {},
  hookCtx: HookContext = ctx,
) {
  const controls = await qsoPartyActivity(params).operationControls!(
    { operation: operation(ref, params) },
    hookCtx,
  )
  return (controls[0].input as FormInputDescriptor).form
}

function fieldOf(form: { elements: FormElement[] }, key: string): FormField {
  const field = form.elements.find((element) => element.type === 'field' && element.key === key)
  assert.ok(field, `the form asks nothing under ${key}`)
  return field as FormField
}

function labelOf(form: { elements: FormElement[] }, key: string): string {
  return fieldOf(form, key).label
}

function optionLabels(form: { elements: FormElement[] }, key: string): string[] {
  return (fieldOf(form, key).options as FormFieldOption[]).map((option) => option.label)
}

function markdownOf(form: { elements: FormElement[] }): string {
  return form.elements
    .filter((element) => element.type === 'markdown')
    .map((element) => element.text)
    .join('\n')
}

/// The questions a setup form asks, in order. The help text and the information
/// panel are elements too, and carry no key.
function fieldKeys(form: { elements: FormElement[] }): string[] {
  return form.elements.flatMap((element) => ('key' in element && element.key ? [element.key] : []))
}

async function exchangeInput(
  params: QsoPartyParams,
  qso?: Record<string, JSONValue>,
  hookCtx: HookContext = ctx,
) {
  const controls = await qsoPartyActivity(params).loggingControls!(
    { operation: operation({}, params), qso },
    hookCtx,
  )
  const control = controls.find((c) => c.key === `${params.refType}/location`)!
  return { controls, input: control.input as OptionsInputDescriptor }
}

test('the party is found by its own name, its short name or its state', async () => {
  const suggest = qsoPartyActivity(NY).suggest!
  for (const term of ['new york', 'NYQP', 'ny', 'qso party']) {
    const found = await suggest({ operation: {}, searchTerm: term }, ctx)
    assert.equal(found.length, 1, `"${term}" finds nothing`)
  }
  // Somebody else's party is somebody else's answer.
  assert.deepEqual(await suggest({ operation: {}, searchTerm: 'texas' }, ctx), [])
  // Unless this extension alone was asked, in which case the answer is what it
  // has: a scoped search is the operator looking AT this party, not for it.
  assert.equal((await suggest({ operation: {}, searchTerm: 'texas', scoped: true }, ctx)).length, 1)
})

test('a party spanning several states is found by any one of them', async () => {
  // A multi-state party has NO `state` — none of its own outranks the others —
  // and its name says nothing about where it is. Without the states it spans,
  // an operator in Massachusetts typing where they are finds nothing at all.
  const suggest = qsoPartyActivity(NEQP).suggest!
  for (const term of ['MA', 'ma', ' CT ', 'RI']) {
    assert.equal((await suggest({ operation: {}, searchTerm: term }, ctx)).length, 1, `"${term}" finds nothing`)
  }
  // A state this party does not span is somebody else's answer. The term is
  // matched WHOLE, as a single state is: a two-character code tested as a
  // substring would answer for a party it has nothing to do with.
  assert.deepEqual(await suggest({ operation: {}, searchTerm: 'AK' }, ctx), [])

  // And a single-state party still answers for its own state and no other.
  const ny = qsoPartyActivity(NY).suggest!
  assert.equal((await ny({ operation: {}, searchTerm: 'ny' }, ctx)).length, 1)
  assert.deepEqual(await ny({ operation: {}, searchTerm: 'MA' }, ctx), [])
})

test('a suggestion carries everything the activity row shows', async () => {
  // The suggestion path persists what this returns VERBATIM and never calls
  // `decorateRef`, so a ref added by tapping a suggestion reaches the activities
  // row with whatever is written here and nothing else.
  const [suggestion] = await qsoPartyActivity(NY).suggest!({ operation: {} }, ctx)
  assert.equal(suggestion.type, NY.refType)
  assert.equal(suggestion.label, 'New York QSO Party 2026')
  assert.equal(suggestion.shortLabel, 'NYQP')
  assert.equal(suggestion.name, 'New York QSO Party • 2026-10-17')
  assert.equal(suggestion.program, 'Contest')

  // And `decorateRef` composes the same two strings, or the same operation reads
  // differently depending on how its party was added.
  const decorated = await qsoPartyRefHandler(NY).decorateRef!({ ref: { type: NY.refType } }, ctx)
  assert.equal(decorated.label, suggestion.label)
  assert.equal(decorated.name, suggestion.name)
  // The county rides along in the short label, which is what the row has room
  // for.
  const located = await qsoPartyRefHandler(NY).decorateRef!(
    { ref: { type: NY.refType, location: 'alb' } },
    ctx,
  )
  assert.equal(located.shortLabel, 'NYQP: ALB')
})

test('the setup form asks where we are, and never which party', async () => {
  // One extension is ONE party: an engine that kept a party picker would ask the
  // operator to choose the party they chose by enabling this extension, and give
  // them a way to pick a different one.
  const form = await setupForm(NY, { location: 'ALB' })
  const keys = fieldKeys(form)
  assert.equal(keys.includes('ref'), false)
  assert.deepEqual(keys, ['location', 'operator', 'power', 'station', 'mode', 'overlay', 'email'])
  // The location field is prefilled with what the ref already says.
  const location = form.elements.find((element) => 'key' in element && element.key === 'location')
  assert.equal((location as { value?: string } | undefined)?.value, 'ALB')
})

test('an axis the sponsor does not classify by is a question nobody is asked', async () => {
  // Every class is a claim that goes into the submitted log's `CATEGORY-` lines,
  // and for some parties multiplies the score. A party that publishes none is
  // asked nothing.
  const form = await setupForm(NV)
  assert.deepEqual(fieldKeys(form), ['location', 'email'])
  // And a party that publishes only power classes is asked only that.
  const wi = await setupForm(WI)
  assert.deepEqual(fieldKeys(wi), ['location', 'power', 'email'])
})

test('the name is asked for only by the party that exchanges one', async () => {
  const mn = await setupForm(MN)
  assert.ok(fieldKeys(mn).includes('ourName'))
  const ny = await setupForm(NY)
  assert.equal(fieldKeys(ny).includes('ourName'), false)
})

test('the county-line help is shown by the parties that have county lines', async () => {
  const ny = await setupForm(NY)
  assert.ok(ny.elements.some((element) => element.type === 'markdown' && /county[- ]line/i.test(element.text)))
  const wi = await setupForm(WI)
  assert.equal(wi.elements.some((element) => element.type === 'markdown' && /county[- ]line/i.test(element.text)), false)
})

test('the information panel says when the party runs and how far to trust that', async () => {
  const form = await setupForm({ ...NY, status: 'Verified for 2026', lastUpdated: '2026-09-06' })
  const markdown = form.elements.filter((element) => element.type === 'markdown').map((element) => element.text).join('\n')
  assert.match(markdown, /2026-10-17 14:00Z — 2026-10-18 01:59Z/)
  assert.match(markdown, /Verified for 2026/)
  assert.match(markdown, /2026-09-06/)
  // A party that runs two sessions shows both: one range spanning the gap
  // between them claims hours the sponsor does not score.
  const twoSessions = await setupForm({
    ...NY,
    periods: [
      { startMillis: Date.UTC(2026, 9, 17, 14), endMillis: Date.UTC(2026, 9, 18, 2) },
      { startMillis: Date.UTC(2026, 9, 18, 14), endMillis: Date.UTC(2026, 9, 18, 23) },
    ],
  })
  const periods = twoSessions.elements
    .filter((element) => element.type === 'markdown')
    .map((element) => element.text).join('\n')
    .match(/\*\*Period:/g)
  assert.equal(periods?.length, 2)
})

/// One label as an event with its own catalog supplies it: a function of the
/// ctx the hook was handed, and of nothing else.
function localized(en: string, es: string) {
  return (hookCtx: HookContext) => (hookCtx.locale === 'es' ? es : en)
}

/// A party translating the form into its operators' language. Deliberately
/// PARTIAL on the classes — `QRP`, `HIGH` and the modes are left alone — because
/// what an untranslated class falls back to is half of what the seam promises.
const SPANISH: QsoPartyLabels = {
  ourLocation: localized('Our County', 'Nuestro Condado'),
  theirLocation: localized('County', 'Condado'),
  countyLineHelp: localized('This event allows county-line operation', 'Este evento permite operar desde una línea de condados'),
  mobileHelp: localized('Roving?', '¿En movimiento?'),
  ourName: localized('Our Name', 'Nuestro nombre'),
  ourEmail: localized('E-mail', 'Correo para enviar el log'),
  ourSerial: localized('Our #', 'Nuestro #'),
  theirSerial: localized('Their #', 'Su #'),
  theirName: localized('Name', 'Nombre'),
  classNone: localized('Not declared', 'Sin declarar'),
  operator: localized('Entry Class', 'Categoría'),
  power: localized('Power', 'Potencia'),
  station: localized('Station', 'Estación'),
  mode: localized('Mode', 'Modo'),
  overlay: localized('Overlay', 'Categoría adicional'),
  period: localized('**Period:**', '**Periodo:**'),
  status: localized('**Status:**', '**Estado:**'),
  lastUpdated: localized('**Data last updated:**', '**Datos actualizados:**'),
  operatorClasses: { 'SINGLE-OP': localized('Single Operator', 'Operador único') },
  powerClasses: { LOW: localized('Low Power', 'Potencia baja') },
  stationClasses: { MOBILE: localized('Mobile', 'Móvil') },
  overlayClasses: { ROOKIE: localized('Rookie', 'Novato') },
}

const TRANSLATED: QsoPartyParams = {
  ...NY,
  labels: SPANISH,
  exchange: { number: true, name: true },
  status: 'Verificado para 2026',
  lastUpdated: '2026-09-06',
}

test("a party's own translator answers for every label the form asks", async () => {
  // The engine has no catalog to merge and no idea what a party calls things:
  // every label is resolved through the party's function from the ctx the hook
  // was handed. A seam that dropped either would render the engine's English.
  const form = await setupForm(TRANSLATED, {}, ES)

  assert.equal(labelOf(form, 'location'), 'Nuestro Condado')
  assert.equal(labelOf(form, 'ourName'), 'Nuestro nombre')
  assert.equal(labelOf(form, 'email'), 'Correo para enviar el log')
  assert.equal(labelOf(form, 'operator'), 'Categoría')
  assert.equal(labelOf(form, 'power'), 'Potencia')
  assert.equal(labelOf(form, 'station'), 'Estación')
  assert.equal(labelOf(form, 'mode'), 'Modo')
  assert.equal(labelOf(form, 'overlay'), 'Categoría adicional')

  // The ANSWERS too: a form whose questions are translated and whose options
  // are not is worse than an English one. `Sin declarar` first, the classes this
  // party translated in their own words, and the ones it did not in the
  // engine's English rather than as Cabrillo codes — with the sponsor's own
  // watts still beside them.
  assert.deepEqual(optionLabels(form, 'operator'), [
    'Sin declarar', 'Operador único', 'Multi Operator, One Transmitter', 'Multi Operator, Multiple Transmitters',
  ])
  assert.deepEqual(optionLabels(form, 'power'), [
    'Sin declarar', 'QRP — 5 watts', 'Potencia baja — 100 watts', 'High Power — >100 watts',
  ])
  assert.deepEqual(optionLabels(form, 'station'), [
    'Sin declarar', 'Fixed', 'Móvil', 'Portable', 'School',
  ])
  assert.deepEqual(optionLabels(form, 'overlay'), ['Sin declarar', 'Novato', 'Youth', 'YL'])

  const markdown = markdownOf(form)
  assert.match(markdown, /Este evento permite operar desde una línea de condados/)
  assert.match(markdown, /¿En movimiento\?/)
  // The headings translate; the dates, the status note and the sponsor's URL do
  // not, because they are the party's own data rather than the engine's words.
  assert.match(markdown, /\*\*Periodo:\*\* 2026-10-17 14:00Z — 2026-10-18 01:59Z/)
  assert.match(markdown, /\*\*Estado:\*\* Verificado para 2026/)
  assert.match(markdown, /\*\*Datos actualizados:\*\* 2026-09-06/)

  // And the exchange row, which is the other half of what an operator reads.
  const { controls } = await exchangeInput(TRANSLATED, undefined, ES)
  const labels = Object.fromEntries(controls.map((control) => [control.key, control.label]))
  assert.equal(labels[`${TRANSLATED.refType}/ourSerial`], 'Nuestro #')
  assert.equal(labels[`${TRANSLATED.refType}/theirSerial`], 'Su #')
  assert.equal(labels[`${TRANSLATED.refType}/theirName`], 'Nombre')
  assert.equal(labels[`${TRANSLATED.refType}/location`], 'Condado')
})

test('a party that supplies no translator reads exactly as it did before there was one', async () => {
  // The seam costs an event nothing: a party that declares no labels renders the
  // engine's English whatever locale the app is in — the same strings, composed
  // the same way, as when there was no seam at all.
  const form = await setupForm({ ...NY, status: 'Verified for 2026' }, {}, ES)
  assert.equal(labelOf(form, 'location'), 'Our QP Location')
  assert.equal(labelOf(form, 'email'), 'E-mail for the log submission')
  assert.equal(labelOf(form, 'operator'), 'Entry Class')
  assert.deepEqual(optionLabels(form, 'operator').slice(0, 2), ['Not declared', 'Single Operator'])
  const markdown = markdownOf(form)
  assert.match(markdown, /This event allows county-line operation/)
  assert.match(markdown, /Roving\? Type BREAK/)
  assert.match(markdown, /\*\*Status:\*\* Verified for 2026/)
  assert.match(markdown, /\*\*Period:\*\* 2026-10-17 14:00Z/)

  // The sponsor's own noun does NOT reach this field. `labelForCounties` names
  // the county-equivalent for prose that talks ABOUT them; the field itself
  // says which activity wants it, because that is what an operator reading a
  // row of four-character fields needs to know — and `Districts` would not.
  const districts = await setupForm({ ...NY, labelForCounties: 'Districts' }, {}, ES)
  assert.equal(labelOf(districts, 'location'), 'Our QP Location')
})

test('the exchange field asks for a serial only where the sponsor does', async () => {
  const { controls } = await exchangeInput(CA)
  assert.deepEqual(controls.map((control) => control.key), [
    `${CA.refType}/ourSerial`,
    `${CA.refType}/theirSerial`,
    `${CA.refType}/location`,
  ])
  const plain = await exchangeInput(NY)
  assert.deepEqual(plain.controls.map((control) => control.key), [`${NY.refType}/location`])
})

test('the exchange field is as long as the exchange can be', async () => {
  // A county line can run through a corner: room for three five-character
  // codes and their separators, at least. A party without lines has one code,
  // and a field long enough for two invites an exchange it cannot score.
  assert.ok(((await exchangeInput(NY)).input.maxLength as number) >= 'ORDES/ORJEF/ORLIN'.length)
  assert.equal((await exchangeInput(WI)).input.maxLength, 6)
})

test('a station with no list to choose from types whatever they heard', async () => {
  // For a DX station the option set is empty — nobody asks them for a county —
  // so the field has to accept a value it cannot offer.
  const dx = await exchangeInput(NY, { their: { call: 'DL1ABC', entityPrefix: 'DL' } })
  assert.deepEqual(dx.input.options, [])
  assert.equal(dx.input.allowFreeform, true)
  // A US station has a list, and the field is held to it.
  const us = await exchangeInput(NY, { their: { call: 'K1ABC', entityPrefix: 'K' } })
  assert.ok(us.input.options!.length > 0)
  assert.equal(us.input.allowFreeform, false)
})

test("the lookup fills in what the log would claim, and only hints at an in-party caller's own state", async () => {
  // In the party: they send a COUNTY, which no lookup guesses, so the state's
  // counties float to the top and the state itself is only a hint — `NY` is
  // the exchange nobody in the New York QSO Party sends.
  const inParty = (await exchangeInput(NY, { their: { call: 'K1ABC', entityPrefix: 'K', guess: { state: 'NY' } } })).input
  assert.ok(inParty.preferredCodes!.includes('ALB'))
  assert.equal(inParty.preferredCodes!.includes('NY'), false)
  assert.equal(inParty.options!.some((option) => option.code === 'NY'), false)
  assert.equal(inParty.suggestedValue, undefined)
  assert.equal(inParty.placeholder, 'NY')

  // Out of the party the state IS their exchange, and it goes in as a value.
  const outside = (await exchangeInput(NY, { their: { call: 'W3WC', entityPrefix: 'K', guess: { state: 'PA' } } })).input
  assert.equal(outside.suggestedValue, 'PA')
  assert.equal(outside.placeholder, undefined)
})

test('with nothing from this operation, an earlier running of the event is asked', async () => {
  // An in-state caller on their first contact: no lookup knows their county,
  // and this operation has none yet — but last year's running does. Found by
  // the event's ref type, which its operations carry, and never this
  // operation's own contacts, which were asked first.
  const asked: Record<string, unknown>[] = []
  const lastYear = [{ their: { call: 'K2ABC' }, band: '40m', refs: [{ type: NY.refType, location: 'ALB' }] }]
  const history: HookContext = {
    online: false,
    getHistoryForCall: (async (_call: string, options: Record<string, unknown>) => {
      asked.push(options)
      return options.excludeOperation ? lastYear : []
    }) as never,
  }
  const { input } = await exchangeInput(
    NY,
    { their: { call: 'K2ABC', entityPrefix: 'K', guess: { state: 'NY' } } },
    history,
  )
  assert.equal(input.suggestedValue, 'ALB')
  assert.equal(asked.length, 2, 'this operation first, then earlier runnings')
  assert.equal(asked[0].operation, 'op')
  assert.equal(asked[1].refType, NY.refType)
  assert.equal(asked[1].excludeOperation, 'op')
})

test("a Hawaiian in the Hawaii QSO Party is hinted their state, not handed it", async () => {
  // KH6 is not K, so a Hawaiian's field is freeform with no list to reject
  // anything — and their fallback location is `HI`. Prefilled, `HI` would
  // log them as an out-of-party state for a county nobody copied; it is the
  // party's own state, so it is a hint like `NY` in NYQP.
  const HI = { ...NY, refType: 'hi-qso-party', short: 'HIQP', state: 'HI', countyLine: false, counties: { HIL: 'Hilo', MAU: 'Maui' } }
  const { input } = await exchangeInput(HI, { their: { call: 'KH6ABC', entityPrefix: 'KH6' } })
  assert.equal(input.suggestedValue, undefined)
  assert.equal(input.placeholder, 'HI')
})

test('a history the host could not answer offers nothing, not an earlier running', async () => {
  // "Could not ask about this operation" is not "never worked them here":
  // read as the second, last year's county would answer over one the operator
  // may have copied minutes ago.
  const failing: HookContext = {
    online: false,
    getHistoryForCall: (async (_call: string, options: Record<string, unknown>) => {
      if (options.operation) throw new Error('history unavailable')
      return [{ their: { call: 'K2ABC' }, band: '40m', refs: [{ type: NY.refType, location: 'ALB' }] }]
    }) as never,
  }
  const warn = console.warn
  console.warn = () => {}
  try {
    const { input } = await exchangeInput(NY, { their: { call: 'K2ABC', entityPrefix: 'K', guess: { state: 'NY' } } }, failing)
    assert.equal(input.suggestedValue, undefined)
    assert.equal(input.placeholder, 'NY', 'the field still comes up, hint and all')
  } finally {
    console.warn = warn
  }
})

test('a Hawaiian picks from the party\'s list, like any other US station', async () => {
  // KH6 is a US state that does not sign K. In the Hawaii QSO Party a Hawaiian
  // is the one station that sends one of its multipliers — left to the DX path,
  // exactly they would type it into a field with no list and no tint for a typo.
  const HI = { ...NY, refType: 'hi-qso-party', short: 'HIQP', state: 'HI', countyLine: false, counties: { HIL: 'Hilo', MAU: 'Maui' } }
  const { input } = await exchangeInput(HI, { their: { call: 'KH6ABC', entityPrefix: 'KH6' } })
  const codes = input.options!.map((option) => option.code)
  assert.ok(codes.includes('HIL'))
  assert.equal(codes.includes('HI'), false, "the party's own state is not offered")
  assert.equal(input.allowFreeform, false)
})

test('the exchange is mirrored into the field the rest of the app reads', async () => {
  const save = qsoPartyActivity(CA).processQsoBeforeSave!
  const patch = await save({
    qso: { refs: [{ type: CA.refType, location: 'butt', theirSerial: '34', ourSerial: '12' }] },
    operation: operation({ location: 'ALAM' }, CA),
  }, ctx)
  assert.deepEqual(patch!.their, { exchange: '34 BUTT' })
  assert.deepEqual(patch!.our, { exchange: '12 ALAM' })
})

test('a contact with nothing of ours on it is left alone', async () => {
  // `their.exchange` is one field shared by every activity on the operation, and
  // the patch is merged one level deep — so answering with an empty string
  // unconditionally writes over whatever a co-active activity just put there,
  // and a DX contact, whose exchange is empty for every party, does it every
  // time.
  const save = qsoPartyActivity(NY).processQsoBeforeSave!
  const untouched = await save({ qso: {}, operation: operation({}) }, ctx)
  assert.equal(untouched, null)
  // A deliberate blank still projects, so clearing an exchange on an edit clears
  // the QSO row's column with it.
  const cleared = await save({
    qso: { refs: [{ type: NY.refType, location: '' }] },
    operation: operation({}),
  }, ctx)
  assert.deepEqual(cleared!.their, { exchange: '' })
})

test('what we sent is re-projected from the operation handed over, and nothing is stamped', async () => {
  // The host hands this hook the SEGMENT-EFFECTIVE operation for the contact's
  // own time, so an edit of an old contact reads the county that was true then
  // — no stamp to protect it, and a stamp an earlier build left on the ref
  // does not outrank the operation.
  const save = qsoPartyActivity(NY).processQsoBeforeSave!
  const fresh = await save({
    qso: { refs: [{ type: NY.refType, location: 'ERI' }] },
    operation: operation({ location: 'ALB' }),
  }, ctx)
  assert.equal(fresh!.refs, undefined)
  assert.deepEqual(fresh!.our, { exchange: 'ALB' })

  const corrected = await save({
    qso: { refs: [{ type: NY.refType, location: 'ERI', ourLocation: 'ALB' }] },
    operation: operation({ location: 'REN' }),
  }, ctx)
  assert.equal(corrected!.refs, undefined)
  assert.deepEqual(corrected!.our, { exchange: 'REN' })
})

test('the operation is titled for the party, and subtitled with where we are', async () => {
  const handler = qsoPartyRefHandler(NY)
  const title = await handler.suggestOperationTitle!({
    ref: { type: NY.refType, location: 'ALB/REN' },
    operation: operation({ location: 'ALB/REN' }),
  }, ctx)
  // The codes ride in the title: a rover's segment rows are composed from it,
  // and "for NYQP" twice over would not tell two counties apart.
  assert.equal(title!.for, 'NYQP: ALB/REN')
  // The county's NAME, which is what an operator recognizes.
  assert.equal(title!.subtitle, 'Albany / Rensselaer')

  // The rules are what there is to read about a contest.
  assert.deepEqual(await handler.linkForRef!({ ref: { type: NY.refType } }, ctx), {
    url: 'https://nyqp.org/',
    label: 'New York QSO Party',
  })
  assert.equal(await qsoPartyRefHandler(WI).linkForRef!({ ref: { type: WI.refType } }, ctx), null)
})

test('any ref of this type is this party, and carries no second name for it', async () => {
  // The ref TYPE is the party. A `normalized` would be written back into the
  // ref's own `ref` field — a second key holding the same fact, free to
  // disagree with the type after a rename — so validation answers with the
  // verdict alone.
  assert.deepEqual(await qsoPartyRefHandler(NY).validateRef!({ ref: { type: NY.refType } }, ctx), {
    valid: true,
  })

  // And neither creation path writes one: `suggest` persists what it returns
  // verbatim, `decorateRef` decorates what it is handed, and a `ref` appearing
  // on either would be an operation ref the other could not match.
  const [suggestion] = await qsoPartyActivity(NY).suggest!({ operation: {} }, ctx)
  assert.equal(suggestion.ref, undefined)
  const decorated = await qsoPartyRefHandler(NY).decorateRef!({ ref: { type: NY.refType } }, ctx)
  assert.equal(decorated.ref, undefined)
})

test('our location suggests counties, then everything that may only stand alone', async () => {
  // A county line is between the party's OWN counties: a state, a province or
  // DX beside a county would claim ground the station is not on.
  const field = fieldOf(await setupForm(NY), 'location')
  const suggestions = field.suggestions ?? []
  const byCode = Object.fromEntries(suggestions.map((option) => [option.code, option]))
  assert.equal(byCode.ALB?.standalone, undefined)
  assert.equal(byCode.NJ?.standalone, true)
  assert.equal(byCode.ON?.standalone, true)
  assert.equal(byCode.DX?.standalone, true)
  // Nobody in the New York QSO Party is in New York without being in a county.
  assert.equal(byCode.NY, undefined)
  assert.deepEqual(field.multiValue, { separator: '/' })
  assert.equal(field.uppercase, true)
  // The scorer reads `ALB,SCH` as a line; without the rewrite the field would
  // flag as unknown what the score counts.
  assert.deepEqual(field.transforms, [{ pattern: ',', replacement: '/', flags: 'g' }])
})

test('a party without county lines takes one location, and no separator', async () => {
  const field = fieldOf(await setupForm(WI), 'location')
  assert.equal(field.multiValue, undefined)
  assert.equal(field.transforms, undefined)
})

test('a station outside the US and Canada starts out as DX', async () => {
  registerEntityLookup((call) => (call?.toUpperCase().startsWith('DL') ? 'DL' : call?.toUpperCase().startsWith('KL7') ? 'KL' : 'K'))
  try {
    const setup = async (stationCall: string, ref: Record<string, JSONValue> = {}) => {
      const controls = await qsoPartyActivity(NY).operationControls!(
        { operation: { ...operation(ref), stationCall } },
        ctx,
      )
      return fieldOf((controls[0].input as FormInputDescriptor).form, 'location').value
    }
    assert.equal(await setup('DL1ABC'), 'DX')
    // Alaska is a US state that does not sign K.
    assert.equal(await setup('KL7ABC'), '')
    assert.equal(await setup('N0DEV'), '')
    // Only an EMPTY location: what the operator said stands.
    assert.equal(await setup('DL1ABC', { location: 'ALB' }), 'ALB')
  } finally {
    registerEntityLookup(() => undefined)
  }
})
