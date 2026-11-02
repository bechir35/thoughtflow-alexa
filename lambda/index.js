'use strict';
// Skill "flow" per ThoughtFlow (fase 9). Fa solo da postino: prende la frase, la cifra e la mette nella cassetta ntfy.
// Niente reminder né liste su Alexa: tutto il resto lo decide l'app sul telefono.
const Alexa = require('ask-sdk-core');
const crypto = require('crypto');
const https = require('https');
const config = require('./config');
const { parsePairing, seal } = require('./crypto');
const outbox = require('./outbox');
const { texts, ssmlSafe } = require('./texts');

const MAX_TEXT = 1500;

/**
 * Fase 11: i verbi più comuni, così basta dire "Alexa, chiedi a Flow Reminder di comprare il pane".
 * Amazon vuole una parola fissa davanti alla parte libera: per ogni verbo c'è un intent ("comprare {thought}"),
 * e qui il verbo torna davanti alla frase ("comprare" + "il pane"). Il modello it-IT.json si rigenera con
 * tools/add-verbs.js partendo da questa lista.
 */
const VERBS_IT = [
  'comprare', 'chiamare', 'telefonare', 'pagare', 'prenotare', 'portare', 'prendere', 'fare', 'mandare', 'inviare',
  'spedire', 'scrivere', 'ritirare', 'pulire', 'lavare', 'sistemare', 'controllare', 'rispondere', 'preparare', 'cucinare',
  'restituire', 'cercare', 'studiare', 'leggere', 'finire', 'organizzare', 'contattare', 'mettere', 'cambiare', 'riparare',
  'aggiustare', 'annaffiare', 'buttare', 'stendere', 'andare', 'passare', 'ordinare', 'rinnovare', 'disdire', 'stampare',
  'ricaricare', 'aggiornare', 'fissare', 'iniziare', 'provare', 'chiedere',
];
const verbIntentName = (verb) => 'Verb' + verb[0].toUpperCase() + verb.slice(1) + 'Intent';
const VERB_INTENTS = Object.fromEntries(VERBS_IT.map((v) => [verbIntentName(v), v]));

