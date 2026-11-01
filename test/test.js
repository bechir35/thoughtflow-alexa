'use strict';
// Prove della skill senza Amazon e senza rete: richieste Alexa simulate, database in memoria, cassetta finta.
// Uso: NODE_PATH=<cartella con ask-sdk-core> node test/test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { buildSkill } = require('../lambda/index');
const { parsePairing, seal, open } = require('../lambda/crypto');
const outbox = require('../lambda/outbox');

const CODE = 'TF1.tfTestTopic0123456789abcdefgh.' + Buffer.alloc(32, 7).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pairing = parsePairing(CODE);
const ME = 'amzn1.ask.person.me';
const GUEST = 'amzn1.ask.person.guest';

function memoryAdapter() {
  const db = {};
  return {
    db,
    getAttributes: async (env) => JSON.parse(JSON.stringify(db[env.context.System.user.userId] || {})),
    saveAttributes: async (env, attrs) => {
      db[env.context.System.user.userId] = JSON.parse(JSON.stringify(attrs));
    },
    deleteAttributes: async (env) => {
      delete db[env.context.System.user.userId];
    },
  };
}

function envelope(request, { locale = 'it-IT', person = ME } = {}) {
  return {
    version: '1.0',
    session: { new: true, sessionId: 's1', application: { applicationId: 'app' }, user: { userId: 'user-1' }, attributes: {} },
    context: {
      System: {
        application: { applicationId: 'app' },
        user: { userId: 'user-1' },
        person: person ? { personId: person } : undefined,
        device: { deviceId: 'echo-1', supportedInterfaces: {} },
        apiEndpoint: 'https://api.eu.amazonalexa.com',
        apiAccessToken: 'token',
      },
    },
    request: Object.assign({ requestId: 'r1', timestamp: '2026-11-01T22:55:00Z', locale }, request),
  };
}

const capture = (text, opts) =>
  envelope({ type: 'IntentRequest', dialogState: 'STARTED', intent: { name: 'CaptureIntent', confirmationStatus: 'NONE', slots: { thought: { name: 'thought', value: text, confirmationStatus: 'NONE' } } } }, opts);
const register = (opts) => envelope({ type: 'IntentRequest', intent: { name: 'RegisterVoiceIntent', confirmationStatus: 'NONE', slots: {} } }, opts);
const launch = (opts) => envelope({ type: 'LaunchRequest' }, opts);
const speech = (r) => r.response.outputSpeech.ssml;

