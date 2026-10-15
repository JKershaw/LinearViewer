// node:test custom reporter used by mutate.mjs. Emits one line per failing
// LEAF test (suites skipped) and a final summary line, so the runner can say
// which tests killed a mutant without parsing TAP.
export default async function* reporter(source) {
  let pass = 0
  let fail = 0
  for await (const event of source) {
    if (event.type === 'test:pass' && event.data.details?.type !== 'suite') pass += 1
    if (event.type === 'test:fail' && event.data.details?.type !== 'suite') {
      fail += 1
      const file = event.data.file ? event.data.file.split('/').pop() : '?'
      yield `KIT-FAIL\t${file}\t${String(event.data.name).replace(/\s+/g, ' ')}\n`
    }
  }
  yield `KIT-SUMMARY\t${JSON.stringify({ pass, fail })}\n`
}
