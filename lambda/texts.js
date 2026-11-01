'use strict';
// Quello che dice Alexa. Il pensiero viene ripetuto, così ti accorgi subito se ha capito male.

const TEXTS = {
  it: {
    ask: 'Cosa vuoi che ti ricordi?',
    saved: (t) => `Fatto: ${t}. Ci pensa ThoughtFlow.`,
    savedLater: (t) => `Fatto: ${t}. Arriverà sul telefono appena possibile.`,
    notSaved: 'Non sono riuscita a salvarlo, riprova tra poco.',
    notRecognized: "Non ti ho riconosciuto, quindi non l'ho salvato. Riprova.",
    needVoice: "Prima devo conoscere la tua voce. Di': Alexa, chiedi a Flow Reminder di riconoscere la mia voce.",
    noVoiceId:
      "Non riesco a riconoscere la tua voce. Nell'app Alexa crea un ID vocale, attiva Personalizza skill e dai a Flow Reminder il permesso di riconoscerti. Poi riprova.",
    voiceSaved: 'Fatto, ora riconosco la tua voce. Da adesso salvo solo i tuoi pensieri.',
    voiceKnown: 'Ti conosco già: salvo solo i tuoi pensieri.',
    voiceTaken: "Flow Reminder conosce già la voce di un'altra persona. Per cambiarla, collega di nuovo Alexa dall'app ThoughtFlow.",
    notLinked: "Flow Reminder non è ancora collegata al telefono. Incolla il codice di ThoughtFlow nel file config della skill e premi Deploy.",
    help: 'Puoi dire: chiedi a Flow Reminder di ricordare che devo pulire la cucina oggi. Cosa vuoi che ti ricordi?',
    fallback: 'Non ho capito. Prova a dire: chiedi a Flow Reminder di ricordare che, e poi il tuo pensiero.',
    bye: 'Ok.',
    error: "Qualcosa non ha funzionato e non l'ho salvato. Riprova.",
  },
  en: {
    ask: 'What should I remember?',
    saved: (t) => `Done: ${t}. ThoughtFlow is on it.`,
    savedLater: (t) => `Done: ${t}. It will reach your phone as soon as possible.`,
    notSaved: "I couldn't save it, please try again in a moment.",
    notRecognized: "I didn't recognise your voice, so I didn't save it. Please try again.",
    needVoice: 'First I need to know your voice. Say: Alexa, ask Flow Reminder to recognise my voice.',
    noVoiceId:
      "I can't recognise your voice. In the Alexa app create a voice ID, turn on Personalise skills and allow Flow Reminder to recognise you. Then try again.",
    voiceSaved: 'Done, I now recognise your voice. From now on I only save your thoughts.',
    voiceKnown: 'I already know you: I only save your thoughts.',
    voiceTaken: "Flow Reminder already knows another person's voice. To change it, connect Alexa again from the ThoughtFlow app.",
    notLinked: "Flow Reminder isn't connected to your phone yet. Paste the ThoughtFlow code into the skill's config file and press Deploy.",
    help: 'You can say: ask Flow Reminder to remember to clean the kitchen today. What should I remember?',
    fallback: "Sorry, I didn't get that. Try saying: ask Flow Reminder to remember, and then your thought.",
    bye: 'Okay.',
    error: "Something went wrong and I didn't save it. Please try again.",
  },
};

function texts(locale) {
  return String(locale || '').toLowerCase().startsWith('it') ? TEXTS.it : TEXTS.en;
}

/** Il pensiero viene ripetuto dentro SSML: i caratteri speciali vanno protetti. */
function ssmlSafe(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { texts, ssmlSafe };