async function run() {
  // 1. Cifratura: stesso formato dell'app. Il vettore fisso viene letto dal test Kotlin (Phase9Test).
  const iv = Buffer.alloc(12, 3);
  const vectorPlain = JSON.stringify({ v: 1, id: 'vec-1', text: 'Pulire la cucina oggi', at: 1793573700000, tz: 'Europe/Amsterdam', lang: 'it-IT' });
  const vector = seal(vectorPlain, pairing, iv);
  assert.strictEqual(open(vector, pairing), vectorPlain);
  assert.strictEqual(open(vector, parsePairing(CODE.replace('tfTestTopic', 'tfOtherTopi'))), null, 'un altro topic non apre il messaggio');
  assert.strictEqual(open(vector.slice(0, -2) + 'AA', pairing), null, 'un messaggio modificato non si apre');
  assert.strictEqual(parsePairing(''), null);
  assert.strictEqual(parsePairing('TF1.corto.abc'), null);
  fs.writeFileSync(path.join(__dirname, 'vector.json'), JSON.stringify({ code: CODE, sealed: vector, plain: vectorPlain }, null, 2) + '\n');

  // 2. Non collegata: lo dice e non salva niente.
  {
    const posts = [];
    const skill = buildSkill({ pairingCode: '', persistenceAdapter: memoryAdapter(), publish: async (t, b) => posts.push(b) || true, timeZone: async () => null }).create();
    const r = await skill.invoke(capture('devo pulire la cucina oggi'));
    assert.match(speech(r), /non è ancora collegata/);
    assert.strictEqual(posts.length, 0);
  }

  const adapter = memoryAdapter();
  const posts = [];
  let online = true;
  let clock = Date.parse('2026-11-01T22:55:02Z');
  const skill = buildSkill({
    pairingCode: CODE,
    persistenceAdapter: adapter,
    publish: async (topic, body) => {
      assert.strictEqual(topic, pairing.topic);
      if (!online) return false;
      posts.push(body);
      return true;
    },
    timeZone: async () => 'Europe/Amsterdam',
    now: () => clock,
  }).create();

  // 3. Prima della voce registrata: chiede di registrarla, non salva.
  let r = await skill.invoke(capture('devo pulire la cucina oggi'));
  assert.match(speech(r), /Prima devo conoscere la tua voce/);
  assert.strictEqual(posts.length, 0);

  // 4. Registrazione voce: senza ID vocale lo spiega; con ID vocale registra; un ospite non può prenderla.
  r = await skill.invoke(register({ person: null }));
  assert.match(speech(r), /crea un ID vocale/);
  r = await skill.invoke(register());
  assert.match(speech(r), /ora riconosco la tua voce/);
  r = await skill.invoke(register());
  assert.match(speech(r), /Ti conosco già/);
  r = await skill.invoke(register({ person: GUEST }));
  assert.match(speech(r), /già la voce di un'altra persona/);

  // 5. La mia voce: salva, ripete quello che ha sentito, il messaggio ha l'ora detta e il fuso dell'Echo.
  r = await skill.invoke(capture('devo pulire la cucina oggi & domani'));
  assert.match(speech(r), /Fatto: devo pulire la cucina oggi &amp; domani\. Ci pensa ThoughtFlow\./);
  assert.strictEqual(r.response.shouldEndSession, true);
  assert.strictEqual(posts.length, 1);
  const first = JSON.parse(open(posts[0], pairing));
  assert.strictEqual(first.text, 'devo pulire la cucina oggi & domani');
  assert.strictEqual(first.at, Date.parse('2026-11-01T22:55:00Z'), "l'ora è quella detta, non quella di invio");
  assert.strictEqual(first.tz, 'Europe/Amsterdam');

  // 6. Voce sconosciuta o non riconosciuta: non salva.
  r = await skill.invoke(capture('comprare la birra', { person: GUEST }));
  assert.match(speech(r), /Non ti ho riconosciuto/);
  r = await skill.invoke(capture('comprare la birra', { person: null }));
  assert.match(speech(r), /Non ti ho riconosciuto/);
  assert.strictEqual(posts.length, 1);

  // 7. Cassetta giù: il pensiero resta nella copia di sicurezza e Alexa lo dice; al prossimo uso parte.
  online = false;
  r = await skill.invoke(capture('chiamare Daniele per Siemens'));
  assert.match(speech(r), /Arriverà sul telefono appena possibile/);
  assert.strictEqual(posts.length, 1);
  online = true;
  clock += 60 * 1000;
  r = await skill.invoke(capture('annaffiare le piante stasera'));
  assert.strictEqual(posts.length, 3, 'parte il nuovo e quello rimasto indietro, non quello già inviato');
  const texts3 = posts.slice(1).map((p) => JSON.parse(open(p, pairing)).text).sort();
  assert.deepStrictEqual(texts3, ['annaffiare le piante stasera', 'chiamare Daniele per Siemens']);

  // 8. Dopo 11 ore si rimandano (ntfy ne tiene 12), dopo 7 giorni si buttano.
  clock += outbox.REPOST_MS;
  r = await skill.invoke(capture('ultimo pensiero'));
  const repostedIds = new Set(posts.slice(3).map((p) => JSON.parse(open(p, pairing)).id));
  assert.strictEqual(repostedIds.size, 4, 'i 3 vecchi rimandati + il nuovo');
  clock += outbox.KEEP_MS;
  const before = posts.length;
  r = await skill.invoke(capture('dopo una settimana'));
  assert.strictEqual(posts.length - before, 1, 'quelli di più di 7 giorni non si rimandano');
  const stored = adapter.db['user-1'].outbox;
  assert.strictEqual(stored.length, 1);

  // 9. Codice nuovo: la voce va registrata di nuovo, la copia vecchia si butta.
  const newCode = 'TF1.tfNewTopic0123456789abcdefghi.' + Buffer.alloc(32, 9).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const skill2 = buildSkill({ pairingCode: newCode, persistenceAdapter: adapter, publish: async () => true, timeZone: async () => null, now: () => clock }).create();
  r = await skill2.invoke(capture('test'));
  assert.match(speech(r), /Prima devo conoscere la tua voce/);

  // 10. "Alexa, apri flow": chiede il pensiero e aspetta la risposta (slot), anche in inglese.
  r = await skill.invoke(launch());
  assert.match(speech(r), /Cosa vuoi che ti ricordi\?/);
  assert.strictEqual(r.response.directives[0].type, 'Dialog.ElicitSlot');
  assert.strictEqual(r.response.directives[0].updatedIntent.name, 'CaptureIntent');
  r = await skill.invoke(launch({ locale: 'en-GB' }));
  assert.match(speech(r), /What should I remember\?/);
  r = await skill.invoke(capture('clean the kitchen today', { locale: 'en-US' }));
  assert.match(speech(r), /Done: clean the kitchen today\. ThoughtFlow is on it\./);

  // 11. Modelli: tutte le lingue hanno "flow reminder", lo slot e le frasi con la parola davanti (regola di Amazon).
  for (const loc of ['it-IT', 'en-GB', 'en-US']) {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'skill-package', 'interactionModels', 'custom', loc + '.json'), 'utf8')).interactionModel;
    assert.strictEqual(m.languageModel.invocationName, 'flow reminder');
    const intent = m.languageModel.intents.find((i) => i.name === 'CaptureIntent');
    assert.ok(intent.samples.length >= 10);
    intent.samples.forEach((s) => assert.ok(/^\S.* \{thought\}$/.test(s), loc + ': ' + s));
  }

  console.log('OK: tutte le prove della skill passate');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
