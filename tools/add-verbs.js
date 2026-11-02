'use strict';
// Rigenera gli intent dei verbi nel modello italiano partendo dalla lista in lambda/index.js (fase 11).
// Uso: node tools/add-verbs.js   (serve solo per aggiornare skill-package/interactionModels/custom/it-IT.json)
const fs = require('fs');
const path = require('path');
const Module = require('module');

// index.js carica ask-sdk-core: per leggere solo la lista dei verbi basta un finto modulo.
const realLoad = Module._load;
Module._load = (request, ...rest) => (request === 'ask-sdk-core' ? {} : realLoad(request, ...rest));
const { VERBS_IT, verbIntentName } = require('../lambda/index');
Module._load = realLoad;

const file = path.join(__dirname, '..', 'skill-package', 'interactionModels', 'custom', 'it-IT.json');
const model = JSON.parse(fs.readFileSync(file, 'utf8'));
const lm = model.interactionModel.languageModel;
lm.intents = lm.intents.filter((i) => !/^Verb[A-Z].*Intent$/.test(i.name));
for (const verb of VERBS_IT) {
  lm.intents.push({ name: verbIntentName(verb), slots: [{ name: 'thought', type: 'AMAZON.SearchQuery' }], samples: [verb + ' {thought}'] });
}
fs.writeFileSync(file, JSON.stringify(model, null, 2) + '\n');
console.log('verbi nel modello:', VERBS_IT.length, '· intent totali:', lm.intents.length);