/** Pubblica un messaggio nella cassetta (POST https://ntfy.sh/<topic>). Risolve true/false, non lancia mai. */
function publishToNtfy(topic, body, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = https.request(
      { method: 'POST', host: 'ntfy.sh', path: '/' + encodeURIComponent(topic), headers: { 'Content-Type': 'text/plain', 'User-Agent': 'ThoughtFlow-Alexa' }, timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

/** Fuso orario dell'Echo (Settings API, nessun permesso richiesto). null se non arriva in tempo. */
async function echoTimeZone(handlerInput) {
  try {
    const deviceId = Alexa.getDeviceId(handlerInput.requestEnvelope);
    const client = handlerInput.serviceClientFactory.getUpsServiceClient();
    return await Promise.race([client.getSystemTimeZone(deviceId), new Promise((resolve) => setTimeout(() => resolve(null), 1500))]);
  } catch (e) {
    return null;
  }
}

function personId(handlerInput) {
  const person = handlerInput.requestEnvelope.context && handlerInput.requestEnvelope.context.System.person;
  return person && person.personId ? person.personId : null;
}

function captureIntentShell() {
  return { name: 'CaptureIntent', confirmationStatus: 'NONE', slots: { thought: { name: 'thought', confirmationStatus: 'NONE' } } };
}

/**
 * Costruisce la skill. Le dipendenze esterne (database, cassetta, fuso, ora, codice) si possono sostituire nei test,
 * così si prova tutto senza Amazon e senza rete.
 */
function buildSkill(deps = {}) {
  const publish = deps.publish || publishToNtfy;
  const timeZone = deps.timeZone || echoTimeZone;
  const now = deps.now || (() => Date.now());
  const pairingCode = () => (deps.pairingCode !== undefined ? deps.pairingCode : config.PAIRING_CODE);

  const LaunchRequestHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest',
    handle(h) {
      const t = texts(Alexa.getLocale(h.requestEnvelope));
      if (!parsePairing(pairingCode())) return h.responseBuilder.speak(t.notLinked).withShouldEndSession(true).getResponse();
      return h.responseBuilder.speak(t.ask).reprompt(t.ask).addElicitSlotDirective('thought', captureIntentShell()).getResponse();
    },
  };

  const CaptureIntentHandler = {
    canHandle: (h) => {
      if (Alexa.getRequestType(h.requestEnvelope) !== 'IntentRequest') return false;
      const name = Alexa.getIntentName(h.requestEnvelope);
      return name === 'CaptureIntent' || Object.prototype.hasOwnProperty.call(VERB_INTENTS, name);
    },
    async handle(h) {
      const t = texts(Alexa.getLocale(h.requestEnvelope));
      const pairing = parsePairing(pairingCode());
      if (!pairing) return h.responseBuilder.speak(t.notLinked).withShouldEndSession(true).getResponse();

      const rest = String(Alexa.getSlotValue(h.requestEnvelope, 'thought') || '').trim();
      // Solo il verbo ("chiedi a Flow Reminder di comprare"): chiede il pensiero intero.
      if (!rest) return h.responseBuilder.speak(t.ask).reprompt(t.ask).addElicitSlotDirective('thought', captureIntentShell()).getResponse();
      const verb = VERB_INTENTS[Alexa.getIntentName(h.requestEnvelope)];
      const said = (verb ? verb + ' ' + rest : rest).slice(0, MAX_TEXT);

      let attrs;
      try {
        attrs = (await h.attributesManager.getPersistentAttributes()) || {};
      } catch (e) {
        return h.responseBuilder.speak(t.notSaved).withShouldEndSession(true).getResponse();
      }

      // Solo la tua voce: la voce registrata vale per questo codice di collegamento.
      const owner = attrs.owner && attrs.owner.tag === pairing.tag ? attrs.owner.personId : null;
      if (!owner) return h.responseBuilder.speak(t.needVoice).withShouldEndSession(true).getResponse();
      if (personId(h) !== owner) return h.responseBuilder.speak(t.notRecognized).withShouldEndSession(true).getResponse();

      // L'ora giusta: quando l'hai detto (orario della richiesta) e il fuso dell'Echo.
      const spokenAt = Date.parse(h.requestEnvelope.request.timestamp) || now();
      const tz = await timeZone(h);
      const payload = { v: 1, id: crypto.randomUUID(), text: said, at: spokenAt, tz: tz || null, lang: Alexa.getLocale(h.requestEnvelope) };
      const entry = { id: payload.id, sealed: seal(JSON.stringify(payload), pairing), at: spokenAt, postedAt: 0 };

      const nowMs = now();
      // Codice nuovo (Alexa ricollegata): i vecchi messaggi erano per la cassetta vecchia, si buttano.
      if (attrs.tag !== pairing.tag) {
        attrs.outbox = [];
        attrs.tag = pairing.tag;
      }
      const list = outbox.prune(attrs.outbox, nowMs).concat([entry]);
      const toSend = outbox.due(list, nowMs);
      const results = await Promise.all(toSend.map((e) => publish(pairing.topic, e.sealed)));
      toSend.forEach((e, i) => {
        if (results[i]) e.postedAt = nowMs;
      });
      const sentNow = entry.postedAt > 0;

      let stored = true;
      try {
        attrs.outbox = list;
        h.attributesManager.setPersistentAttributes(attrs);
        await h.attributesManager.savePersistentAttributes();
      } catch (e) {
        stored = false;
      }

      const echo = ssmlSafe(said);
      if (sentNow) return h.responseBuilder.speak(t.saved(echo)).withShouldEndSession(true).getResponse();
      if (stored) return h.responseBuilder.speak(t.savedLater(echo)).withShouldEndSession(true).getResponse();
      return h.responseBuilder.speak(t.notSaved).withShouldEndSession(true).getResponse();
    },
  };

  const RegisterVoiceIntentHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'RegisterVoiceIntent',
    async handle(h) {
      const t = texts(Alexa.getLocale(h.requestEnvelope));
      const pairing = parsePairing(pairingCode());
      if (!pairing) return h.responseBuilder.speak(t.notLinked).withShouldEndSession(true).getResponse();
      const me = personId(h);
      if (!me) return h.responseBuilder.speak(t.noVoiceId).withShouldEndSession(true).getResponse();
      try {
        const attrs = (await h.attributesManager.getPersistentAttributes()) || {};
        const owner = attrs.owner && attrs.owner.tag === pairing.tag ? attrs.owner.personId : null;
        if (owner === me) return h.responseBuilder.speak(t.voiceKnown).withShouldEndSession(true).getResponse();
        if (owner) return h.responseBuilder.speak(t.voiceTaken).withShouldEndSession(true).getResponse();
        attrs.owner = { personId: me, tag: pairing.tag };
        h.attributesManager.setPersistentAttributes(attrs);
        await h.attributesManager.savePersistentAttributes();
        return h.responseBuilder.speak(t.voiceSaved).withShouldEndSession(true).getResponse();
      } catch (e) {
        return h.responseBuilder.speak(t.error).withShouldEndSession(true).getResponse();
      }
    },
  };

  const HelpIntentHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent',
    handle(h) {
      const t = texts(Alexa.getLocale(h.requestEnvelope));
      return h.responseBuilder.speak(t.help).reprompt(t.ask).addElicitSlotDirective('thought', captureIntentShell()).getResponse();
    },
  };

  const StopIntentHandler = {
    canHandle: (h) =>
      Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      ['AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NavigateHomeIntent'].includes(Alexa.getIntentName(h.requestEnvelope)),
    handle(h) {
      return h.responseBuilder.speak(texts(Alexa.getLocale(h.requestEnvelope)).bye).withShouldEndSession(true).getResponse();
    },
  };

  const FallbackIntentHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.FallbackIntent',
    handle(h) {
      return h.responseBuilder.speak(texts(Alexa.getLocale(h.requestEnvelope)).fallback).withShouldEndSession(true).getResponse();
    },
  };

  const SessionEndedRequestHandler = {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest',
    handle: (h) => h.responseBuilder.getResponse(),
  };

  const ErrorHandler = {
    canHandle: () => true,
    handle(h, error) {
      console.log('flow error', error && error.message);
      return h.responseBuilder.speak(texts(Alexa.getLocale(h.requestEnvelope)).error).withShouldEndSession(true).getResponse();
    },
  };

  const builder = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
      LaunchRequestHandler,
      CaptureIntentHandler,
      RegisterVoiceIntentHandler,
      HelpIntentHandler,
      StopIntentHandler,
      FallbackIntentHandler,
      SessionEndedRequestHandler,
    )
    .addErrorHandlers(ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient());

  const adapter = deps.persistenceAdapter || defaultPersistenceAdapter();
  if (adapter) builder.withPersistenceAdapter(adapter);
  return builder;
}

/** Database gratuito della skill ospitata da Alexa (DynamoDB). Le variabili d'ambiente le mette Amazon. */
function defaultPersistenceAdapter() {
  if (!process.env.DYNAMODB_PERSISTENCE_TABLE_NAME) return null;
  const AWS = require('aws-sdk');
  const ddbAdapter = require('ask-sdk-dynamodb-persistence-adapter');
  return new ddbAdapter.DynamoDbPersistenceAdapter({
    tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME,
    createTable: false,
    dynamoDBClient: new AWS.DynamoDB({ apiVersion: 'latest', region: process.env.DYNAMODB_PERSISTENCE_REGION }),
  });
}

let lambdaHandler;
exports.handler = (event, context, callback) => {
  if (!lambdaHandler) lambdaHandler = buildSkill().lambda();
  return lambdaHandler(event, context, callback);
};
exports.buildSkill = buildSkill;
exports.VERBS_IT = VERBS_IT;
exports.verbIntentName = verbIntentName;
